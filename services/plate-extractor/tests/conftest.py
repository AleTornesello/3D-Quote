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
    def _make(entries: dict[str, bytes | str]) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in entries.items():
                z.writestr(name, data)
        return buf.getvalue()

    return _make
