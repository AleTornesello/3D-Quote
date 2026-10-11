# Getting started

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js + npm | Node ≥ 22 | Web app (npm workspaces) |
| [uv](https://docs.astral.sh/uv/) | ≥ 0.8 | Python workspace, virtualenv and lockfile |
| Python | ≥ 3.12 | Python services — uv can install it: `uv python install 3.12` |
| [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) | latest | Local Supabase stack, migrations, Edge Functions |
| Docker | any recent | Runs the local Supabase stack and, later, the worker image |

## First setup

```bash
git clone <repository-url> 3D-Quote
cd 3D-Quote
npm install     # JS workspaces (apps/*)
uv sync         # Python workspace (services/*, libs/python/*) into .venv/
```

Both commands must be run from the repository root: the root `package.json` and `pyproject.toml` define the
workspaces, and there is one lockfile for each (`package-lock.json`, `uv.lock`).

## Repository layout

See the table in the root [README](../../README.md). Documentation conventions are in the
[docs index](../README.md#conventions).

## Common commands

| Command | What it does |
|---|---|
| `uv run --package slicer-worker <cmd>` | Run a command in the slicer-worker's environment |
| `uv lock` | Re-resolve Python dependencies after editing any `pyproject.toml` |
| `uv add --package slicer-worker <dep>` | Add a dependency to one Python service |
| `npm run <script> --workspace apps/web` | Run a web app script — once the app is scaffolded |
| `supabase start` | Start the local Supabase stack — once `supabase init` has been run |

## Adding a Python service

1. Create `services/<name>/` with a `pyproject.toml` shaped like `services/slicer-worker/pyproject.toml`
   (`requires-python = ">=3.12"`, `uv_build` backend) and code under `src/<package_name>/`.
2. Run `uv lock` at the root. The workspace glob `services/*` picks the service up automatically.
3. Add a page for it under `docs/services/` and link it from the [docs index](../README.md).

## Adding a shared Python library

1. Create `libs/python/<name>/` the same way as a service.
2. Depend on it from a service by adding it to the service's `dependencies` and marking it as a workspace source:

   ```toml
   [project]
   dependencies = ["<name>"]

   [tool.uv.sources]
   <name> = { workspace = true }
   ```

3. Run `uv lock`. Remove `libs/python/.gitkeep` once the first library exists.

## Open questions

- **Node version pinning:** `.nvmrc`, `engines` in `package.json`, or both.
- **Lint and format tooling:** ruff for Python; ESLint + Prettier or Biome for TypeScript; whether a pre-commit
  hook runs them.
