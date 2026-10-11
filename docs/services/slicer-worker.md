# slicer-worker

- **Location:** `services/slicer-worker/` (uv workspace member `slicer-worker`, package `slicer_worker`)
- **Status:** Skeleton — the package exists but the worker is not implemented yet. Contracts below are proposed.

## Responsibility

The slicer-worker turns a model file into print metrics. It:

1. consumes slicing jobs from the `slicing_jobs` pgmq queue;
2. downloads the model from Supabase Storage;
3. runs a headless slicer CLI with the chosen printer, material and settings;
4. writes print time, filament usage and related metrics back to Postgres.

It does **not** compute prices, talk to the web app, or decide what to slice. Pricing happens in Supabase (see
[architecture overview](../architecture/overview.md)).

## Job message (proposed)

Sent to the `slicing_jobs` queue by the Edge Function that creates the quote item:

```json
{
  "job_id": 812,
  "quote_item_id": 344,
  "model_path": "127/344/bracket.stl",
  "printer_id": 2,
  "material_id": 5,
  "settings": {
    "layer_height_mm": 0.2,
    "infill_percent": 20,
    "supports": false
  }
}
```

`model_path` is the object path inside the private `models` bucket. The message carries ids, not printer or
material details: the worker loads the current printer and material rows
when it runs, so it always uses the profiles stored in the database.

## Output (proposed)

Written to the `slicing_jobs` row and copied onto the `quote_items` row (see [data model](../supabase/data-model.md)):

| Field | Type | Meaning |
|---|---|---|
| `print_time_s` | integer | Estimated print time for one copy, in seconds |
| `filament_g` | numeric | Filament for one copy, in grams |
| `filament_mm` | numeric | Filament for one copy, in millimetres |
| `layer_count` | integer | Number of layers |
| `bbox_x_mm`, `bbox_y_mm`, `bbox_z_mm` | numeric | Model bounding box after placement |
| `slicer_version` | text | Slicer name and version that produced the numbers |

## Processing loop

1. Read one message from `slicing_jobs` with a visibility timeout (`VISIBILITY_TIMEOUT_S`). If the queue is empty,
   wait `POLL_INTERVAL_S` and try again.
2. Mark the job `running`, record `started_at` and the attempt number.
3. Download the model into a temporary directory.
4. Load the printer and material rows and build the slicer profile from them plus the job's settings.
5. Run the slicer CLI (`SLICER_BIN`) in the temporary directory and parse its output.
6. On success: write the results, mark the job `succeeded`, record `finished_at`, delete the message.
7. On error: record the error message on the job.
   - If the message's read count is below `MAX_ATTEMPTS`, leave it — it reappears after the visibility timeout and
     is retried.
   - Otherwise mark the job `failed` and archive the message.
8. Always remove the temporary directory.

A job that runs longer than the visibility timeout would become visible to another reader, so the timeout must be
longer than the slowest expected slice.

## Configuration

All configuration comes from environment variables. Defaults are proposed.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | Supabase project URL (Storage downloads) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | Service-role key; never exposed to the browser |
| `DATABASE_URL` | yes | — | Direct Postgres connection string (pgmq and result writes) |
| `QUEUE_NAME` | no | `slicing_jobs` | pgmq queue to consume |
| `SLICER_BIN` | yes | — | Path to the slicer executable |
| `VISIBILITY_TIMEOUT_S` | no | `600` | Seconds a read message stays invisible to other readers |
| `MAX_ATTEMPTS` | no | `3` | Reads before a job is marked `failed` and archived |
| `POLL_INTERVAL_S` | no | `5` | Wait between reads when the queue is empty |

## HTTP surface

Only `GET /healthz` (FastAPI), returning `200` when the process is up and can reach the database. It exists for
container health checks; the worker takes no work over HTTP.

## Running locally

Not runnable yet: the package only defines `__version__`. To check that the workspace and package resolve:

```bash
uv run --package slicer-worker python -c "import slicer_worker; print(slicer_worker.__version__)"
```

## Open questions

- **Slicer and profiles:** PrusaSlicer or OrcaSlicer; whether profiles are bundled config files per printer and
  material, or generated from database rows at run time.
- **File formats:** STL and 3MF are planned; whether STEP should be accepted (it needs conversion to a mesh first).
- **Large models:** a hard time limit per slice, and a maximum file size.
- **Concurrency:** one job at a time per container, or several in parallel.
