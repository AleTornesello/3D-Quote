import io
import zipfile

import pytest

REQUIRED = (
    "Metadata/slice_info.config",
    "Metadata/model_settings.config",
    "Metadata/plate_1.gcode",
)


@pytest.mark.parametrize("fixture", ["single_plate_bytes", "multi_plate_bytes"])
def test_trimmed_fixtures_keep_sources(fixture, request):
    data = request.getfixturevalue(fixture)
    assert len(data) < 300 * 1024
    names = zipfile.ZipFile(io.BytesIO(data)).namelist()
    for name in REQUIRED:
        assert name in names
    assert "3D/3dmodel.model" not in names
