import io
import zipfile
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def single_plate_bytes() -> bytes:
    return (FIXTURES / "single_plate.gcode.3mf").read_bytes()


@pytest.fixture
def multi_plate_bytes() -> bytes:
    return (FIXTURES / "multi_plate.gcode.3mf").read_bytes()


@pytest.fixture
def make_3mf():
    def _make(
        entries: dict[str, bytes | str], compression: int = zipfile.ZIP_DEFLATED
    ) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression) as z:
            for name, data in entries.items():
                z.writestr(name, data)
        return buf.getvalue()

    return _make


@pytest.fixture
def corrupt_entry():
    """Overwrite the compressed bytes of one member of an in-memory zip."""

    def _corrupt(data: bytes, name: str, skip: int = 0) -> bytes:
        info = zipfile.ZipFile(io.BytesIO(data)).getinfo(name)
        raw = bytearray(data)
        # Local file header: 30 fixed bytes + name + extra field.
        name_len = int.from_bytes(raw[info.header_offset + 26 : info.header_offset + 28], "little")
        extra_len = int.from_bytes(raw[info.header_offset + 28 : info.header_offset + 30], "little")
        start = info.header_offset + 30 + name_len + extra_len + skip
        end = info.header_offset + 30 + name_len + extra_len + info.compress_size
        raw[start:end] = b"\xff" * (end - start)
        return bytes(raw)

    return _corrupt
