import pytest

from plate_extractor.archive import open_archive, read_entry
from plate_extractor.slice_info import SlicedFilament, parse_slice_info


def _load(data: bytes):
    zf = open_archive(data)
    return parse_slice_info(read_entry(zf, "Metadata/slice_info.config"))


def test_single_plate_fixture(single_plate_bytes):
    info = _load(single_plate_bytes)
    assert info.slicer == "BambuStudio"
    assert info.slicer_version == "02.08.02.61"
    assert len(info.plates) == 1
    plate = info.plates[0]
    assert plate.index == 1
    assert plate.prediction_s == 4738
    assert plate.weight_g == 39.12
    assert plate.support_used is False
    assert plate.objects == (
        "Würfel Tray 16X20",
        "Würfel Tray Deckel",
        "Würfel Tray Distanz",
    )
    assert plate.filaments == (SlicedFilament(1, "PLA", "#000000", 39.12),)


def test_multi_plate_fixture(multi_plate_bytes):
    info = _load(multi_plate_bytes)
    assert len(info.plates) == 4
    assert [p.prediction_s for p in info.plates] == [4738, 5723, 4725, 5105]
    assert [p.weight_g for p in info.plates] == [39.12, 34.09, 28.13, 24.82]


def _xml(body: str, header: str = "") -> bytes:
    return f"<config><header>{header}</header>{body}</config>".encode()


def test_skipped_object_excluded():
    info = parse_slice_info(
        _xml(
            '<plate><metadata key="index" value="1"/>'
            '<object name="a" skipped="false"/><object name="b" skipped="true"/>'
            "</plate>"
        )
    )
    assert info.plates[0].objects == ("a",)


def test_garbled_numbers_become_none():
    info = parse_slice_info(
        _xml(
            '<plate><metadata key="index" value="1"/>'
            '<metadata key="weight" value="abc"/>'
            '<metadata key="prediction" value="x"/>'
            '<filament id="1" type="PLA" used_g="zz"/></plate>'
        )
    )
    plate = info.plates[0]
    assert plate.weight_g is None
    assert plate.prediction_s is None
    assert plate.filaments[0].used_g == 0.0


def test_slicer_only_when_bbl_client_type_present():
    plain = parse_slice_info(_xml('<plate><metadata key="index" value="1"/></plate>'))
    assert plain.slicer is None and plain.slicer_version is None
    bbl = parse_slice_info(
        _xml(
            "<plate/>",
            '<header_item key="X-BBL-Client-Type" value="slicer"/>'
            '<header_item key="X-BBL-Client-Version" value="02.08.02.61"/>',
        )
    )
    assert bbl.slicer == "BambuStudio"
    assert bbl.slicer_version == "02.08.02.61"


def test_missing_or_garbled_index_falls_back_to_position():
    info = parse_slice_info(
        _xml(
            '<plate><metadata key="index" value="7"/></plate>'
            "<plate/>"
            '<plate><metadata key="index" value="abc"/></plate>'
        )
    )
    assert [p.index for p in info.plates] == [7, 2, 3]


def test_filament_without_usable_id_is_dropped():
    info = parse_slice_info(
        _xml(
            '<plate><metadata key="index" value="1"/>'
            '<filament type="PLA" used_g="1"/>'
            '<filament id="x" type="PLA" used_g="2"/>'
            '<filament id="2" type="PETG" used_g="3"/></plate>'
        )
    )
    assert info.plates[0].filaments == (SlicedFilament(2, "PETG", None, 3.0),)


def test_support_used_true():
    info = parse_slice_info(
        _xml('<plate><metadata key="support_used" value="true"/></plate>')
    )
    assert info.plates[0].support_used is True


def test_entity_expansion_rejected():
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa">'
        b'<!ENTITY b "&a;&a;&a;&a;">]><config>&b;</config>'
    )
    with pytest.raises(ValueError):
        parse_slice_info(bomb)


def test_malformed_xml_is_value_error():
    with pytest.raises(ValueError):
        parse_slice_info(b"<config><plate>")
