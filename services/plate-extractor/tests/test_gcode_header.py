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


def _config_block(body: str) -> str:
    return (
        "; HEADER_BLOCK_START\n; total estimated time: 1h 0m 0s\n; HEADER_BLOCK_END\n"
        f"; CONFIG_BLOCK_START\n{body}; CONFIG_BLOCK_END\n"
    )


def test_printer_model_deep_in_config_block_is_read():
    filler = "".join(f"; key_{i} = value\n" for i in range(900))
    text = _config_block(filler + "; printer_model = Bambu Lab X1C\n")
    assert text.count("\n") > 900
    header = parse_gcode_header(text)
    assert header.printer_model == "Bambu Lab X1C"
    assert header.total_time_s == 3600


def test_scan_stops_at_config_block_end():
    text = _config_block('; filament_settings_id = "A"\n') + (
        "; total filament weight [g] : 1.0\n; printer_model = Late\n"
    )
    header = parse_gcode_header(text)
    assert header.profiles == ("A",)
    assert header.weight_g is None
    assert header.printer_model is None


def test_lines_far_beyond_scan_window_are_ignored_without_block_end():
    from plate_extractor import gcode_header

    text = "G1 X0\n" * (gcode_header.MAX_SCAN_CHARS // 6 + 10)
    text += "; total filament weight [g] : 1.0\n"
    assert parse_gcode_header(text).weight_g is None


def test_crlf_lines():
    text = '; printer_model = Bambu Lab P1S\r\n; filament_settings_id = "A"\r\n'
    header = parse_gcode_header(text)
    assert header.printer_model == "Bambu Lab P1S"
    assert header.profiles == ("A",)


class _NoSplitlines(str):
    def splitlines(self, *args, **kwargs):  # pragma: no cover - must not run
        raise AssertionError("splitlines() over the whole gcode")


def test_does_not_split_the_whole_text():
    text = _NoSplitlines("; printer_model = P\n" + "G1 X0\n" * 1000)
    assert parse_gcode_header(text).printer_model == "P"


def test_header_fields_from_fixture_head_only(multi_plate_bytes):
    from plate_extractor.archive import read_entry_head

    zf = open_archive(multi_plate_bytes)
    head = read_entry_head(zf, "Metadata/plate_1.gcode")
    assert 0 < len(head) <= 512 * 1024
    header = parse_gcode_header(head.decode("utf-8", "replace"))
    assert header.printer_model == "Bambu Lab P1S"
    assert header.profiles == ("Sunlu PLA - Calibrated",)
    assert header.total_time_s == 4738
