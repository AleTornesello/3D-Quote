"""Build trimmed .gcode.3mf fixtures from full sample archives in tmp/.

Usage (from repo root): python -I services/plate-extractor/tests/tools/build_fixtures.py
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parents[1] / "fixtures"
NAMES = ("single_plate", "multi_plate")
MAX_SIZE = 300 * 1024
KEEP_PREFIXES = ("; printer_model", "; filament_settings_id", "; filament_type", "; filament_colour")
KEEP_RE = re.compile(r"^Metadata/(slice_info\.config|model_settings\.config|plate_\d+\.(json|png|gcode))$")


def trim_gcode(data: bytes) -> bytes:
    lines = data.decode("utf-8", errors="replace").splitlines(keepends=True)
    end = next((i for i, ln in enumerate(lines) if ln.startswith("; HEADER_BLOCK_END")), None)
    if end is None:
        raise ValueError("HEADER_BLOCK_END not found")
    kept = lines[: end + 1]
    kept += [ln for ln in lines[end + 1 :] if ln.startswith(KEEP_PREFIXES)]
    return "".join(kept).encode("utf-8")


def build(src: Path, dst: Path, keep_png: bool) -> None:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if not KEEP_RE.match(info.filename):
                continue
            if info.filename.endswith(".png") and not keep_png:
                continue
            data = zin.read(info.filename)
            if info.filename.endswith(".gcode"):
                data = trim_gcode(data)
            zout.writestr(info.filename, data)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        src = ROOT / "tmp" / f"{name}.gcode.3mf"
        dst = OUT / f"{name}.gcode.3mf"
        build(src, dst, keep_png=True)
        if dst.stat().st_size >= MAX_SIZE:
            build(src, dst, keep_png=False)
        print(dst, dst.stat().st_size, file=sys.stderr)


if __name__ == "__main__":
    main()
