# ADR-0001: Monorepo and technology stack

- **Status: Accepted**
- **Date:** 2026-10-11

## Context

3D-Quote is an internal quoting tool for a 3D print shop, built and maintained by a small team. It needs:

- a browser UI for shop staff;
- a backend for data, authentication, file storage and a small amount of server-side logic;
- slicing of uploaded models, which means running a slicer CLI — work that is slow, CPU-heavy and best done in
  Python next to the slicer binary, not in the browser or an edge runtime.

We want one place for code, docs and decisions, and as little infrastructure to operate as possible.

## Decision

- **One monorepo** containing the frontend, Python services, the Supabase project and the documentation.
- **npm workspaces** for JavaScript/TypeScript packages, under `apps/*`.
- **uv workspace** for Python, with members under `services/*` (deployable services) and `libs/python/*` (shared
  libraries). One lockfile (`uv.lock`) at the root.
- **Supabase** for Postgres, Auth, Storage and Edge Functions. The `supabase/` directory lives at the repository
  root, where the Supabase CLI expects it.
- **Supabase Queues (pgmq)** for slicing jobs.
- **React + Vite + TypeScript** for the web app.
- **FastAPI** wherever a Python service needs an HTTP surface.

## Alternatives considered

- **A `jobs` table polled by the worker.** Simplest to start, but locking, retries and visibility timeouts would
  all be hand-written. pgmq provides them and still lives in the same database.
- **Redis with RQ or Celery.** Mature, but one more service to run, secure and pay for, and jobs would no longer be
  transactional with the quote data.
- **pnpm or Yarn.** Faster installs and stricter dependency isolation, but npm is already installed everywhere and
  is enough for a single web app.
- **Separate repositories per component.** Independent versioning isn't needed for one small team; it would split
  docs and make cross-cutting changes (e.g. the job message contract) harder to keep in sync.
- **A custom Python API instead of Edge Functions.** More control, but another service to host and secure, while
  Supabase already provides auth, row-level security and a generated API.

## Consequences

- Docs, decisions and code live together; a change to the job contract can update the Edge Function, the worker
  and the docs in one commit.
- Python and JavaScript tooling coexist at the root (`pyproject.toml` + `uv.lock`, `package.json` +
  `package-lock.json`).
- The worker needs a direct Postgres connection to use pgmq, so its host must be able to reach the Supabase
  database.
- We accept dependence on Supabase. Postgres, pgmq and S3-compatible storage keep a migration path open if needed.
