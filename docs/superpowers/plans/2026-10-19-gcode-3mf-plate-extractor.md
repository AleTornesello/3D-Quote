# gcode.3mf Plate Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python service that takes a sliced `.gcode.3mf` (Bambu Studio / OrcaSlicer) and returns a JSON array of plates shaped for the quote detail page (description, print time, quantity, materials with grams).

**Architecture:** A pure parsing library (`parse_plates(bytes) -> list[Plate]`) reads the 3MF zip: `Metadata/slice_info.config` (per-plate time, weight, filaments, objects), `Metadata/model_settings.config` (plate list, gcode presence, thumbnail path) and, as a fallback, the `plate_N.gcode` header. A thin FastAPI app exposes it as `POST /plates` (multipart upload). The service does no pricing and no database access; matching the returned filaments to catalog `materials` rows happens in the web app.

**Tech Stack:** Python ≥ 3.12, uv workspace member, `zipfile` + `xml.etree` (stdlib, see Global Constraints on XML safety), FastAPI + `python-multipart`, pytest + httpx.

**Spec:** none written; this plan is derived from the analysis below plus `docs/superpowers/specs/2026-10-16-quote-plates-design.md` (the plate model) and `docs/services/slicer-worker.md` (the service conventions).

## Analysis of the sample files (`tmp/`)

Both samples come from BambuStudio 02.08.02.61, printer P1S, 0.4 nozzle. The zip is flat; everything useful is under `Metadata/`.

| File | Content | Used? |
|---|---|---|
| `Metadata/slice_info.config` | XML. One `<plate>` per **sliced** plate: `index`, `prediction` (seconds, = "total estimated time" in the gcode header: 4738 = 1h18m58s), `weight` (g, supports + purge included), `support_used`, `<object name= skipped=>` list, `<filament id type color used_g used_m>` list | **Primary source** |
| `Metadata/model_settings.config` | XML. One `<plate>` per plate **slot**, sliced or not: `plater_id`, `plater_name` (empty in both samples), `gcode_file` (empty when not sliced), `thumbnail_file` | Plate list, name, thumbnail |
| `Metadata/plate_N.gcode` | ~3 MB. Header lines `; total estimated time: 1h 18m 58s`, `; total filament weight [g] : 39.12`, `; filament_type`, `; filament_colour`, `; filament_settings_id = "Sunlu PLA - Calibrated"` | Fallback / filament name only |
| `Metadata/plate_N.json` | bbox, object names, `filament_colors` (**empty** for unsliced plates) | Not needed |
| `Metadata/plate_N.png` | Plate thumbnail | Optional output (`thumbnail`) |
| `3D/3dmodel.model` | Mesh + project `Description` (HTML, double-escaped) | Ignored (huge, not needed) |

Findings that drive the design:

1. **`single_plate.gcode.3mf` has 4 plate slots but only 1 is sliced.** `model_settings.config` lists plates 1–4 (`gcode_file=""` for 2–4) while `slice_info.config` holds only plate 1 and only `plate_1.gcode` exists. The service must return **1** plate, not 4. Rule: a plate is returned iff it has a `<plate>` in `slice_info.config` (cross-check: its `gcode_file` is non-empty).
2. **`multi_plate.gcode.3mf` has 4 sliced plates**, each with its own time, weight and object names (`Würfel Tray 16X20`, `…16X16`, `…16X12`, `…12X20`).
3. **`plater_name` is empty** in both samples, so the description must be derived: plate name if non-blank, else the object names joined by `", "` (deduplicated, skipped objects excluded, capped at 120 chars), else `"Plate N"`. The quote-plates spec requires a non-blank description.
4. **Time:** `prediction` is the full estimate (includes heating/filament changes) and is what the printer shows; it maps to `print_time_s`. Do not use the "model printing time" gcode figure.
5. **Grams:** `<filament used_g>` per filament; the plate `weight` equals the sum (39.12 = 39.12). Per-filament `used_g` already includes supports/purge, which matches "supports included" in `quote_plate_materials.grams`. Filaments with `used_g == 0` (declared but unused in multi-colour projects) must be dropped, since `grams > 0` is a DB check.
6. **Material identity:** `type` (`PLA`), `color` (`#000000`) match `materials.type` / `materials.color`. The slicer profile name (`Sunlu PLA - Calibrated`) exists only in the gcode config block (`filament_settings_id`, a `;`-list of names in filament order) and is returned as a hint, not a match key.
7. **Quantity** is not in the file (copies are done on the printer/in the quote); the service returns `quantity: 1`.
8. **Printer:** `printer_model_id` is a Bambu code (`C12`), `printer_model` in the gcode is `Bambu Lab P1S`. Returned as a hint only; the quote's `printer_id` is chosen in the UI.
9. **Failure modes seen in the format:** an un-sliced `.3mf` (no `slice_info.config`, no gcode) is a valid zip but has nothing to extract; the same plate index can appear in a slice_info with `skipped="true"` objects; the sample archive paths contain spaces and non-ASCII (`Würfel`, `Model Pictures/…`), so everything must be read as UTF-8.

