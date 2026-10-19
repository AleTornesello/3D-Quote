# slicer-worker

- **Location:** `services/slicer-worker/` (uv workspace member `slicer-worker`, package `slicer_worker`)
- **Status:** Paused — the package is a skeleton and nothing uses it. Its database side (the `slicing_jobs` queue
  and table, `enqueue_slicing_job`, the `worker_*` functions) was dropped on 2026-10-16 together with `quote_items`
  (migration `quote_plates_cutover`), when quote plates with hand-typed figures replaced quote items. The rest of
  this page describes that former design, kept for the coming upload system.

## Responsibility

The slicer-worker turns a model file into print metrics. It:

1. consumes slicing jobs from the `slicing_jobs` pgmq queue;
2. downloads the model from Supabase Storage;
3. runs a headless slicer CLI with the chosen printer, material and settings;
4. writes print time, filament usage and related metrics back to Postgres.

It does **not** compute prices, talk to the web app, or decide what to slice. Pricing happens in Supabase (see
[architecture overview](../architecture/overview.md)).

## Job message

Sent to the `slicing_jobs` queue by `private.enqueue_slicing_job` (called from `create_quote_item`,
`update_quote_item_settings` and `retry_slicing`), in the same transaction that inserts the job row (see
[architecture overview](../architecture/overview.md#data-flow)):

```json
{
  "job_id": 812,
  "quote_item_id": 344,
  "model_path": "127/0b0f6c1e-5d1a-4c4e-9a43-2f0f3b8e7d21/bracket.stl",
  "printer_id": 2,
  "material_id": 5,
  "settings": {
    "layer_height_mm": 0.2,
    "infill_percent": 20,
    "supports": false
  }
}
```

`model_path` is the object path inside the private `models` bucket (`{quote_id}/{upload_id}/{filename}`). The message carries ids, not printer or
material details: the worker loads the current printer and material rows
when it runs, so it always uses the profiles stored in the database.

## Output

Passed as `results` to `worker_complete_job`, which writes it to the `slicing_jobs` row and copies `print_time_s`,
`filament_g` and the bbox onto the `quote_items` row. `print_time_s`, `filament_g` and the bbox are required (see
[data model](../supabase/data-model.md)):

| Field | Type | Meaning |
|---|---|---|
| `print_time_s` | integer | Estimated print time for one copy, in seconds |
| `filament_g` | numeric | Filament for one copy, in grams |
| `filament_mm` | numeric | Filament for one copy, in millimetres |
| `layer_count` | integer | Number of layers |
| `bbox_x_mm`, `bbox_y_mm`, `bbox_z_mm` | numeric | Model bounding box after placement |
| `slicer_version` | text | Slicer name and version that produced the numbers |

## Processing loop

1. Call `worker_claim_job(VISIBILITY_TIMEOUT_S, MAX_ATTEMPTS)` (RPC, service role). It reads one message and marks
   its job `running` with `started_at` and the attempt number. Messages already read more than `MAX_ATTEMPTS` times
   (the worker died on every attempt) are failed and archived inside the function, which then reads the next one.
   No row means the queue is empty: wait `POLL_INTERVAL_S` and try again.
2. (Done by step 1.)
3. Download the model into a temporary directory.
4. Load the printer and material rows and build the slicer profile from them plus the job's settings.
5. Run the slicer CLI (`SLICER_BIN`) in the temporary directory and parse its output.
6. On success: `worker_complete_job(msg_id, job_id, results)` stores the results, copies them onto the item if this
   is still the item's newest job, and deletes the message — one transaction.
7. On error: `worker_fail_job(msg_id, job_id, error, final)` with `final = read_ct >= MAX_ATTEMPTS`. Not final: the
   job goes back to `queued` and the message reappears after the visibility timeout. Final: the job is `failed` and
   the message archived.
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

## HTTP surface (proposed)

Whether the worker needs an HTTP server at all is an open question (see
[architecture overview](../architecture/overview.md#open-questions)). If it does, the proposal is only `GET /healthz`
(FastAPI), returning `200` when the process is up and can reach the database. It exists for
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
