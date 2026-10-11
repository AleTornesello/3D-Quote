# Monorepo Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the empty 3D-Quote repository into a monorepo (npm + uv workspaces, Supabase folder, docs tree) and write the first set of project documentation.

**Architecture:** One repository with `apps/` (JS, npm workspaces), `services/` and `libs/python/` (Python, uv workspace), `supabase/` (Supabase CLI project), `infra/` and `docs/`. No application code is generated; only workspace configuration, a minimal importable `slicer-worker` package, and Markdown docs.

**Tech Stack:** npm 11 workspaces, uv 0.8 workspace with `uv_build`, Python ≥ 3.12, Supabase (Postgres, Storage, Auth, Edge Functions, Queues/pgmq), React + Vite + TS (later).

**Spec:** `docs/superpowers/specs/2026-10-11-monorepo-structure-design.md`

## Global Constraints

- JS package manager is **npm** (workspaces); no pnpm/yarn files.
- Python workspace is **uv**; root `pyproject.toml` is virtual with `members = ["services/*", "libs/python/*"]`.
- `slicer-worker`: `requires-python = ">=3.12"`, no dependencies, `src/` layout.
- `supabase/` lives at the repo root; do **not** run `supabase init`.
- Empty directories carry a `.gitkeep`.
- Documentation language: English.
- Undecided items are written as **Open question** entries, never guessed as facts.
- Out of scope: Vite app, FastAPI app, Edge Functions, CI/CD, lint/format config.
- Default branch is `main`.

## Review Focus

1. **uv glob vs `.gitkeep`** — `libs/python/*` must not make `uv lock` fail because of `libs/python/.gitkeep` or the lack of members. Pinned by Task 1 Step 6.
2. **npm workspace glob with no package** — `apps/*` matches `apps/web/` which has no `package.json`; `npm install` must still succeed. Pinned by Task 1 Step 7.
3. **`.env` vs `.env.example`** — real env files must be ignored, `.env.example` must stay tracked. Pinned by Task 1 Step 8.
4. **Empty dirs actually committed** — every skeleton directory must appear in `git ls-files`. Pinned by Task 1 Step 9.
5. **Broken relative links in docs** — every `](relative.md)` link in `docs/` and `README.md` must resolve. Pinned by Task 6 Step 2.

(Also: Windows checkout with CRLF would break future shell scripts and Dockerfiles in containers; a `.gitattributes` forcing LF is added in Task 1. It wasn't listed in the spec, but it's a one-line safety net.)

---

### Task 1: Repository skeleton and workspace configuration

**Files:**
- Create: `.gitignore`, `.gitattributes`, `.editorconfig`, `README.md`, `package.json`, `pyproject.toml`
- Create: `services/slicer-worker/pyproject.toml`, `services/slicer-worker/README.md`, `services/slicer-worker/src/slicer_worker/__init__.py`
- Create (`.gitkeep`): `apps/web/`, `services/slicer-worker/tests/`, `libs/python/`, `supabase/functions/`, `supabase/migrations/`, `infra/docker/`, `docs/product/`, `docs/architecture/adr/`, `docs/services/`, `docs/frontend/`, `docs/supabase/`, `docs/development/`

**Interfaces:**
- Produces: importable package `slicer_worker` with `__version__ = "0.1.0"`; uv workspace member named `slicer-worker`; `uv.lock` and `package-lock.json` at repo root.

- [ ] **Step 1: Set the default branch to `main`** (repo is unborn on `master`)

```bash
git symbolic-ref HEAD refs/heads/main
git status   # expect: "On branch main", "No commits yet"
```

- [ ] **Step 2: Create directories with `.gitkeep`**

```bash
for d in apps/web services/slicer-worker/tests libs/python supabase/functions supabase/migrations infra/docker docs/product docs/architecture/adr docs/services docs/frontend docs/supabase docs/development; do
  mkdir -p "$d" && touch "$d/.gitkeep"
done
```

- [ ] **Step 3: Write root config files**

`.gitignore`:
```gitignore
# Python
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.mypy_cache/
*.egg-info/

# Node
node_modules/
dist/
*.tsbuildinfo

# Supabase local state
supabase/.branches/
supabase/.temp/

# Env files
.env
.env.*
!.env.example

# OS / editor
.DS_Store
Thumbs.db
.idea/
.vscode/*
!.vscode/extensions.json
```

`.gitattributes`:
```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.stl binary
*.3mf binary
```

`.editorconfig`:
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

`package.json`:
```json
{
  "name": "3d-quote",
  "private": true,
  "workspaces": [
    "apps/*"
  ]
}
```

`pyproject.toml`:
```toml
[tool.uv.workspace]
members = ["services/*", "libs/python/*"]
```

