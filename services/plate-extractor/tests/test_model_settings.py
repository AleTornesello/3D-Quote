import pytest

from plate_extractor.archive import open_archive, read_entry
from plate_extractor.model_settings import PlateSlot, parse_model_settings


def _load(data: bytes):
    zf = open_archive(data)
    return parse_model_settings(read_entry(zf, "Metadata/model_settings.config"))


def test_single_plate_fixture_only_slot_1_has_gcode(single_plate_bytes):
    slots = _load(single_plate_bytes)
    assert [s.index for s in slots] == [1, 2, 3, 4]
    assert [s.has_gcode for s in slots] == [True, False, False, False]
    assert slots[0].thumbnail_path == "Metadata/plate_1.png"


def test_multi_plate_fixture_all_have_gcode(multi_plate_bytes):
    slots = _load(multi_plate_bytes)
    assert len(slots) == 4
    assert all(s.has_gcode for s in slots)


def test_name_is_stripped_and_missing_thumbnail_is_none():
    xml = (
        b'<config><plate><metadata key="plater_id" value="7"/>'
        b'<metadata key="plater_name" value="  Bracket "/></plate></config>'
    )
    assert parse_model_settings(xml) == (
        PlateSlot(index=7, name="Bracket", has_gcode=False, thumbnail_path=None),
    )


@pytest.mark.parametrize(
    "xml",
    [
        b"<config><plate>",
        b'<!DOCTYPE x [<!ENTITY a "b">]><config>&a;</config>',
    ],
)
def test_malformed_or_hostile_xml_raises_value_error(xml):
    with pytest.raises(ValueError):
        parse_model_settings(xml)
