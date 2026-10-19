import pytest
from fastapi.testclient import TestClient

from plate_extractor.api import app, create_app

client = TestClient(app)


def _post(c, data, **params):
    return c.post(
        "/plates",
        files={"file": ("x.gcode.3mf", data, "application/octet-stream")},
        params=params,
    )


def test_multi_plate_contract(multi_plate_bytes):
    r = _post(client, multi_plate_bytes)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"source", "plates", "warnings"}
    assert set(body["source"]) == {"slicer", "slicer_version", "printer_model"}
    assert isinstance(body["warnings"], list)
    assert len(body["plates"]) == 4
    p = body["plates"][0]
    assert set(p) == {
        "index", "description", "print_time_s", "quantity",
        "support_used", "materials", "thumbnail",
    }
    assert set(p["materials"][0]) == {"type", "color", "profile", "grams"}
    assert p["thumbnail"].startswith("data:image/png;base64,")


def test_single_plate_has_one_plate(single_plate_bytes):
    r = _post(client, single_plate_bytes)
    assert r.status_code == 200
    assert len(r.json()["plates"]) == 1


def test_thumbnails_off(multi_plate_bytes):
    r = _post(client, multi_plate_bytes, include_thumbnails="false")
    assert r.status_code == 200
    assert all(p["thumbnail"] is None for p in r.json()["plates"])


def test_not_a_3mf():
    r = _post(client, b"not a zip")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "not_a_3mf"
    assert set(r.json()) == {"error"}


def test_not_sliced(make_3mf):
    r = _post(client, make_3mf({"Metadata/other.txt": "x"}))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "not_sliced"


def test_too_large():
    small = TestClient(create_app(max_upload_mb=1))
    r = _post(small, b"\0" * (1024 * 1024 + 10))
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "file_too_large"


def test_at_cap_is_not_rejected_for_size():
    small = TestClient(create_app(max_upload_mb=1))
    r = _post(small, b"\0" * (1024 * 1024))
    assert r.status_code == 400


def test_env_cap(monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_MB", "1")
    c = TestClient(create_app())
    assert _post(c, b"\0" * (1024 * 1024 + 1)).status_code == 413


def test_missing_file_field():
    r = client.post("/plates")
    assert r.status_code == 422
    assert set(r.json()) == {"error"}
    assert r.json()["error"]["code"] == "invalid_request"
    assert r.json()["error"]["message"]


def test_invalid_include_thumbnails(single_plate_bytes):
    r = _post(client, single_plate_bytes, include_thumbnails="maybe")
    assert r.status_code == 422
    assert set(r.json()) == {"error"}
    assert r.json()["error"]["code"] == "invalid_request"
    assert "include_thumbnails" in r.json()["error"]["message"]


def test_corrupt_slice_info_is_400(make_3mf, corrupt_entry):
    data = make_3mf({"Metadata/slice_info.config": "<config>" + "<plate/>" * 200 + "</config>"})
    r = _post(client, corrupt_entry(data, "Metadata/slice_info.config"))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "not_a_3mf"


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_thumbnail_amplification_probe_is_bounded(make_3mf):
    count = 100
    png = b"\x89PNG\r\n\x1a\n" + bytes(2_000_000)
    plates = "".join(
        f'<plate><metadata key="index" value="{i}"/>'
        '<metadata key="prediction" value="100"/>'
        '<filament id="1" type="PLA" color="#FF0000" used_g="10.00"/></plate>'
        for i in range(1, count + 1)
    )
    slots = "".join(
        f'<plate><metadata key="plater_id" value="{i}"/>'
        f'<metadata key="gcode_file" value="Metadata/plate_{i}.gcode"/>'
        '<metadata key="thumbnail_file" value="Metadata/plate_1.png"/></plate>'
        for i in range(1, count + 1)
    )
    data = make_3mf(
        {
            "Metadata/slice_info.config": f"<config>{plates}</config>",
            "Metadata/model_settings.config": f"<config>{slots}</config>",
            "Metadata/plate_1.png": png,
        }
    )
    r = _post(client, data)
    assert r.status_code == 200
    assert len(r.content) < 12 * 1024 * 1024
    assert all(p["thumbnail"] is None for p in r.json()["plates"])


def _central_entries(data: bytes) -> list[int]:
    sig = b"PK"
    out, pos = [], data.find(sig)
    while pos != -1:
        out.append(pos)
        pos = data.find(sig, pos + 4)
    return out


def test_corrupt_version_field_is_400_not_500(single_plate_bytes):
    raw = bytearray(single_plate_bytes)
    for pos in _central_entries(bytes(raw)):
        raw[pos + 6 : pos + 8] = (99).to_bytes(2, "little")  # version needed
    r = TestClient(app, raise_server_exceptions=False).post(
        "/plates",
        files={"file": ("x.gcode.3mf", bytes(raw), "application/octet-stream")},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "not_a_3mf"


@pytest.mark.parametrize("where", ["end_record", "central_entry"])
def test_bad_offsets_are_400_not_500(single_plate_bytes, where):
    raw = bytearray(single_plate_bytes)
    if where == "end_record":
        eocd = raw.rfind(b"PK")
        # central directory offset beyond the file
        raw[eocd + 16 : eocd + 20] = (0xFFFFFFF0).to_bytes(4, "little")
    else:
        for pos in _central_entries(bytes(raw)):
            # local header offset beyond the file
            raw[pos + 42 : pos + 46] = (0xFFFFFFF0).to_bytes(4, "little")
    r = TestClient(app, raise_server_exceptions=False).post(
        "/plates",
        files={"file": ("x.gcode.3mf", bytes(raw), "application/octet-stream")},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "not_a_3mf"
