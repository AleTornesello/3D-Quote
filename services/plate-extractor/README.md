# plate-extractor

Python service that reads sliced `.gcode.3mf` archives (Bambu Studio / OrcaSlicer) and extracts
per-plate print time, filament usage, support flag and thumbnail.

Test fixtures in `tests/fixtures` are trimmed copies of real archives, regenerated with
`tests/tools/build_fixtures.py` from `tmp/*.gcode.3mf`.
