import pytest
from plate_extractor.archive import NotA3mfError
from plate_extractor.extract import NotSlicedError, describe_plate, parse_plates
from plate_extractor.models import Material

PNG = b"\x89PNG\r\n\x1a\nfake"

HEADER = (
    '<header><header_item key="X-BBL-Client-Type" value="slicer"/>'
    '<header_item key="X-BBL-Client-Version" value="02.08.02.61"/></header>'
)


def _slice_plate(
    index: int,
    *,
    prediction: str | None = "100",
    weight: str | None = "10.00",
    objects: tuple[str, ...] = ("Part",),
    filaments: tuple[tuple[int, str, str, str], ...] = (
        (1, "PLA", "#FF0000", "10.00"),
    ),
) -> str:
    meta = f'<metadata key="index" value="{index}"/>'
    if prediction is not None:
        meta += f'<metadata key="prediction" value="{prediction}"/>'
    if weight is not None:
        meta += f'<metadata key="weight" value="{weight}"/>'
    objs = "".join(f'<object name="{n}" skipped="false"/>' for n in objects)
    fils = "".join(
        f'<filament id="{fid}" type="{t}" color="{c}" used_g="{g}"/>'
        for fid, t, c, g in filaments
    )
    return f"<plate>{meta}{objs}{fils}</plate>"


def _slice_info(*plates: str) -> str:
    return f"<config>{HEADER}{''.join(plates)}</config>"


def _slot(index: int, *, name: str = "", gcode: bool = True, thumb: bool = True) -> str:
    gcode_file = f"Metadata/plate_{index}.gcode" if gcode else ""
    thumb_file = f"Metadata/plate_{index}.png" if thumb else ""
    return (
        f'<plate><metadata key="plater_id" value="{index}"/>'
        f'<metadata key="plater_name" value="{name}"/>'
        f'<metadata key="gcode_file" value="{gcode_file}"/>'
        f'<metadata key="thumbnail_file" value="{thumb_file}"/></plate>'
    )


def _model_settings(*slots: str) -> str:
    return f"<config>{''.join(slots)}</config>"


def _gcode(
    time: str = "1h 0m 0s", weight: str = "10.00", profiles: str = '"P1"'
) -> str:
    return (
        f"; total estimated time: {time}\n"
        f"; total filament weight [g] : {weight}\n"
        f"; filament_settings_id = {profiles}\n"
        "; printer_model = Bambu Lab P1S\n"
    )


# --- fixtures -------------------------------------------------------------


def test_single_plate_file_returns_only_sliced_plate(single_plate_bytes):
    result = parse_plates(single_plate_bytes)
    assert len(result.plates) == 1
    plate = result.plates[0]
    assert plate.index == 1
    assert plate.print_time_s == 4738
    assert plate.quantity == 1
    assert plate.support_used is False
    assert plate.materials == (
        Material(
            type="PLA", color="#000000", profile="Sunlu PLA - Calibrated", grams=39.12
        ),
    )
    assert plate.description == (
        "Würfel Tray 16X20, Würfel Tray Deckel, Würfel Tray Distanz"
    )
    assert result.slicer == "BambuStudio"
    assert result.slicer_version == "02.08.02.61"
    assert result.printer_model == "Bambu Lab P1S"
    assert result.warnings == ()


def test_multi_plate_file_returns_four_plates_in_order(multi_plate_bytes):
    result = parse_plates(multi_plate_bytes)
    assert [p.index for p in result.plates] == [1, 2, 3, 4]
    assert [p.print_time_s for p in result.plates] == [4738, 5723, 4725, 5105]
    assert [sum(m.grams for m in p.materials) for p in result.plates] == [
        39.12,
        34.09,
        28.13,
        24.82,
    ]
    assert all(p.quantity == 1 for p in result.plates)
    assert all(p.description.startswith("Würfel Tray") for p in result.plates)
    assert result.warnings == ()


# --- synthetic archives -----------------------------------------------------


def test_named_plate_uses_plater_name(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(
                _slice_plate(1, objects=("a", "b"))
            ),
            "Metadata/model_settings.config": _model_settings(
                _slot(1, name=" Bracket ")
            ),
        }
    )
    assert parse_plates(data).plates[0].description == "Bracket"


def test_zero_gram_filament_dropped(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(
                _slice_plate(
                    1,
                    filaments=(
                        (1, "PLA", "#000000", "0.00"),
                        (2, "PETG", "#FFFFFF", "12.345"),
                        (3, "PLA", "#00FF00", "-3"),
                    ),
                )
            ),
            "Metadata/plate_1.gcode": _gcode(profiles='"A";"B";"C"'),
        }
    )
    plate = parse_plates(data).plates[0]
    assert plate.materials == (
        Material(type="PETG", color="#FFFFFF", profile="B", grams=12.35),
    )


def test_same_type_and_colour_filaments_stay_separate_rows(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(
                _slice_plate(
                    1,
                    filaments=(
                        (1, "PLA", "#000000", "5.00"),
                        (2, "PLA", "#000000", "6.00"),
                    ),
                )
            ),
        }
    )
    materials = parse_plates(data).plates[0].materials
    assert [m.grams for m in materials] == [5.0, 6.0]
    assert all(m.profile is None for m in materials)