## Output contract

`POST /plates` (multipart field `file`) → `200`:

```json
{
  "source": { "slicer": "BambuStudio", "slicer_version": "02.08.02.61", "printer_model": "Bambu Lab P1S" },
  "plates": [
    {
      "index": 1,
      "description": "Würfel Tray 16X20, Würfel Tray Deckel, Würfel Tray Distanz",
      "print_time_s": 4738,
      "quantity": 1,
      "support_used": false,
      "materials": [
        { "type": "PLA", "color": "#000000", "profile": "Sunlu PLA - Calibrated", "grams": 39.12 }
      ],
      "thumbnail": "data:image/png;base64,…"
    }
  ]
}
```

`plates` maps 1:1 onto the web `QuotePlate` shape (`description`, `print_time_s`, `quantity`, material rows needing a `material_id` the web app resolves from `type`+`color`). `thumbnail` is `null` when `include_thumbnails=false` (query param, default `true`).
Errors (JSON `{"error": {"code": "...", "message": "..."}}`): `400 not_a_3mf` (not a zip), `422 not_sliced` (no sliced plate found), `413 file_too_large`, `422 unsupported_slicer` (no `slice_info.config` but other plate data present).

## Global Constraints

- Branch `develop`; commit after each task; never push or merge to `main` unless asked (project memory).
- New uv workspace member under `services/` (`members = ["services/*", …]` already globs it); package name `plate-extractor`, import name `plate_extractor`; Python ≥ 3.12; build backend `uv_build` like `slicer-worker`.
- The upload is **untrusted**: read only the named `Metadata/*` entries (never `extractall`); never read `3D/3dmodel.model`; cap each entry read at 20 MB and the whole upload at `MAX_UPLOAD_MB` (default 50); reject zip entries whose uncompressed size exceeds the cap (zip bomb); parse XML with `defusedxml`, not bare `xml.etree`.
- Pure parsing code does no I/O beyond the bytes it is given; no network, no database, no Supabase keys.
- Weights are `Decimal`-safe on output: round to 2 decimals; time is an `int` of seconds.
- Drop materials with `grams <= 0`; never emit a plate with `print_time_s <= 0` or without any material (it would be incomplete in the quote anyway) — such plates are skipped and listed in `warnings`.
- Python tests run with `uv run --package plate-extractor pytest`; run any Python that reads sample archives with `-I`.
- Sample fixtures are copied (not referenced) into `services/plate-extractor/tests/fixtures/`; the full 2.4–3.4 MB archives are **not** committed — a fixture builder script strips `3D/`, `Auxiliaries/` and the `.gcode` bodies (keeping the first 200 lines of each gcode header).

## Review Focus

