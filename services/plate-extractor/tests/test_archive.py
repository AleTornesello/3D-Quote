import io
import lzma
import zipfile
import zlib

import pytest

from plate_extractor import archive
from plate_extractor.archive import (
    NotA3mfError,
    ReadBudget,
    ReadBudgetExceededError,
    open_archive,
    read_entry,
    read_entry_head,
)


def test_non_zip_raises():
    with pytest.raises(NotA3mfError):
        open_archive(b"hello")


def test_missing_entry_is_none(make_3mf):
    zf = open_archive(make_3mf({"Metadata/a.txt": "x"}))
    assert read_entry(zf, "Metadata/missing.txt") is None


def test_reads_existing_entry(make_3mf):
    zf = open_archive(make_3mf({"Metadata/a.txt": "x"}))
    assert read_entry(zf, "Metadata/a.txt") == b"x"


def test_oversized_entry_rejected(make_3mf):
    zf = open_archive(make_3mf({"Metadata/big.txt": b"a" * 1000}))
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/big.txt", max_bytes=100)
    assert read_entry(zf, "Metadata/big.txt", max_bytes=1000) == b"a" * 1000


def test_traversal_name_is_refused(make_3mf, tmp_path):
    zf = open_archive(make_3mf({"../x": "evil", "/abs": "evil"}))
    assert read_entry(zf, "../x") is None
    assert read_entry(zf, "/abs") is None
    assert read_entry(zf, "a/../b") is None
    assert not (tmp_path.parent / "x").exists()


def test_reads_utf8_path_with_spaces(make_3mf):
    name = "Auxiliaries/Model Pictures/Würfel.webp"
    zf = open_archive(make_3mf({name: b"img"}))
    assert read_entry(zf, name) == b"img"


def test_reads_fixture(single_plate_bytes):
    zf = open_archive(single_plate_bytes)
    assert read_entry(zf, "Metadata/slice_info.config")


# --- entry count / central directory ----------------------------------------


def _zip_with_entries(count: int) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for i in range(count):
            z.writestr(f"e{i}", b"")
    return buf.getvalue()


def test_more_than_10000_entries_rejected():
    with pytest.raises(NotA3mfError):
        open_archive(_zip_with_entries(10_001))


def test_entry_cap_boundary(monkeypatch):
    monkeypatch.setattr(archive, "_MAX_ENTRIES", 3)
    assert len(open_archive(_zip_with_entries(3)).infolist()) == 3
    with pytest.raises(NotA3mfError):
        open_archive(_zip_with_entries(4))


def test_oversized_central_directory_rejected(monkeypatch):
    # Guards against an end record that understates the entry count.
    monkeypatch.setattr(archive, "_MAX_CENTRAL_DIR_BYTES", 100)
    with pytest.raises(NotA3mfError):
        open_archive(_zip_with_entries(5))


# --- lying sizes, corrupt and unsupported entries ----------------------------


def test_lying_declared_size_never_returns_more_than_cap(make_3mf):
    zf = open_archive(make_3mf({"Metadata/big.txt": b"a" * 1000}))
    # The header claims 1 byte; the real entry is 1000 bytes.
    zf.getinfo("Metadata/big.txt").file_size = 1
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/big.txt", max_bytes=100)


def test_corrupt_deflate_entry_is_not_a_3mf(make_3mf, corrupt_entry):
    data = corrupt_entry(make_3mf({"Metadata/a.txt": b"a" * 1000}), "Metadata/a.txt")
    zf = open_archive(data)
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/a.txt")
    with pytest.raises(NotA3mfError):
        read_entry_head(zf, "Metadata/a.txt")


def test_corrupt_lzma_entry_is_not_a_3mf(make_3mf, corrupt_entry):
    data = make_3mf({"Metadata/a.txt": b"a" * 1000}, zipfile.ZIP_LZMA)
    data = corrupt_entry(data, "Metadata/a.txt", skip=4)
    zf = open_archive(data)
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/a.txt")
    with pytest.raises(NotA3mfError):
        read_entry_head(zf, "Metadata/a.txt")


@pytest.mark.parametrize("method", [zipfile.ZIP_LZMA, zipfile.ZIP_BZIP2])
def test_non_deflate_compression_is_refused(make_3mf, method):
    # 3MF (OPC) allows only stored and deflate; lzma/bzip2 decompress unbounded
    # in zipfile, so a tiny entry could expand to gigabytes.
    zf = open_archive(make_3mf({"Metadata/a.txt": b"a" * 1000}, method))
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/a.txt")
    with pytest.raises(NotA3mfError):
        read_entry_head(zf, "Metadata/a.txt")