- [ ] **Step 4: Write the `slicer-worker` package**

`services/slicer-worker/pyproject.toml`:
```toml
[project]
name = "slicer-worker"
version = "0.1.0"
description = "Runs a headless slicer on uploaded models to compute print time and filament usage."
readme = "README.md"
requires-python = ">=3.12"
dependencies = []

[build-system]
requires = ["uv_build>=0.8.3,<0.9.0"]
build-backend = "uv_build"
```

`services/slicer-worker/src/slicer_worker/__init__.py`:
```python
"""Slicer worker: consumes slicing jobs and reports print time and filament usage."""

__version__ = "0.1.0"
```

`services/slicer-worker/README.md`:
```markdown
# slicer-worker

Python service that consumes slicing jobs from the Supabase queue, runs a headless slicer
and writes print time and filament usage back to the database.

See [docs/services/slicer-worker.md](../../docs/services/slicer-worker.md).
```

- [ ] **Step 5: Write root `README.md`**

```markdown
# 3D-Quote

Internal tool for a 3D print shop: upload a client's model, estimate print time and material,
and produce a quote.

## Repository layout

| Path | What lives there |
|---|---|
| `apps/web/` | React + Vite + TypeScript web app (npm workspace) |
| `services/` | Python services (uv workspace members) |
| `libs/python/` | Shared Python packages (uv workspace members) |
| `supabase/` | Supabase project: SQL migrations and Edge Functions |
| `infra/` | Docker images and local infrastructure |
| `docs/` | Project documentation — start at [docs/README.md](docs/README.md) |

## Quick start

See [docs/development/getting-started.md](docs/development/getting-started.md).
```

- [ ] **Step 6: Verify the uv workspace resolves and the package imports**

```bash
uv lock
uv run --package slicer-worker python -c "import slicer_worker; print(slicer_worker.__version__)"
```
Expected: `uv lock` exits 0 and lists `slicer-worker`; the second command prints `0.1.0`.
If `uv lock` fails because the glob matches `libs/python/.gitkeep`, add `exclude = ["libs/python/.gitkeep"]` under `[tool.uv.workspace]` in the root `pyproject.toml` and re-run.

- [ ] **Step 7: Verify npm workspaces install**

```bash
npm install
```
Expected: exits 0, creates `package-lock.json`, no error about `apps/web` (it has no `package.json` yet).

- [ ] **Step 8: Verify ignore rules**

```bash
touch .env .env.local .env.example
git check-ignore -v .env .env.local          # expect both listed
git check-ignore .env.example; echo "exit=$?" # expect exit=1 (not ignored)
rm .env .env.local .env.example
```

- [ ] **Step 9: Stage and verify every skeleton dir is tracked**

```bash
git add -A
git ls-files | grep .gitkeep
```
Expected: 12 `.gitkeep` paths, matching the list in Step 2. `.venv/` and `node_modules/` must not appear in `git status`.

- [ ] **Step 10: Commit** (includes the already-written spec and this plan)

```bash
git commit -m "chore: set up monorepo skeleton with npm and uv workspaces"
```

---

### Task 2: Docs index and product overview

**Files:**
- Create: `docs/README.md`, `docs/product/overview.md`
- Delete: `docs/product/.gitkeep`

- [ ] **Step 1: Write `docs/README.md`** — the docs index. Content:
  - One-paragraph intro (what 3D-Quote is).
  - A table of sections linking to: `product/overview.md`, `architecture/overview.md`, `architecture/adr/`, `services/slicer-worker.md`, `supabase/data-model.md`, `frontend/` (note: "web app docs — added when the app is scaffolded"), `development/getting-started.md`, `superpowers/specs/`, `superpowers/plans/`.
  - A "Conventions" list: English; one topic per file; undecided items go under an `## Open questions` heading; architecture decisions are ADRs numbered `NNNN-kebab-title.md`.

- [ ] **Step 2: Write `docs/product/overview.md`** with these sections:
  - `## What it is` — internal tool for a 3D print shop to estimate cost and produce quotes for clients.
  - `## Users` — shop staff (operators/owner) only; clients do not log in. Quotes are sent to clients outside the tool.
  - `## Quoting workflow` — numbered: (1) staff create a quote for a client, (2) upload one or more model files (STL/3MF), (3) choose printer, material and print settings per item, (4) the system slices each model and returns print time and filament usage, (5) price is computed from those metrics plus material and machine rates, (6) staff review/adjust and mark the quote as sent.
  - `## Goals` — fast, consistent estimates based on real slicer output instead of guesswork; one place to keep printers, materials and rates.
  - `## Non-goals (for now)` — customer self-service portal, online payment, order/production tracking.
  - `## Glossary` — table: Quote, Quote item, Model file, Slicing, Slicing job, Print time, Filament usage, Material rate (cost per kg), Machine rate (cost per hour).
  - `## Open questions` — pricing formula (markup, setup fee, minimum price, failure-rate allowance); whether multi-color/multi-material prints are in scope; quote export format (PDF, email); in-browser 3D preview in v1.

