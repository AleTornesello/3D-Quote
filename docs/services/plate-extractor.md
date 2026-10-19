# plate-extractor

- **Location:** `services/plate-extractor/` (uv workspace member `plate-extractor`, package `plate_extractor`)
- **Status:** Implemented and smoke-tested locally; not deployed, and nothing calls it yet (see
  [Open questions](#open-questions)).

## Responsibility

The plate-extractor reads a **sliced** `.gcode.3mf` archive (Bambu Studio / OrcaSlicer project exported after
slicing) and returns one entry per sliced plate: description, print time, filament per material, support flag
and thumbnail. The web app uses it to pre-fill quote plates instead of typing the figures by hand.

It does **not** slice anything, compute prices, talk to Supabase or store the upload. It is stateless: bytes in,
JSON out. It is unrelated to the paused [slicer-worker](slicer-worker.md), which would run a slicer on raw
models; this service only reads figures a slicer already wrote.

## Endpoints

### `POST /plates`

Multipart form with one field, `file`. Query parameter `include_thumbnails` (default `true`) sets every
`thumbnail` to `null` when `false`.

```bash
curl -F file=@tmp/multi_plate.gcode.3mf http://localhost:8081/plates
```

Response `200`:

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
  ],
  "warnings": []
}
```

| Field | Meaning |
|---|---|
| `source.*` | Slicer name and version and the printer model, from the archive. Hints only; each may be `null`. |
| `plates[].index` | Plate number in the project. Only **sliced** plates are returned (see below). |
| `plates[].description` | The plate name if not blank, else the object names joined by `", "` (deduplicated, skipped objects excluded, capped at 120 characters), else `Plate N`. Never blank. |
| `plates[].print_time_s` | Integer seconds, the slicer's full estimate (the figure the printer shows). |
| `plates[].quantity` | Always `1` (see [Not extracted](#deliberately-not-extracted)). |
| `plates[].support_used` | Whether the slicer generated supports for the plate. |
| `plates[].materials[]` | One row per filament actually used: `type`, `color` (`#RRGGBB` or `null`), `profile` (slicer profile name, a hint or `null`) and `grams` (rounded to 2 decimals, supports and purge included). Filaments with 0 g are dropped. |
| `plates[].thumbnail` | `data:image/png;base64,…` of the plate preview, or `null`. |
| `warnings[]` | Human-readable notes about plates left out, e.g. `Plate 3 skipped: no print time`. A plate with no gcode, no print time or no material is skipped and listed here instead of being returned incomplete. |

A plate is returned only if it is listed in `slice_info.config`. A project can have more plate slots than sliced
plates: the single-plate sample has 4 slots but one sliced plate, and the service returns 1 plate, not 4.

### `GET /healthz`

Returns `200 {"status": "ok"}`. For container health checks.

## Errors

Every error is `{"error": {"code": "...", "message": "..."}}`.

| Status | `code` | When |
|---|---|---|
| `400` | `not_a_3mf` | The upload is not a zip, or an entry read from it is invalid or malformed XML. |
| `422` | `not_sliced` | A valid archive with no sliced plate: no `slice_info.config` (an unsliced project), no plate listed in it, or every plate skipped (the message then lists the warnings). |
| `413` | `file_too_large` | The upload exceeds `MAX_UPLOAD_MB`. |

There is no separate `unsupported_slicer` error: an archive without `slice_info.config` (for example from a
slicer that stores its metadata differently) is reported as `not_sliced`.

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MAX_UPLOAD_MB` | no | `50` | Largest upload the endpoint will read, in MB |

## Reading rules and limits

The upload is untrusted. The service reads only the named `Metadata/` entries (`slice_info.config`,
`model_settings.config`, the `plate_N.gcode` header, `plate_N.png`), never extracts the archive and never opens
`3D/3dmodel.model`. XML is parsed with `defusedxml`.

- Each entry read is capped at 20 MB. A **gcode or thumbnail entry over 20 MB is treated as missing**: the
  plate's `profile` values become `null` and its `thumbnail` becomes `null`. The plate itself is still returned
  from `slice_info.config`.
- `MAX_UPLOAD_MB` limits what the endpoint **parses**, not what the server **receives**. The web framework
  spools the whole multipart body to memory or a temporary file before the endpoint runs, so an oversized body
  is still received in full. The `Content-Length` check at the start of the request is only an early exit for
  honest clients. A production deployment must also enforce a body-size limit at the proxy in front of the
  service.

## Mapping a material to a `materials` row

The service returns what the slicer knew (`type`, `color`, `profile`); it does not know the shop's `materials`
table. The web app resolves a `material_id` for each returned material row:

1. Match `materials.type` equal to the returned `type` and `materials.color` equal to the returned `color`.
2. Exactly one match: use it. No match or several matches: leave `material_id` empty for the user to pick.
3. If a plate lists the same material twice (same `type` and `color`), merge the rows by summing `grams`.

`profile` (for example `Sunlu PLA - Calibrated`) is shown to the user as a hint and is not a match key.

## Deliberately not extracted

- **Quantity:** copies are not stored in the file; they are set on the printer or in the quote. Always `1`.
- **Printer:** the file gives a Bambu model code or name, not one of the shop's printers. Returned only as
  `source.printer_model`; the quote's printer is chosen in the UI.
- **Layer height and infill:** the quote has no field for them and prices only time and grams.

## Smoke test (2026-10-19)

`uvicorn` is not a project dependency, so it is added on the fly:

```bash
uv run --package plate-extractor --with uvicorn uvicorn plate_extractor.api:app --port 8081
curl -F file=@tmp/multi_plate.gcode.3mf http://localhost:8081/plates
```

Both samples are from BambuStudio 02.08.02.61, printer Bambu Lab P1S, one PLA filament `#000000`
(`Sunlu PLA - Calibrated`); `warnings` was empty and `support_used` false for all plates.

| Sample | HTTP | Plates | `print_time_s` | `grams` |
|---|---|---|---|---|
| `multi_plate.gcode.3mf` | 200 | 4 | 4738, 5723, 4725, 5105 | 39.12, 34.09, 28.13, 24.82 |
| `single_plate.gcode.3mf` | 200 | 1 (of 4 slots) | 4738 | 39.12 |

A non-archive upload (a text file) returned `400 not_a_3mf`. `include_thumbnails=false` returned
`thumbnail: null`.

## Running locally

```bash
uv run --package plate-extractor pytest
uv run --package plate-extractor --with uvicorn uvicorn plate_extractor.api:app --port 8081
```

## Open questions

- **Hosting and auth:** where the service runs and how the web app or an Edge Function reaches it (proxy via a
  Supabase Edge Function or directly from the browser), and the proxy body-size limit above.
- **Web upload UI:** the screen that calls the service and pre-fills the plate cards, including the material
  matching UX.
- **Other slicers:** only Bambu Studio 02.08 output has been tested. PrusaSlicer and OrcaSlicer use different
  metadata keys; support needs a real sample. Multi-colour (several filaments) and skipped objects are covered
  by synthetic tests only.
- **Plain `.gcode` and unsliced `.3mf`:** would need a slicer run (the paused slicer-worker).