- `single_plate.gcode.3mf` (4 slots, 1 sliced) returns exactly 1 plate, not 4.
- Plate with empty `plater_name` gets a description from object names; object names with `&`, `<`, non-ASCII are returned unescaped and intact.
- A `.3mf` that was never sliced (no `slice_info.config`) → `422 not_sliced`, not a 500.
- A random non-zip upload and a zip with a path-traversal entry name (`../../x`) → clean 400 / ignored entry, nothing written to disk.
- Multi-filament plate with a declared filament `used_g="0.00"` → that filament is omitted; two filaments of the same type+colour stay two rows (the service does not merge); the web merges them per material because `(plate_id, material_id)` is unique, and the doc in Task 7 says so.
- Decimal-comma or missing attributes in `slice_info.config` (`weight` absent) → falls back to summing filament grams, then to the gcode header, else the plate is skipped with a warning.

## File Structure

- Create `services/plate-extractor/pyproject.toml`, `README.md`
- Create `services/plate-extractor/src/plate_extractor/__init__.py` — version
- Create `services/plate-extractor/src/plate_extractor/models.py` — dataclasses `Material`, `Plate`, `ExtractResult`
- Create `services/plate-extractor/src/plate_extractor/archive.py` — safe zip access (`open_archive`, `read_entry`)
- Create `services/plate-extractor/src/plate_extractor/slice_info.py` — parse `slice_info.config`
- Create `services/plate-extractor/src/plate_extractor/model_settings.py` — parse `model_settings.config`
- Create `services/plate-extractor/src/plate_extractor/gcode_header.py` — parse the gcode header/config block
- Create `services/plate-extractor/src/plate_extractor/extract.py` — `parse_plates` (merges the sources)
- Create `services/plate-extractor/src/plate_extractor/api.py` — FastAPI app, config, error mapping
- Tests in `services/plate-extractor/tests/` (`conftest.py`, one test file per module, `fixtures/`, `tools/build_fixtures.py`)
- Modify `docs/services/` (new `plate-extractor.md`), `docs/README.md`, `docs/architecture/overview.md` (open questions), root `README.md` layout is unchanged.

---

### Task 1: Service skeleton and trimmed fixtures

**Files:**
- Create: `services/plate-extractor/{pyproject.toml,README.md}`, `src/plate_extractor/{__init__.py,models.py}`
- Create: `services/plate-extractor/tests/tools/build_fixtures.py`, `tests/conftest.py`, `tests/fixtures/{single_plate,multi_plate}.gcode.3mf`
- Test: `services/plate-extractor/tests/test_fixtures.py`

**Interfaces:**
- Produces (`models.py`):
  - `@dataclass(frozen=True) class Material: type: str; color: str | None; profile: str | None; grams: float`
  - `@dataclass(frozen=True) class Plate: index: int; description: str; print_time_s: int; quantity: int; support_used: bool; materials: tuple[Material, ...]; thumbnail: bytes | None`
  - `@dataclass(frozen=True) class ExtractResult: slicer: str | None; slicer_version: str | None; printer_model: str | None; plates: tuple[Plate, ...]; warnings: tuple[str, ...]`
- Produces (`conftest.py`): fixtures `single_plate_bytes: bytes`, `multi_plate_bytes: bytes`, and `make_3mf(entries: dict[str, bytes | str]) -> bytes` that builds an in-memory zip.

- [ ] **Step 1: Write the failing test** — `test_fixtures.py::test_trimmed_fixtures_keep_sources` asserts both fixtures open as zips, contain `Metadata/slice_info.config`, `Metadata/model_settings.config`, `Metadata/plate_1.gcode`, do **not** contain `3D/3dmodel.model`, and each is < 300 KB.
- [ ] **Step 2: Run** `uv run --package plate-extractor pytest services/plate-extractor/tests/test_fixtures.py -v` → FAIL (package/fixtures missing).
- [ ] **Step 3: Create the package** (`pyproject.toml` with dependencies `fastapi`, `python-multipart`, `defusedxml`; dev group `pytest`, `httpx`; `uv_build` backend), the three dataclasses, and `tests/tools/build_fixtures.py` which reads `tmp/*.gcode.3mf` and writes trimmed copies (keep `Metadata/{slice_info.config,model_settings.config,plate_N.json,plate_N.png,plate_N.gcode(first 200 lines)}`; drop everything else). Run it once and commit the output. Run `uv sync` and commit the updated `uv.lock`.
- [ ] **Step 4: Run** the test from Step 2 → PASS.
- [ ] **Step 5: Commit** `feat(plate-extractor): skeleton and trimmed 3mf fixtures`.

