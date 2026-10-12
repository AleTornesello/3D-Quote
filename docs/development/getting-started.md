# Getting started

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js + npm | Node ≥ 22 | Web app (npm workspaces) |
| [uv](https://docs.astral.sh/uv/) | ≥ 0.8 | Python workspace, virtualenv and lockfile |
| Python | ≥ 3.12 | Python services — uv can install it: `uv python install 3.12` |
| [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) | ≥ 2.81.3 (on Windows: `scoop install supabase/supabase` from Supabase's bucket) | Local Supabase stack, migrations, Edge Functions |
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

Then configure the web app: copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the Supabase URL and
publishable key (see the [web app guide](../frontend/web-app.md#running)).

## Local Supabase

Docker must be running. From the repository root:

```bash
supabase start          # first run pulls the images; prints URLs and keys
supabase db reset       # rebuild the database from supabase/migrations and supabase/seed.sql
supabase test db        # pgTAP tests in supabase/tests/database
supabase status         # URLs and keys again
```

The stack uses the default local ports (54321–54324). Another project's local Supabase stack holds the same ports:
stop it first with `supabase stop --project-id <its project id>`; its data is kept.

Fill `apps/web/.env.local` from `supabase status`:
- `VITE_SUPABASE_URL` is the API URL;
- `VITE_SUPABASE_PUBLISHABLE_KEY` is the publishable (or anon) key.

Seed logins, local only, password `password123`:

| Email | Role |
|---|---|
| `owner@3dquote.local` | owner |
| `operator@3dquote.local` | operator |

### Changing the schema

1. Edit the files in `supabase/schemas/`. They are the source of truth; files load in name order.
2. Run `supabase db diff -f <change_name>` and review the generated migration.
3. If the change needs data rows, column grants, function grants, cron jobs or queues, add them with
   `supabase migration new <change_name>_setup`. Function grants also go in `supabase/schemas/90_grants.sql`, which
   mirrors every grant so the diff stays empty.
4. Run `supabase db reset`, then `supabase test db`, `supabase db diff` (expect no changes) and
   `supabase db advisors --local`.
5. If tables, columns or functions changed, run `npm run gen:types` and commit `apps/web/src/lib/database.types.ts`.

See [ADR-0003](../architecture/adr/0003-database-schema-and-security.md) for why the workflow is split.

### First owner on a cloud project

Public sign-ups are disabled. Once you've been invited and have set your password, run this once in the SQL editor:

```sql
insert into public.staff (user_id, display_name, role)
select id, 'Your Name', 'owner' from auth.users where email = 'you@example.com';
```

## Repository layout

See the table in the root [README](../../README.md). Documentation conventions are in the
[docs index](../README.md#conventions).

## Common commands

| Command | What it does |
|---|---|
| `uv run --package slicer-worker <cmd>` | Run a command in the slicer-worker's environment |
| `uv lock` | Re-resolve Python dependencies after editing any `pyproject.toml` |
| `uv add --package slicer-worker <dep>` | Add a dependency to one Python service |
| `npm run dev` | Web app dev server (extra args reach Vite: `npm run dev -- --port 5199`) |
| `npm run build` / `npm test` / `npm run lint` / `npm run format` | Build, test, lint, format the web app (forwarded to `@3d-quote/web`) |
| `supabase start` / `supabase db reset` / `supabase test db` | Local Supabase stack, rebuild the database, run the pgTAP tests |

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
- **Python lint and format tooling:** ruff or another tool; whether a pre-commit hook runs the linters.
  TypeScript is settled: ESLint + Prettier (see [ADR-0002](../architecture/adr/0002-frontend-stack.md)).
