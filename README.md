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
