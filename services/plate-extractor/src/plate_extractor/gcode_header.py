"""Read the comment header of a Bambu Studio plate gcode file."""

from __future__ import annotations

import re
from dataclasses import dataclass
from itertools import islice

_MAX_LINES = 400
_TIME_RE = re.compile(r"total estimated time:\s*([0-9dhms ]+)")
_TIME_PART_RE = re.compile(r"(\d+)\s*([dhms])")
_UNIT_S = {"d": 86400, "h": 3600, "m": 60, "s": 1}
_WEIGHT_RE = re.compile(r"^;\s*total filament weight \[g\]\s*:\s*(\S+)")
_PRINTER_RE = re.compile(r"^;\s*printer_model\s*=\s*(.*)$")
_PROFILES_RE = re.compile(r"^;\s*filament_settings_id\s*=\s*(.*)$")
_QUOTED_RE = re.compile(r'"([^"]*)"')


@dataclass(frozen=True)
class GcodeHeader:
    total_time_s: int | None
    weight_g: float | None
    printer_model: str | None
    profiles: tuple[str, ...]


def _parse_time(text: str) -> int | None:
    parts = _TIME_PART_RE.findall(text)
    if not parts:
        return None
    return sum(int(n) * _UNIT_S[u] for n, u in parts)


def parse_gcode_header(text: str) -> GcodeHeader:
    total_time_s: int | None = None
    weight_g: float | None = None
    printer_model: str | None = None
    profiles: tuple[str, ...] = ()

    for line in islice(text.splitlines(), _MAX_LINES):
        if total_time_s is None and (m := _TIME_RE.search(line)):
            total_time_s = _parse_time(m.group(1))
        elif weight_g is None and (m := _WEIGHT_RE.match(line)):
            try:
                value = float(m.group(1))
            except ValueError:
                continue
            if value == value and abs(value) != float("inf"):
                weight_g = value
        elif printer_model is None and (m := _PRINTER_RE.match(line)):
            printer_model = m.group(1).strip() or None
        elif not profiles and (m := _PROFILES_RE.match(line)):
            profiles = tuple(_QUOTED_RE.findall(m.group(1)))

    return GcodeHeader(total_time_s, weight_g, printer_model, profiles)