### Task 2: Safe archive access

**Files:**
- Create: `src/plate_extractor/archive.py`
- Test: `tests/test_archive.py`

**Interfaces:**
- Consumes: `make_3mf` from Task 1.
- Produces:
  - `class NotA3mfError(ValueError)`
  - `def open_archive(data: bytes) -> zipfile.ZipFile` — raises `NotA3mfError` when not a zip
  - `def read_entry(zf: zipfile.ZipFile, name: str, max_bytes: int = 20_000_000) -> bytes | None` — `None` when the entry is absent; raises `NotA3mfError` when its declared uncompressed size exceeds `max_bytes`; only exact names, never paths with `..` or a leading `/`.

- [ ] **Step 1: Write failing tests:** `test_non_zip_raises` (`open_archive(b"hello")`), `test_missing_entry_is_none`, `test_oversized_entry_rejected` (entry declared > cap), `test_traversal_name_is_refused` (`read_entry(zf, "../x")` returns `None`/raises, nothing touches disk), `test_reads_utf8_path_with_spaces` (`"Auxiliaries/Model Pictures/Würfel.webp"`).
- [ ] **Step 2: Run** → FAIL. 
- [ ] **Step 3: Implement** `open_archive` / `read_entry` with the signatures above using `zipfile.ZipFile(io.BytesIO(data))` and `ZipInfo.file_size` for the cap check.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(plate-extractor): safe 3mf archive reader`.

### Task 3: Parse `slice_info.config`

**Files:**
- Create: `src/plate_extractor/slice_info.py`
- Test: `tests/test_slice_info.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class SlicedFilament: id: int; type: str; color: str | None; used_g: float`
  - `@dataclass(frozen=True) class SlicedPlate: index: int; prediction_s: int | None; weight_g: float | None; support_used: bool; objects: tuple[str, ...]; filaments: tuple[SlicedFilament, ...]`
  - `@dataclass(frozen=True) class SliceInfo: slicer: str | None; slicer_version: str | None; plates: tuple[SlicedPlate, ...]`
  - `def parse_slice_info(xml: bytes) -> SliceInfo` — XML via `defusedxml.ElementTree`; objects with `skipped="true"` excluded; missing/garbled numbers become `None` (not an exception); `X-BBL-Client-Type`/`X-BBL-Client-Version` header items give slicer and version (`"BambuStudio"` when client type is `slicer` and version has the `02.` shape is **not** inferred — report the raw values).

- [ ] **Step 1: Write failing tests** against the two fixtures' `slice_info.config`: single → 1 plate, `prediction_s == 4738`, `weight_g == 39.12`, objects `("Würfel Tray 16X20", "Würfel Tray Deckel", "Würfel Tray Distanz")`, one filament `PLA #000000 39.12`; multi → 4 plates with `prediction_s` `[4738, 5723, 4725, 5105]` and weights `[39.12, 34.09, 28.13, 24.82]`. Plus inline-XML cases: skipped object excluded; `weight="abc"` → `None`; entity-expansion payload (billion laughs) raises `defusedxml` error mapped to `ValueError`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `parse_slice_info` and the three dataclasses as above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(plate-extractor): parse slice_info.config`.

### Task 4: Parse `model_settings.config` and the gcode header

