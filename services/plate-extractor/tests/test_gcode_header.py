from plate_extractor.archive import open_archive, read_entry
from plate_extractor.gcode_header import GcodeHeader, parse_gcode_header


def test_multi_plate_1_header(multi_plate_bytes):
    zf = open_archive(multi_plate_bytes)
    text = read_entry(zf, "Metadata/plate_1.gcode").decode("utf-8", "replace")
    header = parse_gcode_header(text)
    assert header.total_time_s == 4738
    assert header.weight_g == 39.12
    assert header.printer_model == "Bambu Lab P1S"
    assert header.profiles == ("Sunlu PLA - Calibrated",)


def test_time_with_days_hours_minutes_seconds():
    assert parse_gcode_header("; total estimated time: 2d 3h 4m 5s\n").total_time_s == 183845


def test_time_with_seconds_only():
    assert parse_gcode_header("; total estimated time: 45s\n").total_time_s == 45


def test_multiple_profiles():
    header = parse_gcode_header('; filament_settings_id = "A";"B"\n')
    assert header.profiles == ("A", "B")


def test_empty_text():
    assert parse_gcode_header("") == GcodeHeader(None, None, None, ())


def test_only_first_400_lines_are_read():
    text = "\n" * 400 + "; total filament weight [g] : 1.0\n"
    assert parse_gcode_header(text).weight_g is None