def test_profile_missing_when_header_has_fewer_profiles(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(
                _slice_plate(1, filaments=((2, "PLA", "#000000", "5.00"),))
            ),
            "Metadata/plate_1.gcode": _gcode(profiles='"only one"'),
        }
    )
    assert parse_plates(data).plates[0].materials[0].profile is None


def test_unsliced_3mf_raises_not_sliced(make_3mf):
    data = make_3mf({"3D/3dmodel.model": "<model/>"})
    with pytest.raises(NotSlicedError):
        parse_plates(data)


def test_not_a_zip_raises_not_a_3mf():
    with pytest.raises(NotA3mfError):
        parse_plates(b"not a zip")


def test_malformed_slice_info_raises_not_a_3mf(make_3mf):
    data = make_3mf({"Metadata/slice_info.config": "<config><plate>"})
    with pytest.raises(NotA3mfError):
        parse_plates(data)


def test_slice_info_with_no_plates_raises_not_sliced(make_3mf):
    data = make_3mf({"Metadata/slice_info.config": _slice_info()})
    with pytest.raises(NotSlicedError):
        parse_plates(data)


def test_time_falls_back_to_gcode_header(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(_slice_plate(1, prediction=None)),
            "Metadata/plate_1.gcode": _gcode(time="1h 18m 58s"),
        }
    )
    assert parse_plates(data).plates[0].print_time_s == 4738


def test_non_positive_prediction_falls_back_to_gcode_header(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(_slice_plate(1, prediction="0")),
            "Metadata/plate_1.gcode": _gcode(time="45s"),
        }
    )
    assert parse_plates(data).plates[0].print_time_s == 45


def test_plate_without_time_or_material_is_warned_not_returned(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(
                _slice_plate(1),
                _slice_plate(2, prediction=None),
                _slice_plate(3, filaments=((1, "PLA", "#000000", "0"),)),
                _slice_plate(4, filaments=()),
            ),
            # plate 4 has a header weight but no filament rows: type unknown
            "Metadata/plate_4.gcode": _gcode(weight="9.00"),
        }
    )
    result = parse_plates(data)
    assert [p.index for p in result.plates] == [1]
    assert len(result.warnings) == 3
    for index, warning in zip((2, 3, 4), result.warnings):
        assert f"Plate {index}" in warning


def test_all_plates_incomplete_raises_not_sliced(make_3mf):
    data = make_3mf(
        {"Metadata/slice_info.config": _slice_info(_slice_plate(1, prediction=None))}
    )
    with pytest.raises(NotSlicedError):
        parse_plates(data)


def test_plate_whose_slot_has_no_gcode_is_not_returned(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(_slice_plate(1), _slice_plate(2)),
            "Metadata/model_settings.config": _model_settings(
                _slot(1), _slot(2, gcode=False)
            ),
        }
    )
    assert [p.index for p in parse_plates(data).plates] == [1]


def test_without_model_settings_all_sliced_plates_returned(make_3mf):
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(_slice_plate(1), _slice_plate(2)),
            "Metadata/plate_1.png": PNG,
        }
    )
    result = parse_plates(data)
    assert [p.index for p in result.plates] == [1, 2]
    # thumbnail path only comes from model_settings
    assert all(p.thumbnail is None for p in result.plates)
    assert result.printer_model is None


def test_oversize_gcode_or_thumbnail_is_treated_as_absent(make_3mf, monkeypatch):
    from plate_extractor import extract

    monkeypatch.setattr(extract, "_ENTRY_MAX_BYTES", 16)
    data = make_3mf(
        {
            "Metadata/slice_info.config": _slice_info(_slice_plate(1)),
            "Metadata/model_settings.config": _model_settings(_slot(1)),
            "Metadata/plate_1.gcode": _gcode(),
            "Metadata/plate_1.png": PNG + b"\0" * 64,
        }
    )
    result = parse_plates(data)
    plate = result.plates[0]
    assert plate.print_time_s == 100
    assert plate.materials[0].profile is None
    assert plate.thumbnail is None
    assert result.printer_model is None


def test_thumbnail_toggle(single_plate_bytes):
    with_thumb = parse_plates(single_plate_bytes, include_thumbnails=True)
    assert with_thumb.plates[0].thumbnail.startswith(b"\x89PNG")
    without = parse_plates(single_plate_bytes, include_thumbnails=False)
    assert without.plates[0].thumbnail is None


# --- describe_plate -------------------------------------------------------


def test_describe_plate_prefers_slot_name():
    assert describe_plate("Bracket", ("a",), 1) == "Bracket"


def test_describe_plate_dedupes_and_skips_blank_objects():
    assert (
        describe_plate("  ", ("a & <b>", "", "a & <b>", "Würfel"), 2)
        == "a & <b>, Würfel"
    )


def test_describe_plate_truncates_to_120_chars():
    text = describe_plate("", tuple(f"object-{i:03d}" for i in range(30)), 1)
    assert len(text) == 120
    assert text.endswith("…")


def test_describe_plate_falls_back_to_plate_index():
    assert describe_plate("", (), 3) == "Plate 3"
    assert describe_plate("", (" ",), 4) == "Plate 4"