- [ ] **Step 3: Remove `docs/product/.gitkeep` and commit**

```bash
git rm docs/product/.gitkeep
git add docs/README.md docs/product/overview.md
git commit -m "docs: add docs index and product overview"
```

---

### Task 3: Architecture overview and ADR-0001

**Files:**
- Create: `docs/architecture/overview.md`, `docs/architecture/adr/0001-monorepo-and-stack.md`
- Delete: `docs/architecture/adr/.gitkeep`

- [ ] **Step 1: Write `docs/architecture/overview.md`** with:
  - `## Components` — table: Web app (`apps/web`, React + Vite + TS, talks to Supabase via supabase-js); Supabase Postgres (data, pgmq queues); Supabase Storage (model files, private bucket `models`); Supabase Auth (staff accounts); Edge Functions (`supabase/functions`, create quote items, enqueue jobs, compute price); `slicer-worker` (`services/slicer-worker`, Python, consumes queue, runs slicer CLI).
  - `## Data flow` — a Mermaid `sequenceDiagram` with participants Web, Storage, EdgeFn, Postgres/pgmq, Worker: upload → create item + enqueue (same transaction) → worker `read` with visibility timeout → download model → slice → write results → `delete`/`archive` message → web sees status change (polling or Realtime).
  - `## Job lifecycle` — states `queued → running → succeeded | failed`; retry: message reappears after visibility timeout; after N attempts mark `failed` and archive.
  - `## Security` — worker uses service-role credentials and is never exposed publicly; web uses anon key + RLS restricted to authenticated staff.
  - `## Open questions` — slicer CLI (PrusaSlicer vs OrcaSlicer); where pricing runs (Edge Function vs SQL function); worker hosting; Realtime vs polling for job status; whether the worker needs an HTTP surface at all beyond `/healthz`.

- [ ] **Step 2: Write `docs/architecture/adr/0001-monorepo-and-stack.md`** in ADR format:
  - Title, `Status: Accepted`, `Date: 2026-10-11`.
  - `## Context` — internal quoting tool, one developer, need JS frontend + Python slicing + managed backend.
  - `## Decision` — single monorepo; npm workspaces (`apps/*`); uv workspace (`services/*`, `libs/python/*`); Supabase for DB/Auth/Storage/Edge Functions; pgmq for jobs; React + Vite + TS frontend; FastAPI where a Python HTTP surface is needed.
  - `## Alternatives considered` — polled `jobs` table (hand-rolled locking/retries); Redis + RQ/Celery (extra infrastructure); pnpm (rejected in favour of npm, already installed and sufficient); separate repos (overhead not justified for one team).
  - `## Consequences` — one place for docs and decisions; Python and JS tooling coexist at root; worker must hold a Postgres connection for pgmq; Supabase lock-in accepted.

- [ ] **Step 3: Commit**

```bash
git rm docs/architecture/adr/.gitkeep
git add docs/architecture
git commit -m "docs: add architecture overview and ADR-0001"
```

---

### Task 4: slicer-worker service doc

**Files:**
- Create: `docs/services/slicer-worker.md`
- Delete: `docs/services/.gitkeep`

- [ ] **Step 1: Write `docs/services/slicer-worker.md`** with:
  - `## Responsibility` — consume slicing jobs, run the slicer, persist metrics. Does not compute prices.
  - `## Job message (proposed)` — JSON example:
    ```json
    {
      "job_id": "uuid",
      "quote_item_id": "uuid",
      "model_path": "models/<quote_id>/<file>.stl",
      "printer_id": "uuid",
      "material_id": "uuid",
      "settings": { "layer_height_mm": 0.2, "infill_percent": 20, "supports": false }
    }
    ```
  - `## Output (proposed)` — `print_time_s`, `filament_g`, `filament_mm`, `layer_count`, bounding box `x/y/z_mm`, `slicer_version`; written to the job row and the quote item.
  - `## Processing loop` — read message (visibility timeout) → mark job `running` → download model → resolve printer/material profiles → run slicer CLI in a temp dir → parse output → write results, mark `succeeded`, delete message; on error record message, increment attempts, leave message to reappear or archive and mark `failed` after max attempts.
  - `## Configuration` — env var table: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `QUEUE_NAME` (default `slicing_jobs`), `SLICER_BIN`, `VISIBILITY_TIMEOUT_S` (default 600), `MAX_ATTEMPTS` (default 3), `POLL_INTERVAL_S` (default 5). Mark defaults as proposed.
  - `## HTTP surface` — `GET /healthz` only (FastAPI), for container health checks.
  - `## Running locally` — state that the service is not runnable yet (the package only defines `__version__`), and show the import check `uv run --package slicer-worker python -c "import slicer_worker"`.
  - `## Open questions` — slicer choice and profile management (bundled `.ini`/`.json` profiles vs generated from DB); supported formats (STL, 3MF, STEP?); timeouts for very large models; concurrency per container.

