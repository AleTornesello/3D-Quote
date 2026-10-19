import pytest

from plate_extractor.archive import NotA3mfError, open_archive, read_entry


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
