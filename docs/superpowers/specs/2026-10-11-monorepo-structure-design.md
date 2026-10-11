# Monorepo Structure — Design

- **Date:** 2026-10-11
- **Status:** Draft — awaiting review

## Goal

Set up the 3D-Quote repository as a monorepo that holds a React frontend, Python services and the Supabase project, with a documentation tree ready to be filled in. This step creates structure and workspace configuration only; it does not generate application code.

## Context

3D-Quote is an **internal tool for a 3D print shop**: staff upload a client's model, get an estimate of print time and material, and produce a quote.

| Concern | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, managed with **npm workspaces** |
| Backend data, auth, file storage, API | **Supabase** (Postgres, Auth, Storage, Edge Functions) |
| Python services | **uv workspace**, FastAPI where an HTTP surface is needed |
| Initial Python service | `slicer-worker` — runs a headless slicer to compute print time and filament usage |
| Service communication | HTTP + job queue; queue is **Supabase Queues (pgmq)** |
| Documentation language | English |

### Assumed runtime flow (to be detailed in the architecture docs)

1. Staff upload a model (STL/3MF) from the web app to Supabase Storage.
2. An Edge Function creates a quote record and enqueues a slicing job on pgmq.
3. `slicer-worker` reads the job, downloads the model, runs the slicer CLI, and writes print time, filament grams and related metrics back to Postgres.
4. Pricing is computed from those metrics plus material and machine rates (in an Edge Function or SQL), and the web app shows the quote.

### Queue decision

pgmq was chosen over a polled `jobs` table (would require hand-rolled locking, retries and visibility timeouts) and over Redis + RQ/Celery (an extra piece of infrastructure to run). pgmq keeps jobs transactional with the quote data and adds no new infrastructure.

## Repository layout

```
3D-Quote/
├── apps/
│   └── web/                         # React + Vite + TS (placeholder; scaffolded later)
├── services/
│   └── slicer-worker/               # uv workspace member
│       ├── src/slicer_worker/__init__.py
│       ├── tests/.gitkeep
│       └── pyproject.toml           # minimal, so the uv workspace resolves
├── libs/
│   └── python/.gitkeep              # future shared Python packages (uv members)
├── supabase/
│   ├── functions/.gitkeep           # Edge Functions (Deno/TypeScript)
│   └── migrations/.gitkeep          # SQL migrations
├── infra/
│   └── docker/.gitkeep              # worker image, local compose
├── docs/
│   ├── README.md                    # docs index
│   ├── product/                     # vision, users, quoting workflow, glossary
│   ├── architecture/                # system overview, data flow
│   │   └── adr/                     # architecture decision records
│   ├── services/                    # one page per Python service
│   ├── frontend/                    # web app docs
│   ├── supabase/                    # data model, edge functions, storage, queues
│   ├── development/                 # getting started, conventions
│   └── superpowers/specs/           # design specs
├── pyproject.toml                   # uv workspace root
├── package.json                     # npm workspaces root
├── .gitignore
├── .editorconfig
└── README.md
```

Empty directories carry a `.gitkeep`; it is removed once the directory has real content.

## Workspace configuration

**`pyproject.toml` (root)** — virtual uv workspace, no package of its own:

```toml
[tool.uv.workspace]
members = ["services/*", "libs/python/*"]
```

`libs/python/` has no members yet; the glob is there so shared packages are picked up when added.

**`services/slicer-worker/pyproject.toml`** — name `slicer-worker`, `requires-python = ">=3.12"`, no dependencies yet, `src/` layout. FastAPI and the slicer integration are added when the service is implemented.

**`package.json` (root)** — `"private": true`, `"workspaces": ["apps/*"]`. No dependencies yet. `apps/web` is scaffolded with `npm create vite@latest` in a later step.

**Supabase** — `supabase/` sits at the repository root because the Supabase CLI expects it there. `supabase init` (which creates `config.toml`) is run when the Supabase project is set up, not in this step.

**`.gitignore`** covers Python (`.venv/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`), Node (`node_modules/`, `dist/`), Supabase local state (`supabase/.branches/`, `supabase/.temp/`), env files (`.env`, `.env.*` except `.env.example`) and OS/editor noise.

## Documentation plan

After the scaffold, the docs are written in this order:

1. `docs/product/overview.md` — what the tool is, who uses it, the quoting workflow, glossary.
2. `docs/architecture/overview.md` — components, data flow diagram, and `docs/architecture/adr/0001-monorepo-and-stack.md` recording the decisions in this spec.
3. `docs/services/slicer-worker.md` — responsibility, inputs/outputs, job contract, configuration.
4. `docs/supabase/data-model.md` — draft schema for printers, materials, quotes and jobs.
5. `docs/development/getting-started.md` — prerequisites (Node/npm, uv, Supabase CLI, Docker) and local setup.

Anything not yet decided is recorded as an **Open question** in the relevant doc rather than guessed.

## Open questions

- Which slicer CLI: PrusaSlicer or OrcaSlicer?
- Pricing formula and where it lives (Edge Function vs SQL function).
- How `slicer-worker` is hosted (container platform, always-on vs scale-to-zero).
- Whether the web app needs an in-browser 3D preview (three.js) in the first version.

## Out of scope

- Generating the Vite app, FastAPI app, or any Edge Function.
- Running `supabase init` or creating a Supabase project.
- CI/CD, linting and formatting configuration.