@pytest.mark.parametrize(
    "error",
    [zlib.error("x"), lzma.LZMAError("x"), EOFError("x"), zipfile.BadZipFile("x")],
)
def test_decompressor_errors_are_not_a_3mf(make_3mf, monkeypatch, error):
    zf = open_archive(make_3mf({"Metadata/a.txt": b"abc"}))

    def _boom(*args, **kwargs):
        raise error

    monkeypatch.setattr(zf, "open", _boom)
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/a.txt")
    with pytest.raises(NotA3mfError):
        read_entry_head(zf, "Metadata/a.txt")


def test_stored_entry_is_read(make_3mf):
    zf = open_archive(make_3mf({"Metadata/a.png": b"png"}, zipfile.ZIP_STORED))
    assert read_entry(zf, "Metadata/a.png") == b"png"


# --- read_entry_head -----------------------------------------------------------


def test_head_reads_at_most_max_bytes_regardless_of_size(make_3mf):
    zf = open_archive(make_3mf({"Metadata/plate_1.gcode": b"a" * 1000}))
    assert read_entry_head(zf, "Metadata/plate_1.gcode", max_bytes=100) == b"a" * 100


def test_head_of_small_entry_is_whole_entry(make_3mf):
    zf = open_archive(make_3mf({"Metadata/plate_1.gcode": b"abc"}))
    assert read_entry_head(zf, "Metadata/plate_1.gcode") == b"abc"


def test_head_default_is_512_kib(make_3mf):
    zf = open_archive(make_3mf({"Metadata/plate_1.gcode": b"a" * (600 * 1024)}))
    assert len(read_entry_head(zf, "Metadata/plate_1.gcode")) == 512 * 1024


def test_head_missing_or_unsafe_is_none(make_3mf):
    zf = open_archive(make_3mf({"../x": "evil"}))
    assert read_entry_head(zf, "Metadata/missing.gcode") is None
    assert read_entry_head(zf, "../x") is None


def test_head_of_entry_declared_larger_than_20mb_is_read(make_3mf):
    zf = open_archive(make_3mf({"Metadata/plate_1.gcode": b"a" * 10}))
    zf.getinfo("Metadata/plate_1.gcode").file_size = 10**12
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/plate_1.gcode")
    # zipfile stops at the real end and then fails the CRC; the head read is
    # bounded by max_bytes, not by the declared size.
    head = read_entry_head(zf, "Metadata/plate_1.gcode", max_bytes=5)
    assert head == b"aaaaa"


# --- ReadBudget ----------------------------------------------------------------


def test_budget_is_charged_by_reads(make_3mf):
    zf = open_archive(make_3mf({"Metadata/a": b"a" * 60, "Metadata/b": b"b" * 30}))
    budget = ReadBudget(100)
    assert read_entry(zf, "Metadata/a", budget=budget) == b"a" * 60
    assert budget.remaining == 40
    assert read_entry_head(zf, "Metadata/b", max_bytes=10, budget=budget) == b"b" * 10
    assert budget.remaining == 30


def test_read_beyond_budget_raises(make_3mf):
    zf = open_archive(make_3mf({"Metadata/a": b"a" * 60}))
    budget = ReadBudget(100)
    read_entry(zf, "Metadata/a", budget=budget)
    with pytest.raises(ReadBudgetExceededError):
        read_entry(zf, "Metadata/a", budget=budget)
    assert issubclass(ReadBudgetExceededError, NotA3mfError)


def test_head_read_with_exhausted_budget_raises(make_3mf):
    zf = open_archive(make_3mf({"Metadata/a": b"a" * 60}))
    budget = ReadBudget(60)
    read_entry(zf, "Metadata/a", budget=budget)
    assert budget.remaining == 0
    with pytest.raises(ReadBudgetExceededError):
        read_entry_head(zf, "Metadata/a", budget=budget)


def test_entry_lying_about_size_still_charges_budget(make_3mf):
    zf = open_archive(make_3mf({"Metadata/a": b"a" * 60}))
    zf.getinfo("Metadata/a").file_size = 1
    budget = ReadBudget(100)
    with pytest.raises(NotA3mfError):
        read_entry(zf, "Metadata/a", budget=budget)
    assert budget.remaining < 100
