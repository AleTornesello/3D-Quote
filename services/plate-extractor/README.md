# plate-extractor

Python service that reads sliced `.gcode.3mf` archives (Bambu Studio / OrcaSlicer) and extracts
per-plate print time, filament usage, support flag and thumbnail.

- `POST /plates` (multipart field `file`, optional `include_thumbnails`) and `GET /healthz`.
- `MAX_UPLOAD_MB` (default 50) limits parsing, not the framework's spool: put a body-size limit at the proxy.
- Contract, errors, material mapping and limits: [docs/services/plate-extractor.md](../../docs/services/plate-extractor.md).

```bash
uv run --package plate-extractor pytest
uv run --package plate-extractor --with uvicorn uvicorn plate_extractor.api:app --port 8081
```

Test fixtures in `tests/fixtures` are trimmed copies of real archives, regenerated with
`tests/tools/build_fixtures.py` from `tmp/*.gcode.3mf`.