- [ ] **Step 2: Commit**

```bash
git rm docs/services/.gitkeep
git add docs/services/slicer-worker.md
git commit -m "docs: add slicer-worker service doc"
```

---

### Task 5: Supabase data model draft

**Files:**
- Create: `docs/supabase/data-model.md`
- Delete: `docs/supabase/.gitkeep`

- [ ] **Step 0:** Load the `supabase:supabase-postgres-best-practices` skill before writing (column types, keys, RLS notes).

- [ ] **Step 1: Write `docs/supabase/data-model.md`** marked `Status: Draft`, with:
  - A Mermaid `erDiagram` of the tables below.
  - One table per entity with columns, types and notes:
    - `printers` — id, name, model, build volume x/y/z (mm), nozzle diameter (mm), hourly rate, active, timestamps.
    - `materials` — id, name, type (PLA/PETG/ABS/TPU…), color, density (g/cm³), cost per kg, active, timestamps.
    - `clients` — id, name, company, email, phone, notes, timestamps.
    - `quotes` — id, client_id, status (`draft`/`sent`/`accepted`/`rejected`/`expired`), currency, valid_until, notes, created_by (auth user), timestamps.
    - `quote_items` — id, quote_id, model_path (Storage), printer_id, material_id, quantity, settings (layer height, infill, supports), slicing results (print_time_s, filament_g), unit price, timestamps.
    - `slicing_jobs` — id, quote_item_id, status (`queued`/`running`/`succeeded`/`failed`), attempts, error, queued/started/finished timestamps.
  - `## Storage` — private bucket `models`, path `<quote_id>/<quote_item_id>/<filename>`.
  - `## Queues` — pgmq queue `slicing_jobs`.
  - `## Access` — RLS on every table; authenticated staff may read/write; worker uses service role.
  - `## Open questions` — money type (`numeric(12,2)` vs integer cents); price history/snapshots on sent quotes; soft delete; multi-currency.

- [ ] **Step 2: Commit**

```bash
git rm docs/supabase/.gitkeep
git add docs/supabase/data-model.md
git commit -m "docs: add draft Supabase data model"
```

---

### Task 6: Getting started and link check

**Files:**
- Create: `docs/development/getting-started.md`
- Delete: `docs/development/.gitkeep`

- [ ] **Step 1: Write `docs/development/getting-started.md`** with:
  - `## Prerequisites` — Node.js ≥ 22 with npm, uv ≥ 0.8, Python ≥ 3.12 (uv can install it), Supabase CLI, Docker (for local Supabase and the worker image).
  - `## First setup` — `git clone`, `npm install`, `uv sync`.
  - `## Repository layout` — link to root `README.md` instead of repeating the table.
  - `## Common commands` — `uv run --package slicer-worker <cmd>`, `npm run <script> --workspace apps/web` (once the app exists), `supabase start` (once `supabase init` has been run).
  - `## Adding a Python service` — create `services/<name>/` with `pyproject.toml` (same shape as `slicer-worker`), it is picked up by the workspace glob, run `uv lock`.
  - `## Adding a shared Python library` — same, under `libs/python/<name>/`; depend on it with `[tool.uv.sources] <name> = { workspace = true }`.
  - `## Open questions` — Node version pinning (`.nvmrc` / `engines`); lint/format tooling (ruff, eslint/prettier or biome).

- [ ] **Step 2: Check every relative Markdown link resolves**

```bash
python - <<'EOF'
import pathlib, re, sys
bad = []
for md in [pathlib.Path("README.md"), *pathlib.Path("docs").rglob("*.md"), *pathlib.Path("services").rglob("*.md")]:
    for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", md.read_text(encoding="utf-8")):
        if "://" in target:
            continue
        if not (md.parent / target).exists():
            bad.append(f"{md}: {target}")
print("\n".join(bad) or "all links ok")
sys.exit(1 if bad else 0)
EOF
```
Expected: `all links ok`. Fix any reported link before committing.

- [ ] **Step 3: Commit**

```bash
git rm docs/development/.gitkeep
git add docs/development/getting-started.md
git commit -m "docs: add getting started guide"
```