**Files:**
- Create: `src/plate_extractor/model_settings.py`, `src/plate_extractor/gcode_header.py`
- Test: `tests/test_model_settings.py`, `tests/test_gcode_header.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class PlateSlot: index: int; name: str; has_gcode: bool; thumbnail_path: str | None`
  - `def parse_model_settings(xml: bytes) -> tuple[PlateSlot, ...]` — `index = plater_id`, `name = plater_name.strip()`, `has_gcode = bool(gcode_file)`.
  - `@dataclass(frozen=True) class GcodeHeader: total_time_s: int | None; weight_g: float | None; printer_model: str | None; profiles: tuple[str, ...]`
  - `def parse_gcode_header(text: str) -> GcodeHeader` — reads only the first ~400 lines; `; total estimated time: 1h 18m 58s` → seconds (supports `d`, `h`, `m`, `s` parts, any subset); `; total filament weight [g] : 39.12`; `; printer_model = Bambu Lab P1S`; `; filament_settings_id = "A";"B"` → `("A", "B")`.

- [ ] **Step 1: Write failing tests:** model_settings single fixture → 4 slots, only slot 1 `has_gcode`; multi → 4 with `has_gcode`; gcode header of multi plate 1 → `total_time_s == 4738`, `weight_g == 39.12`, `printer_model == "Bambu Lab P1S"`, `profiles == ("Sunlu PLA - Calibrated",)`; `"2d 3h 4m 5s"` → `183845`; `"45s"` → `45`; empty text → all `None`/`()`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both parsers with the signatures above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(plate-extractor): parse model_settings and gcode header`.

### Task 5: Merge into plates — `parse_plates`

**Files:**
- Create: `src/plate_extractor/extract.py`
- Test: `tests/test_extract.py`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `class NotSlicedError(ValueError)`
  - `def parse_plates(data: bytes, *, include_thumbnails: bool = True) -> ExtractResult`
  - `def describe_plate(slot_name: str, objects: tuple[str, ...], index: int) -> str` — slot name if non-blank; else deduplicated non-blank object names joined by `", "`, truncated to 120 chars with `…`; else `f"Plate {index}"`.

Algorithm (not determined by the signature): open archive → `parse_slice_info` (absent entry ⇒ `NotSlicedError`); `parse_model_settings` for names/thumbnails (absent ⇒ no slots); for each `SlicedPlate` whose slot (if any) has a gcode: `print_time_s = prediction_s`, falling back to `gcode_header.total_time_s` read from `Metadata/plate_N.gcode`; materials from filaments with `used_g > 0`, `profile` taken positionally from `GcodeHeader.profiles` by filament `id - 1` when available; if no filament rows, fall back to one row from header weight + `type`/`color` unknown → skipped with warning. Plates lacking time or materials are omitted and named in `warnings`; zero resulting plates ⇒ `NotSlicedError`.

- [ ] **Step 1: Write failing tests:** `test_single_plate_file_returns_only_sliced_plate` (1 plate, index 1, `print_time_s == 4738`, `quantity == 1`, material `PLA #000000 39.12` with profile `"Sunlu PLA - Calibrated"`, description `"Würfel Tray 16X20, Würfel Tray Deckel, Würfel Tray Distanz"`); `test_multi_plate_file_returns_four_plates_in_order` (times/weights as in Task 3, indices 1..4); `test_named_plate_uses_plater_name` (built with `make_3mf`); `test_zero_gram_filament_dropped`; `test_unsliced_3mf_raises_not_sliced` (zip with only `3D/3dmodel.model`); `test_time_falls_back_to_gcode_header` (slice_info without `prediction`); `test_plate_without_time_or_material_is_warned_not_returned`; `test_thumbnail_toggle` (`include_thumbnails=False` ⇒ `thumbnail is None`, `True` ⇒ PNG bytes starting `\x89PNG`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `parse_plates` and `describe_plate` per the algorithm; round grams to 2 decimals.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(plate-extractor): build plates from a sliced 3mf`.

### Task 6: HTTP API

**Files:**
- Create: `src/plate_extractor/api.py`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `parse_plates`, `NotA3mfError`, `NotSlicedError`.
- Produces: `app: FastAPI` with
  - `POST /plates` — multipart `file`; query `include_thumbnails: bool = True`; response exactly as in "Output contract" (thumbnail as `data:image/png;base64,…` or `null`); runs the CPU-bound parse in a threadpool (sync `def` endpoint).
  - `GET /healthz` → `{"status": "ok"}`.
  - `def create_app(max_upload_mb: int | None = None) -> FastAPI`; env `MAX_UPLOAD_MB` default `50`, read in `create_app`. Upload size enforced while reading (stop at the cap; `413 file_too_large`) rather than after buffering the whole body.
  - Error mapping: `NotA3mfError` → `400 not_a_3mf`; `NotSlicedError` → `422 not_sliced`; oversize → `413 file_too_large`.

- [ ] **Step 1: Write failing tests** with `TestClient`: multi fixture → 200 and 4 plates with the contract keys; single fixture → exactly 1 plate; `include_thumbnails=false` → `thumbnail` null; `b"not a zip"` → 400 `not_a_3mf`; unsliced zip → 422 `not_sliced`; body larger than `create_app(max_upload_mb=1)` → 413; missing `file` field → 422 (FastAPI default); `/healthz` → 200.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `create_app` / `app` as above.
- [ ] **Step 4: Run** → `uv run --package plate-extractor pytest services/plate-extractor -v` all PASS.
- [ ] **Step 5: Commit** `feat(plate-extractor): POST /plates endpoint`.

### Task 7: Run it, document it, wire the contract to the web shape

**Files:**
- Create: `docs/services/plate-extractor.md`; Modify: `docs/README.md`, `docs/architecture/overview.md` (open question about uploads: link the new service), `services/plate-extractor/README.md`
- Create (optional, only if infra/docker is used for services): `infra/docker/plate-extractor.Dockerfile`

- [ ] **Step 1: Smoke test against the real samples:** `uv run --package plate-extractor uvicorn plate_extractor.api:app --port 8081` then `curl -F file=@tmp/multi_plate.gcode.3mf http://localhost:8081/plates` → 4 plates, times `[4738, 5723, 4725, 5105]`; same with `tmp/single_plate.gcode.3mf` → 1 plate. Record both outputs' key figures in the doc.
- [ ] **Step 2: Write `docs/services/plate-extractor.md`:** responsibility, endpoint contract, error codes, config (`MAX_UPLOAD_MB`), how the web app should map a returned material to a `materials` row (match `type` + `color`; when none or several match, leave `material_id` empty for the user to pick; merge duplicate materials by summing grams), what is deliberately not extracted (quantity, printer, layer height, infill) and why. Add to the `docs/README.md` index; state in `slicer-worker.md` that it stays paused and is unrelated.
- [ ] **Step 3: Commit** `docs: plate-extractor service`.

## Out of scope / follow-ups (each its own plan)

- Web upload UI that calls the service and pre-fills `PlateCard` (including the material-matching UX and where the service is hosted: Supabase Edge Function proxy vs. direct from the browser).
- Hosting/deploy of the service and auth between web/Edge Function and the service.
- Support for non-Bambu `.gcode.3mf` (PrusaSlicer, OrcaSlicer use different metadata keys) — only add once a sample file exists.
- Plain `.gcode` input and unsliced `.3mf` (would need running the slicer — the paused `slicer-worker`).

## Self-review notes

- Spec coverage: input `.gcode.3mf` ✓ (T2–T6), plates array for quote detail ✓ (contract, T5–T6), both samples ✓ (T1, T5, T6, T7), single-plate-file-with-4-slots trap ✓ (T5 test).
- Types consistent: `Material`/`Plate`/`ExtractResult` defined in T1 and used unchanged in T5–T6; `SlicedPlate`/`PlateSlot`/`GcodeHeader` defined in T3–T4 and consumed in T5.
- Known uncertainty: only P1S/BambuStudio 02.08 samples were available; multi-colour (several `<filament>` rows, AMS) and `skipped="true"` objects are covered by synthetic `make_3mf` tests, not by real files. Ask for a real multi-colour sample before relying on it.
