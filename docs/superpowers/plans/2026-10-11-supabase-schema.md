# Supabase Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 3D-Quote database on a local Supabase stack. It covers:
- tables, RLS and grants;
- quote numbering;
- web app and worker functions;
- the slicing queue, storage buckets and the daily expiry job.

Everything is covered by pgTAP tests.

**Architecture:** Declarative SQL files in `supabase/schemas/` are the source of truth. `supabase db diff` turns them into one generated migration, `initial_schema`. One hand-written migration, `grants_and_setup`, holds what the diff can't capture:
- default privileges;
- column privileges;
- data rows: the settings row and the buckets;
- the pgmq queue;
- storage policies;
- the cron job.

Privileged logic lives in `security definer` functions in the non-exposed `private` schema. The Data API reaches it only through thin `security invoker` wrappers in `public`.

**Tech Stack:** Supabase CLI 2.x (local stack in Docker), Postgres 17, pgmq, pg_cron, pgTAP (`supabase test db`), Python 3.12 stdlib (one throwaway API smoke script).

**Spec:** `docs/superpowers/specs/2026-10-11-supabase-schema-design.md`

## Global Constraints

- All commits on branch `develop`. Never push, never merge to `main` unless asked.
- **Local only.** Never run `supabase link`, `supabase db push` or `supabase login`. Never touch the cloud projects ScoreForge (`ltmmrowmeulladrlsgwy`) or FindFungi (`qvkjtdgrfnqawigibzqf`).
- Run npm only from the repo root. `C:\Progetti` above the repo has an unrelated npm project.
- Run Supabase CLI commands from the repo root `C:\Progetti\3D-Quote` with the Bash tool (Git Bash).
- Files use LF line endings (`.gitattributes`). When a file is written from Python, use `newline="\n"`.
- SQL style:
  - lowercase keywords, 2-space indent, `snake_case`;
  - every function has `set search_path = ''` and schema-qualifies every name in its body;
  - every table in `public` and `private` has RLS enabled;
  - policies are `to authenticated` and call helpers as `(select private.is_staff())` or `(select private.is_owner())`.
- Error contract. Functions raise these exact messages (`errcode` in brackets). The web app will map them to translated text.

  | errcode | messages |
  |---|---|
  | `42501` | `not_staff`, `owner_required` |
  | `P0001` (default) | `last_owner`, `quote_not_draft`, `quote_not_sent`, `quote_not_sendable`, `retry_not_allowed`, `quote_item_move_not_allowed` |
  | `P0002` | `quote_not_found`, `item_not_found`, `model_not_found` |
  | `22023` | `invalid_model_path`, `printer_inactive`, `material_inactive`, `invalid_override`, `invalid_markup`, `invalid_results` |

- Migration file names are fixed: `supabase/migrations/20261011120000_initial_schema.sql` (generated) and
  `supabase/migrations/20261011120100_grants_and_setup.sql` (hand-written).
- **Test fixtures:**
  - Auth user ids:

    | Role in tests | Id |
    |---|---|
    | owner | `00000000-0000-4000-8000-0000000000a1` |
    | operator | `00000000-0000-4000-8000-0000000000a2` |
    | outsider (no staff row) | `00000000-0000-4000-8000-0000000000a3` |
    | inactive | `00000000-0000-4000-8000-0000000000a4` |
    | newcomer | `00000000-0000-4000-8000-0000000000a5` |

  - Seed users use `…-000000000001` and `…-000000000002`, so they never collide with test users.
  - Fixture row ids start at `900001`, inserted with `overriding system value`.
  - Each test file is `begin; … rollback;`. Fixtures run as `postgres`, and roles are switched with:

    ```sql
    set local role authenticated;
    set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
    ```

    `reset role;` returns to `postgres`.
  - Statements that return a row (calls to `pgmq.*` or `private.*` used as fixtures) go inside
    `do $$ begin perform …; end $$;`, so they don't print stray rows into the TAP output.

### Rebuild procedure (R)

Each task changes `supabase/schemas/` and then runs this to regenerate the generated migration and rebuild the local
database. Before anything is deployed, regenerating the first migration in place is safe. The hand-written migration
is moved aside while diffing because it references tables the empty shadow database doesn't have yet.

```bash
cd /c/Progetti/3D-Quote
mkdir -p .superpowers/hold
mv supabase/migrations/20261011120100_grants_and_setup.sql .superpowers/hold/ 2>/dev/null || true
rm -f supabase/migrations/*_initial_schema.sql
supabase db diff -f initial_schema 2>&1 | tail -5
mv supabase/migrations/*_initial_schema.sql supabase/migrations/20261011120000_initial_schema.sql
sed -i '1i set check_function_bodies = off;' supabase/migrations/20261011120000_initial_schema.sql
mv .superpowers/hold/20261011120100_grants_and_setup.sql supabase/migrations/ 2>/dev/null || true
supabase db reset 2>&1 | tail -5
```

Expected:
- `db diff` ends with a line saying it wrote `supabase/migrations/<timestamp>_initial_schema.sql`;
- `db reset` ends with `Finished supabase db reset on branch …`, or similar, with no `ERROR`.

`set check_function_bodies = off` is what `pg_dump` does. It lets `language sql` functions be created even if the
generated file orders them before the tables they read.

Run tests with:

```bash
supabase test db 2>&1 | tail -25
```

## Plan decisions that refine the spec

These are made here so the executor doesn't have to rule on them.
1. **CLI install:** `scoop update supabase` can't upgrade the CLI. The installed copy comes from scoop's `main` bucket,
   which stopped at v1.176.10 in 2024. Task 1 reinstalls from Supabase's own bucket
   (`https://github.com/supabase/scoop-bucket.git`).
2. **Schema file order:** `schema_paths = ["./schemas/*.sql"]`. The glob expands in name order, so the `NN_`
   prefixes set the order without listing every file.
3. **Grant placement:** table-level and function grants live in the declarative file `schemas/90_grants.sql`, because
   the diff captures them. Only default privileges and column privileges go in the hand-written migration. The spec's
   principle, "hand-write only what the diff can't capture", is kept. Task 2 Step 6 checks that the diff really
   captured the grants and has a fallback if it didn't.
4. **Test files are grouped by task**, not by the spec's file names. Coverage is the same:
   - `00_base`, `01_structure`, `02_staff`, `03_catalog`, `04_quotes` and `05_quote_items` are structure, RLS, grants
     and triggers;
   - `06_quote_api`, `07_lifecycle` and `08_worker` are the functions;
   - `09_setup_storage` is the migration-only parts.
5. **Helper functions:** `private.can_upload_model(name)` backs the `models` upload policy. The internal helpers
   (`require_staff`, `require_owner`, `require_draft_quote`, `require_active_catalog`, `enqueue_slicing_job`,
   `mark_quote_outcome`, `expire_quotes`) are `security invoker`. They're only called from `security definer`
   functions or by cron, and nobody else is granted EXECUTE on them.
6. **`slicing_jobs` timestamps:** the table keeps `queued_at`, `started_at` and `finished_at`, as in the data model,
   instead of `created_at` and `updated_at`.

## Review Focus

1. **Concurrent "Mark as sent" and item edit.** A quote must never be sent with an item whose price was cleared at the
   same moment. `require_draft_quote` takes `FOR UPDATE` on the quote and the item guard takes `FOR SHARE`. A deadlock
   error is acceptable here; a silent success is not. pgTAP runs in one session and can't exercise this, so the
   reviewer checks the lock order by reading.
2. **Year and day boundaries.** Every "today" and "year" must come from `private.shop_today()` (Europe/Rome), never
   `current_date` or `now()::date`. For example, a quote created at 23:30 UTC on 31 December is already next year in
   Rome. Reviewer checks with `grep -n "current_date\|now()::date" supabase/schemas`.
3. **Data API behaviour that pgTAP can't see:**
   - PostgREST matching RPC arguments by name, including the defaults and the `numeric` and `integer` parameters;
   - the Storage API upload going through the storage policies;
   - anon being refused.

   Pinned by Task 10's smoke script.
4. **Generated migration fidelity.** The tests run against the migrations, not the schema files. If migra drops or
   reorders something (trigger order, `for share`, `security invoker`, `set search_path`), the tests catch it. Drift
   between the schema files and the migrations is caught by Task 10's "`supabase db diff` is empty" check.
5. **Deleting an Auth user who created quotes.** It must fail on the foreign key, never cascade-delete quotes. Pinned
   by Task 4's test "an auth user who created quotes cannot be deleted".

---

### Task 1: Tooling, project init and base schema

**Files:**
- Create: `supabase/config.toml`, `supabase/.gitignore` (via `supabase init`)
- Create: `supabase/schemas/00_base.sql`
- Create: `supabase/tests/database/00_base.test.sql`
- Create: `supabase/migrations/20261011120000_initial_schema.sql` (generated)
- Delete: `supabase/migrations/.gitkeep`

**Interfaces:**
- Produces:
  - schema `private`;
  - extensions `pgmq` and `pg_cron`;
  - `private.set_updated_at() returns trigger`, which sets `new.updated_at := now()`;
  - `private.shop_today() returns date`, today in Europe/Rome.

- [ ] **Step 1: Check nothing else holds the Supabase ports**

```bash
docker ps --format '{{.Names}}' | grep -i supabase || echo "no supabase containers"
```

Expected: `no supabase containers`. If containers from another project are listed, **stop and ask the user**. They
belong to other projects and use the same ports.

- [ ] **Step 2: Reinstall the Supabase CLI from Supabase's scoop bucket**

```bash
scoop uninstall supabase
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase/supabase
supabase --version
```

Expected: a `2.x` version of at least `2.81.3`, the minimum for `supabase db advisors`. On 2026-10-11 the latest was
`2.120.0`.

- [ ] **Step 3: Initialise the project**

```bash
cd /c/Progetti/3D-Quote
supabase init < /dev/null
git status --short supabase
```

Expected: `supabase/config.toml` and `supabase/.gitignore` are created. If it asks about VS Code or IntelliJ settings,
answer no.

- [ ] **Step 4: Edit `supabase/config.toml`**

Change these keys. Read the file first; the surrounding defaults stay as they are.
- top level: `project_id = "3d-quote"`
- `[auth]`:
  - `site_url = "http://localhost:5173"`
  - `additional_redirect_urls = ["http://localhost:5173/account"]`
  - `enable_signup = false`
- `[auth.email]`: `enable_signup = false`
- `[storage]`: `file_size_limit = "100MiB"`
- `[db.migrations]`: keep `enabled = true` and set `schema_paths = ["./schemas/*.sql"]`
- If there is an `[experimental.pgdelta]` section with `enabled = true`, set it to `false`. This plan uses the
  default engine, whose `db diff` reads `supabase/schemas/`.

Leave `[api] schemas` as generated (`["public", "graphql_public"]`).

- [ ] **Step 5: Start the local stack**

```bash
supabase start 2>&1 | tail -20
```

Use a 600000 ms timeout; the first run pulls images. Expected: it prints the API URL, DB URL and keys.

If it fails on the `vector` or `logflare` containers, a known Windows issue, set `[analytics] enabled = false` in
`config.toml`, record a `Ruling:` and run it again.

- [ ] **Step 6: Write the failing test** at `supabase/tests/database/00_base.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select has_schema('private', 'the private schema exists');
select ok(exists (select 1 from pg_extension where extname = 'pgmq'), 'pgmq is installed');
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select is(private.shop_today(), (now() at time zone 'Europe/Rome')::date, 'shop_today is the date in Europe/Rome');
select has_function('private', 'set_updated_at', 'the updated_at trigger function exists');

select * from finish();
rollback;
```

- [ ] **Step 7: Run it and watch it fail**

Run: `supabase test db 2>&1 | tail -25`
Expected: FAIL. `00_base.test.sql` reports failures for the missing schema and extensions, or errors on
`private.shop_today()` not existing.

- [ ] **Step 8: Write `supabase/schemas/00_base.sql`**

```sql
-- Base objects every other schema file relies on.

create schema if not exists private;

create extension if not exists pgmq;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- The shop's calendar date. Quote number years, the send check and the expiry job all use it, so this is the one
-- place to change the timezone.
create or replace function private.shop_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Rome')::date;
$$;
```

- [ ] **Step 9: Generate the migration and rebuild**

Run the Rebuild procedure (R) from Global Constraints. Then:

```bash
rm -f supabase/migrations/.gitkeep
grep -c "create schema\|create extension\|create or replace function" supabase/migrations/20261011120000_initial_schema.sql
grep -ci "^drop " supabase/migrations/20261011120000_initial_schema.sql
```

Expected:
- the first count is at least 4;
- the second is `0`.

If `db diff` didn't include the schema files (the migration is empty), check that `config.toml` has no
`[experimental.pgdelta] enabled = true`. Then run `supabase db diff --help` and record a `Ruling:` for the flag that
selects the declarative files.

- [ ] **Step 10: Run the test and watch it pass**

Run: `supabase test db 2>&1 | tail -25`
Expected: `00_base.test.sql .. ok`, `All tests successful.`, `Result: PASS`.

- [ ] **Step 11: Commit**

```bash
git add supabase
git rm -q --cached supabase/migrations/.gitkeep 2>/dev/null || true
git commit -m "feat(db): init local Supabase project with base schema and pgTAP"
```

---

### Task 2: Staff, access helpers and the grants baseline

**Files:**
- Create: `supabase/schemas/01_staff.sql`
- Create: `supabase/schemas/10_policies.sql`
- Create: `supabase/schemas/90_grants.sql`
- Create: `supabase/migrations/20261011120100_grants_and_setup.sql` (hand-written)
- Create: `supabase/tests/database/01_structure.test.sql`, `supabase/tests/database/02_staff.test.sql`

**Interfaces:**
- Consumes: `private.set_updated_at()` (Task 1).
- Produces:
  - table `public.staff`;
  - `private.is_staff() returns boolean`, true for the caller when an active staff member;
  - `private.is_owner() returns boolean`, true for an active owner;
  - trigger `staff_guard`, which raises `owner_required` (42501) and `last_owner`;
  - `90_grants.sql`, which later tasks append to;
  - the hand-written migration, which later tasks append to.

- [ ] **Step 1: Write the structure test** at `supabase/tests/database/01_structure.test.sql`

These are invariants over every object, so they also guard later tasks.

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(
  array(
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity
    order by 1
  ),
  array[]::text[],
  'RLS is enabled on every table in public and private'
);

select is(
  array(
    select con.conrelid::regclass::text || ' ' || con.conname
    from pg_constraint con
    join pg_namespace n on n.oid = con.connamespace
    where con.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = con.conrelid
          and (
            select array_agg(k order by ord)
            from unnest(i.indkey::int2[]) with ordinality as u (k, ord)
            where ord <= cardinality(con.conkey)
          ) = con.conkey
      )
    order by 1
  ),
  array[]::text[],
  'every foreign key in public has an index starting with its column'
);

select is(
  array(
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
      and has_table_privilege('anon', c.oid, 'select, insert, update, delete')
    order by 1
  ),
  array[]::text[],
  'anon has no privileges on any public table'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array[]::text[],
  'anon cannot execute any function in public or private'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg where cfg like 'search_path=%'
      )
    order by 1
  ),
  array[]::text[],
  'every function in public and private pins its search_path'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
    order by 1
  ),
  array[]::text[],
  'no security definer function is exposed in public'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Write the staff test** at `supabase/tests/database/02_staff.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Fixtures. The seed owner is demoted so the test owner is the only active owner.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local'),
  ('00000000-0000-4000-8000-0000000000a4', 'inactive@test.local'),
  ('00000000-0000-4000-8000-0000000000a5', 'newcomer@test.local');
insert into public.staff (user_id, display_name, role, active) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner', true),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator', true),
  ('00000000-0000-4000-8000-0000000000a4', 'Test Inactive', 'operator', false);
update public.staff set role = 'operator'
where role = 'owner' and user_id <> '00000000-0000-4000-8000-0000000000a1';

-- Anonymous
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select count(*) from public.staff$$, '42501', null, 'anon cannot read staff');

-- Signed in without a staff row
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.staff), 0, 'a user without a staff row sees no staff');

-- Inactive staff
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.staff), 0, 'inactive staff see no staff');

-- Operator
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select ok((select count(*) from public.staff) >= 3, 'operators see all staff');
select lives_ok(
  $$update public.staff set display_name = 'Renamed', language = 'en'
    where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  'operators can change their own name and language'
);
select is(
  (select language from public.staff where user_id = '00000000-0000-4000-8000-0000000000a2'),
  'en',
  'the language change is saved'
);
select throws_ok(
  $$update public.staff set role = 'owner' where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  '42501', 'owner_required', 'operators cannot change their own role'
);
select results_eq(
  $$with u as (
      update public.staff set display_name = 'Hacked'
      where user_id = '00000000-0000-4000-8000-0000000000a1' returning 1
    ) select count(*)::int from u$$,
  $$values (0)$$,
  'operators cannot edit other staff'
);
select throws_ok(
  $$insert into public.staff (user_id, display_name) values ('00000000-0000-4000-8000-0000000000a5', 'New')$$,
  '42501', null, 'operators cannot add staff'
);
select throws_ok(
  $$update public.staff set user_id = '00000000-0000-4000-8000-0000000000a5'
    where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  '42501', null, 'user_id cannot be changed through the API'
);
select throws_ok(
  $$delete from public.staff where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  '42501', null, 'staff rows cannot be deleted through the API'
);

-- Owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$update public.staff set role = 'operator' where user_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'last_owner', 'the last owner cannot demote themselves'
);
select throws_ok(
  $$update public.staff set active = false where user_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'last_owner', 'the last owner cannot deactivate themselves'
);
select lives_ok(
  $$insert into public.staff (user_id, display_name) values ('00000000-0000-4000-8000-0000000000a5', 'Newcomer')$$,
  'owners can add staff'
);
select lives_ok(
  $$update public.staff set role = 'owner' where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  'owners can promote an operator'
);
select lives_ok(
  $$update public.staff set role = 'operator' where user_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'an owner can step down while another owner remains'
);

-- Database level: the last active owner (now the former operator) cannot be deleted either
reset role;
select throws_ok(
  $$delete from public.staff where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  'P0001', 'last_owner', 'the last active owner cannot be deleted'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `supabase test db 2>&1 | tail -25`

Expected:
- `02_staff.test.sql` fails, because `relation "public.staff" does not exist`;
- `01_structure.test.sql` passes, since these invariants hold with no tables.

- [ ] **Step 4: Write `supabase/schemas/01_staff.sql`**

```sql
-- Staff: who may use the tool, and the access helpers every policy uses.

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (btrim(display_name) <> ''),
  role text not null default 'operator' check (role in ('operator', 'owner')),
  language text not null default 'it' check (language in ('it', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff enable row level security;

create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function private.set_updated_at();

-- True when the caller is active staff. Security definer so policies can read staff without going through
-- staff's own RLS.
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff
    where user_id = (select auth.uid()) and active
  );
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff
    where user_id = (select auth.uid()) and active and role = 'owner'
  );
$$;

-- Only owners change roles or access, and there is always at least one active owner. Requests without a user
-- (service role, migrations) may change roles but are still held to the last-owner rule.
create or replace function private.staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.role is distinct from old.role or new.active is distinct from old.active)
     and (select auth.uid()) is not null
     and not private.is_owner() then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active) then
    -- Lock the owner rows so two owners can't demote each other at the same time.
    perform 1 from public.staff where role = 'owner' and active for update;
    if not exists (
      select 1 from public.staff
      where role = 'owner' and active and user_id <> old.user_id
    ) then
      raise exception 'last_owner';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger staff_guard
  before update or delete on public.staff
  for each row execute function private.staff_guard();
```

- [ ] **Step 5: Write `supabase/schemas/10_policies.sql` and `supabase/schemas/90_grants.sql`**

`10_policies.sql`:

```sql
-- Row level security policies. Every policy targets `authenticated`; anon has no grants at all. Helpers are wrapped
-- in (select …) so they run once per statement, not once per row.

-- staff
create policy staff_select on public.staff
  for select to authenticated
  using ((select private.is_staff()));

create policy staff_insert on public.staff
  for insert to authenticated
  with check ((select private.is_owner()));

create policy staff_update on public.staff
  for update to authenticated
  using ((select private.is_owner()) or (user_id = (select auth.uid()) and (select private.is_staff())))
  with check ((select private.is_owner()) or (user_id = (select auth.uid()) and (select private.is_staff())));
```

`90_grants.sql`:

```sql
-- Data API exposure is explicit (Supabase Data API change, 2026). anon gets nothing; authenticated reads every
-- public table (RLS decides which rows) and writes only what is granted here or, column by column, in the
-- grants_and_setup migration. Functions run only where granted below. Keep this file last.

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- staff
grant insert on public.staff to authenticated;
grant execute on function private.is_staff(), private.is_owner() to authenticated;
```

- [ ] **Step 6: Create the hand-written migration and rebuild**

```bash
supabase migration new grants_and_setup
mv supabase/migrations/*_grants_and_setup.sql supabase/migrations/20261011120100_grants_and_setup.sql
```

Write `supabase/migrations/20261011120100_grants_and_setup.sql`:

```sql
-- Hand-written companion to the generated initial_schema migration. It holds what `supabase db diff` does not
-- capture from supabase/schemas/: default privileges, column privileges, data rows, the pgmq queue, storage
-- policies and the cron job. Keep docs/supabase/data-model.md in step with it.

-- New objects in public are not exposed to the Data API until granted.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated;

-- Column-level write grants: authenticated may update only these columns.
grant update (display_name, language, role, active) on public.staff to authenticated;
```

Run the Rebuild procedure (R). Then check that the diff captured the grants:

```bash
grep -ci "^grant\|^revoke" supabase/migrations/20261011120000_initial_schema.sql
grep -i "is_staff" supabase/migrations/20261011120000_initial_schema.sql | grep -ci "grant execute"
```

Expected:
- the first count is greater than 0;
- the second is at least `1`.

If either is `0`, the engine doesn't diff privileges. In that case:
- move the whole content of `90_grants.sql` into the hand-written migration, just above the column grants;
- delete `90_grants.sql`;
- record `Task 2: Ruling: diff does not capture grants — grants moved to the hand-written migration`.

Later tasks then append their `90_grants.sql` lines to the hand-written migration instead.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `supabase test db 2>&1 | tail -25`
Expected: `All tests successful.`, with 3 files and 28 tests.

- [ ] **Step 8: Commit**

```bash
git add supabase/schemas supabase/migrations supabase/tests
git commit -m "feat(db): add staff table, access helpers, RLS and explicit grants"
```

---

### Task 3: Printers, materials, settings and clients

**Files:**
- Create: `supabase/schemas/02_catalog.sql`, `supabase/schemas/03_settings.sql`, `supabase/schemas/04_clients.sql`
- Modify: `supabase/schemas/10_policies.sql` (append), `supabase/schemas/90_grants.sql` (append)
- Modify: `supabase/migrations/20261011120100_grants_and_setup.sql` (append)
- Create: `supabase/tests/database/03_catalog.test.sql`

**Interfaces:**
- Consumes: `private.is_staff()`, `private.is_owner()`, `private.set_updated_at()`.
- Produces:
  - tables `public.printers`, `public.materials`, `public.settings` (single row, `id = 1`, inserted by the
    migration) and `public.clients`;
  - `settings.quote_prefix` and `settings.default_validity_days`, which Task 4 reads.

- [ ] **Step 1: Write the failing test** at `supabase/tests/database/03_catalog.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name)
  overriding system value values (900001, 'Test Client'), (900002, 'Second Client');

-- Signed in without a staff row
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.printers), 0, 'non-staff see no printers');
select is((select count(*)::int from public.materials), 0, 'non-staff see no materials');
select is((select count(*)::int from public.settings), 0, 'non-staff see no settings');
select is((select count(*)::int from public.clients), 0, 'non-staff see no clients');

-- Operator
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select ok(exists (select 1 from public.printers where id = 900001), 'operators see printers');
select ok(exists (select 1 from public.materials where id = 900001), 'operators see materials');
select is((select count(*)::int from public.settings), 1, 'operators see the settings row');
select throws_ok(
  $$insert into public.printers (name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
    values ('X', 'Y', 1, 1, 1, 1, 1)$$,
  '42501', null, 'operators cannot add printers'
);
select results_eq(
  $$with u as (update public.printers set hourly_rate = 0 where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'operators cannot edit printers'
);
select results_eq(
  $$with u as (update public.settings set shop_name = 'Mine' returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'operators cannot edit settings'
);
select lives_ok(
  $$insert into public.clients (name, email) values ('New Client', 'new@example.com')$$,
  'operators can add clients'
);
select results_eq(
  $$with u as (update public.clients set phone = '123' where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can edit clients'
);
select results_eq(
  $$with d as (delete from public.clients where id = 900002 returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'operators cannot delete clients'
);

-- Owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.materials (name, type, density_g_cm3, cost_per_kg) values ('Owner PETG', 'PETG', 1.27, 27)$$,
  'owners can add materials'
);
select results_eq(
  $$with u as (update public.printers set hourly_rate = 2 where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'owners can edit printers'
);
select results_eq(
  $$with u as (update public.settings set shop_name = 'Test Shop' returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'owners can edit settings'
);
select results_eq(
  $$with d as (delete from public.clients where id = 900002 returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'owners can delete clients'
);
select throws_ok($$update public.settings set id = 2$$, '42501', null, 'the settings id cannot be changed');
select throws_ok(
  $$update public.settings set quote_prefix = 'Q-1'$$,
  '23514', null, 'the quote prefix is letters and digits only'
);
select throws_ok(
  $$insert into public.materials (name, type, density_g_cm3, cost_per_kg) values ('Wood', 'WOOD', 1, 1)$$,
  '23514', null, 'material types are a fixed list'
);
select throws_ok(
  $$insert into public.printers (name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
    values ('Zero', 'Z', 0, 1, 1, 1, 1)$$,
  '23514', null, 'the build volume must be positive'
);

reset role;
select throws_ok($$insert into public.settings (id) values (2)$$, '23514', null, 'settings has a single row');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db 2>&1 | tail -25`
Expected: `03_catalog.test.sql` fails with `relation "public.printers" does not exist`. The other files pass.

- [ ] **Step 3: Write the schema files**

`supabase/schemas/02_catalog.sql`:

```sql
-- Printers and materials: the shop's machines and filaments, edited by owners.

create table public.printers (
  id bigint generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  model text not null check (btrim(model) <> ''),
  build_x_mm numeric(6,1) not null check (build_x_mm > 0),
  build_y_mm numeric(6,1) not null check (build_y_mm > 0),
  build_z_mm numeric(6,1) not null check (build_z_mm > 0),
  nozzle_diameter_mm numeric(3,2) not null default 0.40 check (nozzle_diameter_mm > 0),
  hourly_rate numeric(12,2) not null check (hourly_rate >= 0),
  power_w integer not null check (power_w > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.printers enable row level security;

create trigger printers_set_updated_at
  before update on public.printers
  for each row execute function private.set_updated_at();

create table public.materials (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  type text not null check (type in ('PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'other')),
  color text,
  density_g_cm3 numeric(4,2) not null check (density_g_cm3 > 0),
  cost_per_kg numeric(12,2) not null check (cost_per_kg >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.materials enable row level security;

create trigger materials_set_updated_at
  before update on public.materials
  for each row execute function private.set_updated_at();
```

`supabase/schemas/03_settings.sql`:

```sql
-- Shop-wide settings: exactly one row (id = 1), inserted by the grants_and_setup migration.

create table public.settings (
  id smallint primary key default 1 check (id = 1),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  energy_price_kwh numeric(8,4) not null default 0 check (energy_price_kwh >= 0),
  failure_allowance_pct numeric(5,2) not null default 0 check (failure_allowance_pct between 0 and 100),
  setup_fee numeric(12,2) not null default 0 check (setup_fee >= 0),
  default_markup_pct numeric(6,2) not null default 0 check (default_markup_pct >= 0),
  minimum_item_price numeric(12,2) not null default 0 check (minimum_item_price >= 0),
  quote_prefix text not null default 'Q' check (quote_prefix ~ '^[A-Za-z0-9]{1,10}$'),
  default_validity_days smallint not null default 30 check (default_validity_days between 1 and 365),
  pdf_terms_it text,
  pdf_terms_en text,
  shop_name text,
  shop_address text,
  shop_vat_number text,
  shop_email text,
  shop_phone text,
  shop_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function private.set_updated_at();
```

`supabase/schemas/04_clients.sql`:

```sql
-- Clients who receive quotes.

create table public.clients (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  company text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function private.set_updated_at();
```

- [ ] **Step 4: Append the policies, grants and migration lines**

Append to `supabase/schemas/10_policies.sql`:

```sql

-- printers, materials: staff read, owners write
create policy printers_select on public.printers
  for select to authenticated using ((select private.is_staff()));
create policy printers_insert on public.printers
  for insert to authenticated with check ((select private.is_owner()));
create policy printers_update on public.printers
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy printers_delete on public.printers
  for delete to authenticated using ((select private.is_owner()));

create policy materials_select on public.materials
  for select to authenticated using ((select private.is_staff()));
create policy materials_insert on public.materials
  for insert to authenticated with check ((select private.is_owner()));
create policy materials_update on public.materials
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy materials_delete on public.materials
  for delete to authenticated using ((select private.is_owner()));

-- settings: staff read, owners update the single row
create policy settings_select on public.settings
  for select to authenticated using ((select private.is_staff()));
create policy settings_update on public.settings
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));

-- clients: staff read and write, owners delete
create policy clients_select on public.clients
  for select to authenticated using ((select private.is_staff()));
create policy clients_insert on public.clients
  for insert to authenticated with check ((select private.is_staff()));
create policy clients_update on public.clients
  for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy clients_delete on public.clients
  for delete to authenticated using ((select private.is_owner()));
```

Append to `supabase/schemas/90_grants.sql`:

```sql

-- printers, materials, clients
grant insert, update, delete on public.printers, public.materials, public.clients to authenticated;
```

Append to `supabase/migrations/20261011120100_grants_and_setup.sql`:

```sql
grant update (
  currency, energy_price_kwh, failure_allowance_pct, setup_fee, default_markup_pct, minimum_item_price,
  quote_prefix, default_validity_days, pdf_terms_it, pdf_terms_en, shop_name, shop_address, shop_vat_number,
  shop_email, shop_phone, shop_logo_path
) on public.settings to authenticated;

-- The single settings row.
insert into public.settings (id) values (1);
```

- [ ] **Step 5: Rebuild, run the tests and watch them pass**

Run the Rebuild procedure (R), then `supabase test db 2>&1 | tail -25`.
Expected: `All tests successful.`, with 4 files and 50 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas supabase/migrations supabase/tests
git commit -m "feat(db): add printers, materials, settings and clients with owner-only catalog writes"
```

---

### Task 4: Quotes and numbering

**Files:**
- Create: `supabase/schemas/05_quotes.sql`
- Modify: `supabase/schemas/10_policies.sql`, `supabase/schemas/90_grants.sql`,
  `supabase/migrations/20261011120100_grants_and_setup.sql` (append)
- Create: `supabase/tests/database/04_quotes.test.sql`

**Interfaces:**
- Consumes: `public.clients`, `public.staff`, `public.settings` (`quote_prefix`, `default_validity_days`),
  `private.shop_today()`.
- Produces:
  - table `public.quotes`;
  - table `private.quote_counters (year smallint pk, last_seq integer)`;
  - trigger `quotes_guard`, which raises `quote_not_draft`. Only `sent` → `accepted`/`rejected`/`expired` is allowed
    on a non-draft quote.

- [ ] **Step 1: Write the failing test** at `supabase/tests/database/04_quotes.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
-- Clean numbering state; last year reached 57, which must not carry over.
delete from public.quotes;
delete from private.quote_counters;
insert into private.quote_counters (year, last_seq)
  values (extract(year from (now() at time zone 'Europe/Rome'))::smallint - 1, 57);
update public.settings set quote_prefix = 'T', default_validity_days = 30 where id = 1;

-- Operator
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok($$insert into public.quotes (client_id, notes) values (900001, 'first')$$, 'operators can create a quote');
select lives_ok($$insert into public.quotes (client_id, notes) values (900001, 'second')$$, 'and another one');
select throws_ok(
  $$insert into public.quotes (client_id, number) values (900001, 'X-1')$$,
  '42501', null, 'the API cannot supply a quote number'
);
select throws_ok(
  $$insert into public.quotes (client_id, status) values (900001, 'sent')$$,
  '42501', null, 'the API cannot supply a status'
);
select results_eq(
  $$with u as (update public.quotes set notes = 'edited' where notes = 'first' returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can edit a draft quote'
);
select throws_ok(
  $$update public.quotes set status = 'sent' where notes = 'edited'$$,
  '42501', null, 'status cannot be changed through the API'
);
select results_eq(
  $$with d as (delete from public.quotes where notes = 'second' returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'operators cannot delete quotes'
);
select throws_ok($$select * from private.quote_counters$$, '42501', null, 'the numbering counters are not readable');

-- Numbering and defaults, checked as postgres
reset role;
select is(
  (select number from public.quotes where notes = 'edited'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-0001',
  'the first quote of the year is number 1 with the prefix from settings'
);
select is(
  (select number from public.quotes where notes = 'second'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-0002',
  'numbers are sequential'
);
select is(
  (select created_by from public.quotes where notes = 'edited'),
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  'created_by is the caller'
);
select is((select status from public.quotes where notes = 'edited'), 'draft', 'new quotes are drafts');
select is(
  (select valid_until from public.quotes where notes = 'edited'),
  (now() at time zone 'Europe/Rome')::date + 30,
  'valid_until defaults to today plus the validity days'
);

insert into public.quotes (client_id, created_by, number, number_seq, notes)
  values (900001, '00000000-0000-4000-8000-0000000000a1', 'X-1', 77, 'supplied');
select is(
  (select number from public.quotes where notes = 'supplied'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-0003',
  'supplied numbers are replaced'
);

update private.quote_counters set last_seq = 9999
  where year = extract(year from (now() at time zone 'Europe/Rome'))::smallint;
insert into public.quotes (client_id, created_by, notes)
  values (900001, '00000000-0000-4000-8000-0000000000a1', 'big');
select is(
  (select number from public.quotes where notes = 'big'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-10000',
  'numbers grow past 9999 without being cut'
);

-- Sent quotes are frozen for every role
update public.quotes set status = 'sent', sent_at = now() where notes = 'second';
select throws_ok(
  $$update public.quotes set notes = 'late edit' where notes = 'second'$$,
  'P0001', 'quote_not_draft', 'a sent quote cannot be edited, even bypassing RLS'
);
select lives_ok($$update public.quotes set status = 'accepted' where notes = 'second'$$, 'a sent quote can be accepted');
select throws_ok(
  $$update public.quotes set status = 'rejected' where notes = 'second'$$,
  'P0001', 'quote_not_draft', 'an accepted quote is final'
);
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-0000000000a2'$$,
  '23503', null, 'an auth user who created quotes cannot be deleted'
);

-- Owner
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$with d as (delete from public.quotes where notes = 'second' returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'owners cannot delete a non-draft quote'
);
select results_eq(
  $$with d as (delete from public.quotes where notes = 'big' returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'owners can delete a draft quote'
);
select throws_ok($$delete from public.clients where id = 900001$$, '23503', null, 'a client with quotes cannot be deleted');

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select throws_ok($$insert into public.quotes (client_id) values (900001)$$, '42501', null, 'non-staff cannot create quotes');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db 2>&1 | tail -25`
Expected: `04_quotes.test.sql` fails with `relation "public.quotes" does not exist`.

- [ ] **Step 3: Write `supabase/schemas/05_quotes.sql`**

```sql
-- Quotes, their yearly numbering, and the rule that only drafts can change.

create table public.quotes (
  id bigint generated always as identity primary key,
  number text not null unique,
  number_year smallint not null,
  number_seq integer not null,
  client_id bigint not null references public.clients (id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  valid_until date not null,
  notes text,
  created_by uuid not null default auth.uid() references public.staff (user_id),
  markup_override_pct numeric(6,2) check (markup_override_pct >= 0),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (number_year, number_seq)
);

create index quotes_client_id_idx on public.quotes (client_id);
create index quotes_created_by_idx on public.quotes (created_by);
create index quotes_sent_valid_until_idx on public.quotes (valid_until) where status = 'sent';

alter table public.quotes enable row level security;

-- One counter row per year; the upsert below makes numbering safe under concurrent inserts.
create table private.quote_counters (
  year smallint primary key,
  last_seq integer not null
);

alter table private.quote_counters enable row level security;

-- Assigns <prefix>-<year>-<seq> (seq zero-padded to 4 digits, longer past 9999) and the default validity.
-- Values supplied for number, number_year and number_seq are always replaced.
create or replace function private.assign_quote_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from private.shop_today())::smallint;
  v_seq integer;
  v_prefix text;
  v_validity smallint;
begin
  insert into private.quote_counters as c (year, last_seq)
  values (v_year, 1)
  on conflict (year) do update set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;

  select quote_prefix, default_validity_days into v_prefix, v_validity
  from public.settings
  where id = 1;

  new.number_year := v_year;
  new.number_seq := v_seq;
  new.number := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  if new.valid_until is null then
    new.valid_until := private.shop_today() + v_validity;
  end if;
  return new;
end;
$$;

create trigger quotes_assign_number
  before insert on public.quotes
  for each row execute function private.assign_quote_number();

-- Once a quote leaves draft, the only change allowed is sent → accepted / rejected / expired.
create or replace function private.quotes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and not (
       old.status = 'sent'
       and new.status in ('accepted', 'rejected', 'expired')
       and (to_jsonb(new) - array['status', 'updated_at']) = (to_jsonb(old) - array['status', 'updated_at'])
     ) then
    raise exception 'quote_not_draft';
  end if;
  return new;
end;
$$;

create trigger quotes_guard
  before update on public.quotes
  for each row execute function private.quotes_guard();

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function private.set_updated_at();
```

- [ ] **Step 4: Append the policies, grants and migration lines**

Append to `supabase/schemas/10_policies.sql`:

```sql

-- quotes: staff create and edit drafts, owners delete drafts
create policy quotes_select on public.quotes
  for select to authenticated using ((select private.is_staff()));
create policy quotes_insert on public.quotes
  for insert to authenticated with check ((select private.is_staff()));
create policy quotes_update on public.quotes
  for update to authenticated
  using ((select private.is_staff()) and status = 'draft')
  with check ((select private.is_staff()) and status = 'draft');
create policy quotes_delete on public.quotes
  for delete to authenticated using ((select private.is_owner()) and status = 'draft');
```

Append to `supabase/schemas/90_grants.sql`:

```sql

-- quotes (insert and update are column grants in the grants_and_setup migration)
grant delete on public.quotes to authenticated;
```

Append to `supabase/migrations/20261011120100_grants_and_setup.sql`, in the column-grants area just above the
`-- The single settings row.` block:

```sql
grant insert (client_id, valid_until, notes), update (client_id, valid_until, notes)
  on public.quotes to authenticated;
```

- [ ] **Step 5: Rebuild, run the tests and watch them pass**

Run the Rebuild procedure (R), then `supabase test db 2>&1 | tail -25`.
Expected: `All tests successful.`, with 5 files and 73 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas supabase/migrations supabase/tests
git commit -m "feat(db): add quotes with yearly numbering and draft-only editing"
```

---

### Task 5: Quote items and slicing jobs

**Files:**
- Create: `supabase/schemas/06_quote_items.sql`, `supabase/schemas/07_slicing_jobs.sql`
- Modify: `supabase/schemas/10_policies.sql`, `supabase/schemas/90_grants.sql`,
  `supabase/migrations/20261011120100_grants_and_setup.sql` (append)
- Create: `supabase/tests/database/05_quote_items.test.sql`

**Interfaces:**
- Consumes: `public.quotes`, `public.printers`, `public.materials`.
- Produces:
  - table `public.quote_items`, where `item_total` is generated as `coalesce(override_total, computed_total)`;
  - table `public.slicing_jobs`;
  - trigger `quote_items_guard`, which raises `quote_not_draft` and `quote_item_move_not_allowed`;
  - trigger `quote_items_reprice_on_quantity`.

- [ ] **Step 1: Write the failing test** at `supabase/tests/database/05_quote_items.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1'),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1');
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id,
  print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm,
  material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct,
  computed_total, priced_at
) overriding system value values
  (900001, 900001, '900001/a/part.stl', 'part.stl', 'Part', 900001, 900001, 3600, 25, 50, 40, 30,
   0.625, 1.5, 0.036, 0, 3, 2.06, 40, 10.00, now()),
  (900002, 900002, '900002/b/part.stl', 'part.stl', 'Part', 900001, 900001, 3600, 25, 50, 40, 30,
   0.625, 1.5, 0.036, 0, 3, 2.06, 40, 10.00, now());
insert into public.slicing_jobs (id, quote_item_id, status)
  overriding system value values (900001, 900001, 'succeeded');
update public.quotes set status = 'sent', sent_at = now() where id = 900002;

-- Totals and overrides (as postgres)
select is((select item_total from public.quote_items where id = 900001), 10.00::numeric, 'item_total is the computed total');
select throws_ok(
  $$update public.quote_items set override_total = 12 where id = 900001$$,
  '23514', null, 'an override needs a reason'
);
update public.quote_items set override_total = 12, override_reason = 'Repeat customer' where id = 900001;
select is((select item_total from public.quote_items where id = 900001), 12.00::numeric, 'item_total is the override when set');

-- Operator
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$with u as (update public.quote_items set description = 'Bracket' where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can edit the description of a draft item'
);
select results_eq(
  $$with u as (update public.quote_items set quantity = 3 where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can change the quantity of a draft item'
);
reset role;
select is((select computed_total from public.quote_items where id = 900001), null::numeric, 'changing the quantity clears the computed price');
select is((select item_total from public.quote_items where id = 900001), 12.00::numeric, 'and keeps the override');

set local role authenticated;
select throws_ok(
  $$update public.quote_items set computed_total = 1 where id = 900001$$,
  '42501', null, 'price columns cannot be written through the API'
);
select throws_ok(
  $$update public.quote_items set printer_id = null where id = 900001$$,
  '42501', null, 'slicing inputs change only through update_quote_item_settings'
);
select throws_ok(
  $$insert into public.quote_items (quote_id, model_path, original_filename, description)
    values (900001, '900001/x/y.stl', 'y.stl', 'y')$$,
  '42501', null, 'items are created only through create_quote_item'
);
select ok(exists (select 1 from public.slicing_jobs where id = 900001), 'staff can read slicing jobs');
select throws_ok(
  $$update public.slicing_jobs set status = 'failed' where id = 900001$$,
  '42501', null, 'slicing jobs are read-only through the API'
);
select results_eq(
  $$with u as (update public.quote_items set description = 'Late' where id = 900002 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'items of a sent quote cannot be edited'
);
select results_eq(
  $$with d as (delete from public.quote_items where id = 900002 returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'items of a sent quote cannot be deleted'
);

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.quote_items), 0, 'non-staff see no items');
select is((select count(*)::int from public.slicing_jobs), 0, 'non-staff see no slicing jobs');

-- The service role bypasses RLS but not the freeze
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
select throws_ok(
  $$update public.quote_items set computed_total = 1 where id = 900002$$,
  'P0001', 'quote_not_draft', 'even the service role cannot reprice an item of a sent quote'
);
select throws_ok(
  $$delete from public.quote_items where id = 900002$$,
  'P0001', 'quote_not_draft', 'even the service role cannot delete an item of a sent quote'
);
select lives_ok(
  $$update public.quote_items set computed_total = 11 where id = 900001$$,
  'the service role can price draft items'
);

-- Operator removes an item from a draft
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$with d as (delete from public.quote_items where id = 900001 returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'operators can remove items from a draft'
);

-- Deleting a draft quote takes its items and jobs with it
reset role;
insert into public.quote_items (id, quote_id, model_path, original_filename, description)
  overriding system value values (900003, 900001, '900001/c/part.stl', 'part.stl', 'Part');
insert into public.slicing_jobs (id, quote_item_id) overriding system value values (900003, 900003);
select lives_ok($$delete from public.quotes where id = 900001$$, 'a draft quote with items can be deleted');
select is((select count(*)::int from public.slicing_jobs where id = 900003), 0, 'its items and jobs are deleted with it');

-- Owner: printers in use stay
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$delete from public.printers where id = 900001$$, '23503', null, 'a printer used by an item cannot be deleted');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db 2>&1 | tail -25`
Expected: `05_quote_items.test.sql` fails with `relation "public.quote_items" does not exist`.

- [ ] **Step 3: Write the schema files**

`supabase/schemas/06_quote_items.sql`:

```sql
-- Quote items: one uploaded model, its print settings, slicing results and price breakdown.

create table public.quote_items (
  id bigint generated always as identity primary key,
  quote_id bigint not null references public.quotes (id) on delete cascade,
  model_path text not null unique,
  original_filename text not null,
  description text not null,
  printer_id bigint references public.printers (id) on delete restrict,
  material_id bigint references public.materials (id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  layer_height_mm numeric(3,2) not null default 0.20 check (layer_height_mm > 0),
  infill_percent smallint not null default 20 check (infill_percent between 0 and 100),
  supports boolean not null default false,
  print_time_s integer check (print_time_s >= 0),
  filament_g numeric(10,2) check (filament_g >= 0),
  bbox_x_mm numeric(6,1),
  bbox_y_mm numeric(6,1),
  bbox_z_mm numeric(6,1),
  material_cost numeric(14,4),
  machine_cost numeric(14,4),
  energy_cost numeric(14,4),
  failure_cost numeric(14,4),
  setup_fee numeric(14,4),
  markup_amount numeric(14,4),
  markup_pct numeric(6,2),
  computed_total numeric(12,2),
  override_total numeric(12,2),
  override_reason text,
  item_total numeric(12,2) generated always as (coalesce(override_total, computed_total)) stored,
  priced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_items_override_check check (
    override_total is null or (override_total >= 0 and nullif(btrim(override_reason), '') is not null)
  )
);

create index quote_items_quote_id_idx on public.quote_items (quote_id);
create index quote_items_printer_id_idx on public.quote_items (printer_id);
create index quote_items_material_id_idx on public.quote_items (material_id);

alter table public.quote_items enable row level security;

-- Items of a non-draft quote never change, for any role. FOR SHARE on the quote waits for (and blocks) a
-- concurrent mark_quote_sent, which locks the quote FOR UPDATE.
create or replace function private.quote_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' and new.quote_id <> old.quote_id then
    raise exception 'quote_item_move_not_allowed';
  end if;

  select status into v_status from public.quotes where id = old.quote_id for share;
  -- Not found: the quote itself is being deleted and this is the cascade.
  if found and v_status <> 'draft' then
    raise exception 'quote_not_draft';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger quote_items_guard
  before update or delete on public.quote_items
  for each row execute function private.quote_items_guard();

-- A new quantity invalidates the price; the override is the owner's decision and stays.
create or replace function private.quote_items_reprice_on_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity is distinct from old.quantity then
    new.material_cost := null;
    new.machine_cost := null;
    new.energy_cost := null;
    new.failure_cost := null;
    new.setup_fee := null;
    new.markup_amount := null;
    new.markup_pct := null;
    new.computed_total := null;
    new.priced_at := null;
  end if;
  return new;
end;
$$;

create trigger quote_items_reprice_on_quantity
  before update on public.quote_items
  for each row execute function private.quote_items_reprice_on_quantity();

create trigger quote_items_set_updated_at
  before update on public.quote_items
  for each row execute function private.set_updated_at();
```

`supabase/schemas/07_slicing_jobs.sql`:

```sql
-- Slicing jobs: the durable record of each slicing request. The pgmq message carries job_id.

create table public.slicing_jobs (
  id bigint generated always as identity primary key,
  quote_item_id bigint not null references public.quote_items (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts smallint not null default 0 check (attempts >= 0),
  error text,
  print_time_s integer,
  filament_g numeric(10,2),
  filament_mm numeric(10,2),
  layer_count integer,
  bbox_x_mm numeric(6,1),
  bbox_y_mm numeric(6,1),
  bbox_z_mm numeric(6,1),
  slicer_version text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Serves the foreign key and "latest job of an item" lookups.
create index slicing_jobs_quote_item_id_idx on public.slicing_jobs (quote_item_id, id desc);

alter table public.slicing_jobs enable row level security;
```

- [ ] **Step 4: Append the policies, grants and migration lines**

Append to `supabase/schemas/10_policies.sql`:

```sql

-- quote_items: staff read; staff edit and remove items of draft quotes (creation goes through create_quote_item)
create policy quote_items_select on public.quote_items
  for select to authenticated using ((select private.is_staff()));
create policy quote_items_update on public.quote_items
  for update to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  )
  with check (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );
create policy quote_items_delete on public.quote_items
  for delete to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );

-- slicing_jobs: read-only for staff
create policy slicing_jobs_select on public.slicing_jobs
  for select to authenticated using ((select private.is_staff()));
```

Append to `supabase/schemas/90_grants.sql`:

```sql

-- quote_items (update is a column grant in the grants_and_setup migration)
grant delete on public.quote_items to authenticated;
```

Append to the column-grants area of `supabase/migrations/20261011120100_grants_and_setup.sql`, just above the
`-- The single settings row.` block:

```sql
grant update (description, quantity) on public.quote_items to authenticated;
```

- [ ] **Step 5: Rebuild, run the tests and watch them pass**

Run the Rebuild procedure (R), then `supabase test db 2>&1 | tail -25`.
Expected: `All tests successful.`, with 6 files and 96 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas supabase/migrations supabase/tests
git commit -m "feat(db): add quote items and slicing jobs with frozen sent prices"
```

---

### Task 6: Item functions and the slicing queue

**Files:**
- Create: `supabase/schemas/20_quote_api.sql`
- Modify: `supabase/schemas/90_grants.sql`, `supabase/migrations/20261011120100_grants_and_setup.sql` (append)
- Create: `supabase/tests/database/06_quote_api.test.sql`

**Interfaces:**
- Consumes: the tables from Tasks 2–5, plus `pgmq.send`.
- Produces:
  - internal helpers, `security invoker`, private:
    - `private.require_staff() → void`
    - `private.require_owner() → void`
    - `private.require_draft_quote(bigint) → void`
    - `private.require_active_catalog(bigint, bigint) → void`
    - `private.enqueue_slicing_job(bigint) → bigint`
  - API functions, each with a public wrapper and a private implementation:
    - `public.create_quote_item(quote_id bigint, model_path text, original_filename text, description text,
      printer_id bigint default null, material_id bigint default null, quantity integer default 1,
      layer_height_mm numeric default 0.20, infill_percent integer default 20, supports boolean default false) →
      bigint`
    - `public.update_quote_item_settings(item_id bigint, printer_id bigint, material_id bigint,
      layer_height_mm numeric, infill_percent integer, supports boolean) → void`
    - `public.retry_slicing(item_id bigint) → bigint`
  - pgmq queue `slicing_jobs`;
  - buckets `models` and `branding`.

- [ ] **Step 1: Write the failing test** at `supabase/tests/database/06_quote_api.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w, active)
  overriding system value values
  (900001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120, true),
  (900002, 'Old MK3', 'Prusa MK3', 250, 210, 210, 1.00, 100, false);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1'),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1');
update public.quotes set status = 'sent', sent_at = now() where id = 900002;
insert into storage.objects (bucket_id, name) values
  ('models', '900001/u1/bare.stl'),
  ('models', '900001/u2/ready.stl'),
  ('models', '900002/u3/late.stl');
do $$ begin perform pgmq.purge_queue('slicing_jobs'); end $$;

-- Operator creates items
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'bare')$$,
  'staff can add an item without printer and material'
);
select lives_ok(
  $$select public.create_quote_item(900001, '900001/u2/ready.stl', 'ready.stl', 'ready', 900001, 900001)$$,
  'staff can add an item with printer and material'
);
select throws_ok(
  $$select public.create_quote_item(900001, '900002/u3/late.stl', 'late.stl', 'late')$$,
  '22023', 'invalid_model_path', 'the model must be in the quote''s folder'
);
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u9/missing.stl', 'missing.stl', 'missing')$$,
  'P0002', 'model_not_found', 'the model must have been uploaded'
);
select throws_ok(
  $$select public.create_quote_item(900002, '900002/u3/late.stl', 'late.stl', 'late')$$,
  'P0001', 'quote_not_draft', 'items can only be added to drafts'
);
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'again', 900002, 900001)$$,
  '22023', 'printer_inactive', 'inactive printers cannot be chosen'
);

reset role;
select results_eq(
  $$select quantity, layer_height_mm::numeric, infill_percent::int, supports
    from public.quote_items where model_path = '900001/u1/bare.stl'$$,
  $$values (1, 0.20, 20, false)$$,
  'new items get the default print settings'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.model_path = '900001/u1/bare.stl'),
  0,
  'no job is queued without printer and material'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.model_path = '900001/u2/ready.stl' and j.status = 'queued'),
  1,
  'a queued job is created when printer and material are set'
);
select is((select count(*)::int from pgmq.q_slicing_jobs), 1, 'one queue message is sent');
select is(
  (select message from pgmq.q_slicing_jobs),
  (select jsonb_build_object(
            'job_id', j.id, 'quote_item_id', i.id, 'model_path', i.model_path,
            'printer_id', 900001, 'material_id', 900001,
            'settings', jsonb_build_object('layer_height_mm', 0.20, 'infill_percent', 20, 'supports', false))
   from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.model_path = '900001/u2/ready.stl'),
  'the message carries the job and item ids, the model path and the settings'
);

-- Pretend the ready item was sliced and priced
update public.quote_items
  set print_time_s = 3600, filament_g = 25, bbox_x_mm = 50, bbox_y_mm = 40, bbox_z_mm = 30, computed_total = 10
  where model_path = '900001/u2/ready.stl';
update public.slicing_jobs set status = 'succeeded'
  where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl');

-- Settings changes
set local role authenticated;
select lives_ok(
  $$select public.update_quote_item_settings(
      (select id from public.quote_items where model_path = '900001/u2/ready.stl'), 900001, 900001, 0.20, 20, false)$$,
  'an unchanged settings call is accepted'
);
reset role;
select is(
  (select count(*)::int from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')),
  1,
  'and does not slice again'
);
set local role authenticated;
select lives_ok(
  $$select public.update_quote_item_settings(
      (select id from public.quote_items where model_path = '900001/u2/ready.stl'), 900001, 900001, 0.20, 40, false)$$,
  'staff can change the infill'
);
reset role;
select is(
  (select print_time_s from public.quote_items where model_path = '900001/u2/ready.stl'),
  null::integer,
  'changing a setting clears the slicing results'
);
select is(
  (select computed_total from public.quote_items where model_path = '900001/u2/ready.stl'),
  null::numeric,
  'and the price'
);
select is(
  (select count(*)::int from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')
     and status = 'queued'),
  1,
  'and queues a new job'
);
select is((select count(*)::int from pgmq.q_slicing_jobs), 2, 'with a new message');
set local role authenticated;
select lives_ok(
  $$select public.update_quote_item_settings(
      (select id from public.quote_items where model_path = '900001/u2/ready.stl'), null, 900001, 0.20, 40, false)$$,
  'the printer can be cleared'
);
reset role;
select is(
  (select count(*)::int from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')),
  2,
  'without a printer nothing is queued'
);

-- Retry
set local role authenticated;
select throws_ok(
  $$select public.retry_slicing((select id from public.quote_items where model_path = '900001/u1/bare.stl'))$$,
  'P0001', 'retry_not_allowed', 'retry needs a failed job'
);
reset role;
update public.quote_items set printer_id = 900001 where model_path = '900001/u2/ready.stl';
update public.slicing_jobs set status = 'failed'
  where id = (select max(id) from public.slicing_jobs
              where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl'));
set local role authenticated;
select lives_ok(
  $$select public.retry_slicing((select id from public.quote_items where model_path = '900001/u2/ready.stl'))$$,
  'staff can retry a failed job'
);
reset role;
select is(
  (select status from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')
   order by id desc limit 1),
  'queued',
  'the retry queues a new job'
);

-- Access
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'bare')$$,
  '42501', 'not_staff', 'non-staff cannot add items'
);
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'bare')$$,
  '42501', null, 'anon cannot call the API functions'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Add the queue and buckets to the migration, then run the test and watch it fail**

The test needs the `models` bucket and the queue, so they go in now. Append to the end of
`supabase/migrations/20261011120100_grants_and_setup.sql`:

```sql

-- Slicing queue (Supabase Queues / pgmq).
select pgmq.create('slicing_jobs');

-- Storage buckets. models: STL/3MF types vary between browsers, so only the size is limited.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('models', 'models', false, 104857600, null),
  ('branding', 'branding', false, 1048576, array['image/png', 'image/jpeg', 'image/svg+xml']);
```

Run `supabase db reset 2>&1 | tail -5`, then `supabase test db 2>&1 | tail -25`.

Expected:
- the reset succeeds;
- `06_quote_api.test.sql` fails with `function public.create_quote_item(...) does not exist`.

- [ ] **Step 3: Write `supabase/schemas/20_quote_api.sql`**

```sql
-- Functions behind the web app's actions. Each public function is a thin security-invoker wrapper around a
-- security-definer function in the non-exposed private schema, which checks the caller first. Errors use the
-- stable messages listed in docs/supabase/data-model.md.

-- Internal helpers: security invoker, called only from the security-definer functions below.

create or replace function private.require_staff()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'not_staff' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_owner()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'owner_required' using errcode = '42501';
  end if;
end;
$$;

-- Locks the quote for the rest of the transaction, so a concurrent send waits for this change and vice versa.
create or replace function private.require_draft_quote(p_quote_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'quote_not_draft';
  end if;
end;
$$;

-- Null ids are skipped, so callers pass only the printer/material they are changing.
create or replace function private.require_active_catalog(p_printer_id bigint, p_material_id bigint)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_printer_id is not null
     and not exists (select 1 from public.printers where id = p_printer_id and active) then
    raise exception 'printer_inactive' using errcode = '22023';
  end if;
  if p_material_id is not null
     and not exists (select 1 from public.materials where id = p_material_id and active) then
    raise exception 'material_inactive' using errcode = '22023';
  end if;
end;
$$;

-- Inserts a queued job and sends its message in the caller's transaction. Message format:
-- docs/services/slicer-worker.md#job-message-proposed.
create or replace function private.enqueue_slicing_job(p_item_id bigint)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_item public.quote_items;
  v_job_id bigint;
begin
  select * into strict v_item from public.quote_items where id = p_item_id;

  insert into public.slicing_jobs (quote_item_id) values (p_item_id) returning id into v_job_id;

  perform pgmq.send(
    'slicing_jobs',
    jsonb_build_object(
      'job_id', v_job_id,
      'quote_item_id', v_item.id,
      'model_path', v_item.model_path,
      'printer_id', v_item.printer_id,
      'material_id', v_item.material_id,
      'settings', jsonb_build_object(
        'layer_height_mm', v_item.layer_height_mm,
        'infill_percent', v_item.infill_percent,
        'supports', v_item.supports
      )
    )
  );
  return v_job_id;
end;
$$;

-- create_quote_item: the model must already be uploaded to models/<quote_id>/…

create or replace function private.create_quote_item(
  p_quote_id bigint,
  p_model_path text,
  p_original_filename text,
  p_description text,
  p_printer_id bigint,
  p_material_id bigint,
  p_quantity integer,
  p_layer_height_mm numeric,
  p_infill_percent integer,
  p_supports boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id bigint;
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);

  if p_model_path is null or split_part(p_model_path, '/', 1) <> p_quote_id::text then
    raise exception 'invalid_model_path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'models' and name = p_model_path) then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;
  perform private.require_active_catalog(p_printer_id, p_material_id);

  insert into public.quote_items (
    quote_id, model_path, original_filename, description, printer_id, material_id,
    quantity, layer_height_mm, infill_percent, supports
  ) values (
    p_quote_id, p_model_path, p_original_filename, p_description, p_printer_id, p_material_id,
    coalesce(p_quantity, 1), coalesce(p_layer_height_mm, 0.20), coalesce(p_infill_percent, 20),
    coalesce(p_supports, false)
  )
  returning id into v_item_id;

  if p_printer_id is not null and p_material_id is not null then
    perform private.enqueue_slicing_job(v_item_id);
  end if;
  return v_item_id;
end;
$$;

create or replace function public.create_quote_item(
  quote_id bigint,
  model_path text,
  original_filename text,
  description text,
  printer_id bigint default null,
  material_id bigint default null,
  quantity integer default 1,
  layer_height_mm numeric default 0.20,
  infill_percent integer default 20,
  supports boolean default false
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_quote_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
$$;

-- update_quote_item_settings: replaces all slicing inputs; any change discards results and price (the override
-- stays) and slices again when printer and material are set.

create or replace function private.update_quote_item_settings(
  p_item_id bigint,
  p_printer_id bigint,
  p_material_id bigint,
  p_layer_height_mm numeric,
  p_infill_percent integer,
  p_supports boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.quote_items;
begin
  perform private.require_staff();
  select * into v_item from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_item.quote_id);
  select * into v_item from public.quote_items where id = p_item_id for update;

  if v_item.printer_id is not distinct from p_printer_id
     and v_item.material_id is not distinct from p_material_id
     and v_item.layer_height_mm is not distinct from p_layer_height_mm
     and v_item.infill_percent is not distinct from p_infill_percent
     and v_item.supports is not distinct from p_supports then
    return;
  end if;

  perform private.require_active_catalog(
    case when p_printer_id is distinct from v_item.printer_id then p_printer_id end,
    case when p_material_id is distinct from v_item.material_id then p_material_id end
  );

  update public.quote_items set
    printer_id = p_printer_id,
    material_id = p_material_id,
    layer_height_mm = p_layer_height_mm,
    infill_percent = p_infill_percent,
    supports = p_supports,
    print_time_s = null,
    filament_g = null,
    bbox_x_mm = null,
    bbox_y_mm = null,
    bbox_z_mm = null,
    material_cost = null,
    machine_cost = null,
    energy_cost = null,
    failure_cost = null,
    setup_fee = null,
    markup_amount = null,
    markup_pct = null,
    computed_total = null,
    priced_at = null
  where id = p_item_id;

  if p_printer_id is not null and p_material_id is not null then
    perform private.enqueue_slicing_job(p_item_id);
  end if;
end;
$$;

create or replace function public.update_quote_item_settings(
  item_id bigint,
  printer_id bigint,
  material_id bigint,
  layer_height_mm numeric,
  infill_percent integer,
  supports boolean
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_quote_item_settings($1, $2, $3, $4, $5, $6);
$$;

-- retry_slicing: only after the item's latest job failed.

create or replace function private.retry_slicing(p_item_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.quote_items;
  v_last_status text;
begin
  perform private.require_staff();
  select * into v_item from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_item.quote_id);

  select status into v_last_status
  from public.slicing_jobs
  where quote_item_id = p_item_id
  order by id desc
  limit 1;

  if v_last_status is distinct from 'failed' or v_item.printer_id is null or v_item.material_id is null then
    raise exception 'retry_not_allowed';
  end if;
  return private.enqueue_slicing_job(p_item_id);
end;
$$;

create or replace function public.retry_slicing(item_id bigint)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.retry_slicing($1);
$$;
```

- [ ] **Step 4: Append the grants**

Append to `supabase/schemas/90_grants.sql`:

```sql

-- item functions
grant execute on function
  public.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  private.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  public.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  private.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  public.retry_slicing(bigint),
  private.retry_slicing(bigint)
to authenticated;
```

- [ ] **Step 5: Rebuild, run the tests and watch them pass**

Run the Rebuild procedure (R), then `supabase test db 2>&1 | tail -25`.
Expected: `All tests successful.`, with 7 files and 121 tests.

If the message test fails on the pgmq signature, run `psql` via `supabase db query`, or
`docker exec supabase_db_3d-quote psql -U postgres -c '\df pgmq.send'`. Then fix the call to match and record a
`Ruling:`. pgmq 1.5 added overloads with `headers`.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas supabase/migrations supabase/tests
git commit -m "feat(db): add create/update/retry item functions with transactional slicing queue"
```

---

### Task 7: Overrides, sending and quote outcomes

**Files:**
- Modify: `supabase/schemas/20_quote_api.sql` (append), `supabase/schemas/90_grants.sql` (append)
- Create: `supabase/tests/database/07_lifecycle.test.sql`

**Interfaces:**
- Consumes: the helpers from Task 6.
- Produces:
  - `public.set_markup_override(quote_id bigint, pct numeric) → void`
  - `public.set_price_override(item_id bigint, total numeric, reason text) → void`
  - `public.clear_price_override(item_id bigint) → void`
  - `public.get_quote_send_blockers(quote_id bigint) → table(quote_item_id bigint, code text)`
  - `public.mark_quote_sent(quote_id bigint) → void`
  - `public.mark_quote_accepted(quote_id bigint) → void`
  - `public.mark_quote_rejected(quote_id bigint) → void`
  - `private.expire_quotes() → integer`, which Task 9's cron job calls.

- [ ] **Step 1: Write the failing test** at `supabase/tests/database/07_lifecycle.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
-- 900001 complete draft · 900002 draft with problems · 900003 empty draft, past due
-- 900004 sent, past due · 900005 sent, valid today · 900006 sent
insert into public.quotes (id, client_id, created_by, status, sent_at, valid_until) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date + 30),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date + 30),
  (900003, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date - 1),
  (900004, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date - 1),
  (900005, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date),
  (900006, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date + 30);
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id,
  print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, computed_total
) overriding system value values
  (900001, 900001, '900001/a/ok.stl', 'ok.stl', 'OK', 900001, 900001, 3600, 25, 50, 40, 30, 10.00),
  (900002, 900002, '900002/a/nomat.stl', 'nomat.stl', 'No material', 900001, null, null, null, null, null, null, null),
  (900003, 900002, '900002/b/big.stl', 'big.stl', 'Too big', 900001, 900001, 3600, 25, 300, 40, 30, null);
insert into public.slicing_jobs (quote_item_id, status) values (900001, 'succeeded'), (900003, 'failed');

-- Operator: send checks and outcomes
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is_empty($$select * from public.get_quote_send_blockers(900001)$$, 'a complete quote has no blockers');
select results_eq(
  $$select quote_item_id, code from public.get_quote_send_blockers(900002)$$,
  $$values (900002::bigint, 'missing_printer_or_material'::text), (900002, 'not_priced'), (900002, 'not_sliced'),
           (900003, 'does_not_fit'), (900003, 'not_priced'), (900003, 'not_sliced')$$,
  'each incomplete item is reported with its reasons'
);
select results_eq(
  $$select quote_item_id, code from public.get_quote_send_blockers(900003)$$,
  $$values (null::bigint, 'no_items'::text), (null::bigint, 'valid_until_past'::text)$$,
  'quote-level problems are reported without an item'
);
select results_eq(
  $$select quote_item_id, code from public.get_quote_send_blockers(900004)$$,
  $$values (null::bigint, 'not_draft'::text)$$,
  'a sent quote reports only not_draft'
);
select throws_ok($$select public.mark_quote_sent(900002)$$, 'P0001', 'quote_not_sendable', 'a quote with blockers cannot be sent');
select lives_ok($$select public.mark_quote_sent(900001)$$, 'a complete quote can be sent');
select is((select status from public.quotes where id = 900001), 'sent', 'its status is sent');
select isnt((select sent_at from public.quotes where id = 900001), null, 'and the sent date is recorded');
select throws_ok($$select public.mark_quote_sent(900001)$$, 'P0001', 'quote_not_draft', 'a quote is sent only once');
select throws_ok($$select public.mark_quote_accepted(900002)$$, 'P0001', 'quote_not_sent', 'only sent quotes can be accepted');
select lives_ok($$select public.mark_quote_accepted(900001)$$, 'a sent quote can be accepted');
select throws_ok($$select public.mark_quote_rejected(900001)$$, 'P0001', 'quote_not_sent', 'an accepted quote cannot be rejected');
select lives_ok($$select public.mark_quote_rejected(900006)$$, 'a sent quote can be rejected');

-- Daily expiry
reset role;
select is(private.expire_quotes(), 1, 'one past-due sent quote expires');
select is((select status from public.quotes where id = 900004), 'expired', 'the past-due sent quote is expired');
select is((select status from public.quotes where id = 900005), 'sent', 'a quote valid until today stays sent');
select is((select status from public.quotes where id = 900003), 'draft', 'drafts never expire');

-- Overrides
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id, computed_total
) overriding system value values (900007, 900002, '900002/c/priced.stl', 'priced.stl', 'Priced', 900001, 900001, 10.00);
set local role authenticated;
select throws_ok(
  $$select public.set_price_override(900003, 50, 'Friend')$$,
  '42501', 'owner_required', 'operators cannot override prices'
);
select throws_ok(
  $$select public.set_markup_override(900002, 10)$$,
  '42501', 'owner_required', 'operators cannot override the markup'
);
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.set_price_override(900003, 50, '  ')$$,
  '22023', 'invalid_override', 'an override needs a reason'
);
select throws_ok(
  $$select public.set_price_override(900003, -1, 'Oops')$$,
  '22023', 'invalid_override', 'an override cannot be negative'
);
select lives_ok($$select public.set_price_override(900003, 50, 'Friend')$$, 'owners can override a draft item');
select is((select item_total from public.quote_items where id = 900003), 50.00::numeric, 'the override becomes the item total');
select lives_ok($$select public.clear_price_override(900003)$$, 'owners can remove an override');
select is((select override_total from public.quote_items where id = 900003), null::numeric, 'the override is gone');
select throws_ok(
  $$select public.set_price_override(900001, 50, 'Late')$$,
  'P0001', 'quote_not_draft', 'prices of a sent quote are frozen'
);
select throws_ok(
  $$select public.set_markup_override(900002, -5)$$,
  '22023', 'invalid_markup', 'the markup cannot be negative'
);
select lives_ok($$select public.set_markup_override(900002, 25)$$, 'owners can override the markup of a draft');
select is((select markup_override_pct from public.quotes where id = 900002), 25.00::numeric, 'the markup override is saved');
select is((select computed_total from public.quote_items where id = 900007), null::numeric, 'and every item is re-priced');
select lives_ok($$select public.set_markup_override(900002, null)$$, 'the markup override can be removed');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db 2>&1 | tail -25`
Expected: `07_lifecycle.test.sql` fails with `function public.get_quote_send_blockers(integer) does not exist`.

- [ ] **Step 3: Append to `supabase/schemas/20_quote_api.sql`**

```sql

-- Owner overrides (draft quotes only). A markup change invalidates every item's price.

create or replace function private.set_markup_override(p_quote_id bigint, p_pct numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_owner();
  perform private.require_draft_quote(p_quote_id);
  if p_pct < 0 then
    raise exception 'invalid_markup' using errcode = '22023';
  end if;

  update public.quotes set markup_override_pct = p_pct where id = p_quote_id;
  update public.quote_items set
    material_cost = null,
    machine_cost = null,
    energy_cost = null,
    failure_cost = null,
    setup_fee = null,
    markup_amount = null,
    markup_pct = null,
    computed_total = null,
    priced_at = null
  where quote_id = p_quote_id;
end;
$$;

create or replace function public.set_markup_override(quote_id bigint, pct numeric)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_markup_override($1, $2);
$$;

create or replace function private.set_price_override(p_item_id bigint, p_total numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
begin
  perform private.require_owner();
  select quote_id into v_quote_id from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);
  if p_total is null or p_total < 0 or nullif(btrim(p_reason), '') is null then
    raise exception 'invalid_override' using errcode = '22023';
  end if;

  update public.quote_items
  set override_total = p_total, override_reason = btrim(p_reason)
  where id = p_item_id;
end;
$$;

create or replace function public.set_price_override(item_id bigint, total numeric, reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_price_override($1, $2, $3);
$$;

create or replace function private.clear_price_override(p_item_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
begin
  perform private.require_owner();
  select quote_id into v_quote_id from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);

  update public.quote_items set override_total = null, override_reason = null where id = p_item_id;
end;
$$;

create or replace function public.clear_price_override(item_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.clear_price_override($1);
$$;

-- Send check: one row per problem; quote-level problems have a null item id. Empty means the quote can be sent.

create or replace function private.get_quote_send_blockers(p_quote_id bigint)
returns table (quote_item_id bigint, code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_quote public.quotes;
begin
  perform private.require_staff();
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  if v_quote.status <> 'draft' then
    return query select null::bigint, 'not_draft'::text;
    return;
  end if;
  if not exists (select 1 from public.quote_items where quote_id = p_quote_id) then
    return query select null::bigint, 'no_items'::text;
  end if;
  if v_quote.valid_until < private.shop_today() then
    return query select null::bigint, 'valid_until_past'::text;
  end if;

  return query
  select i.id, b.code
  from public.quote_items i
  left join public.printers p on p.id = i.printer_id
  left join lateral (
    select j.status
    from public.slicing_jobs j
    where j.quote_item_id = i.id
    order by j.id desc
    limit 1
  ) lj on true
  cross join lateral (
    values
      (case when i.printer_id is null or i.material_id is null then 'missing_printer_or_material' end),
      (case when lj.status is distinct from 'succeeded' or i.print_time_s is null or i.filament_g is null
              or i.bbox_x_mm is null then 'not_sliced' end),
      (case when i.item_total is null then 'not_priced' end),
      (case when i.bbox_x_mm > p.build_x_mm or i.bbox_y_mm > p.build_y_mm or i.bbox_z_mm > p.build_z_mm
            then 'does_not_fit' end)
  ) as b (code)
  where i.quote_id = p_quote_id and b.code is not null
  order by i.id, b.code;
end;
$$;

create or replace function public.get_quote_send_blockers(quote_id bigint)
returns table (quote_item_id bigint, code text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_quote_send_blockers($1);
$$;

create or replace function private.mark_quote_sent(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);
  if exists (select 1 from private.get_quote_send_blockers(p_quote_id)) then
    raise exception 'quote_not_sendable';
  end if;
  update public.quotes set status = 'sent', sent_at = now() where id = p_quote_id;
end;
$$;

create or replace function public.mark_quote_sent(quote_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_quote_sent($1);
$$;

-- Accepted / rejected: only from sent. Internal helper shared by the two functions below.
create or replace function private.mark_quote_outcome(p_quote_id bigint, p_status text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.require_staff();
  select status into v_status from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'sent' then
    raise exception 'quote_not_sent';
  end if;
  update public.quotes set status = p_status where id = p_quote_id;
end;
$$;

create or replace function private.mark_quote_accepted(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_quote_outcome(p_quote_id, 'accepted');
end;
$$;

create or replace function public.mark_quote_accepted(quote_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_quote_accepted($1);
$$;

create or replace function private.mark_quote_rejected(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_quote_outcome(p_quote_id, 'rejected');
end;
$$;

create or replace function public.mark_quote_rejected(quote_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_quote_rejected($1);
$$;

-- Daily job (pg_cron, see the grants_and_setup migration): sent quotes past their validity become expired.
create or replace function private.expire_quotes()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.quotes set status = 'expired'
  where status = 'sent' and valid_until < private.shop_today();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
```

- [ ] **Step 4: Append the grants** to `supabase/schemas/90_grants.sql`

```sql

-- overrides, send check and outcomes
grant execute on function
  public.set_markup_override(bigint, numeric),
  private.set_markup_override(bigint, numeric),
  public.set_price_override(bigint, numeric, text),
  private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint),
  private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint),
  private.get_quote_send_blockers(bigint),
  public.mark_quote_sent(bigint),
  private.mark_quote_sent(bigint),
  public.mark_quote_accepted(bigint),
  private.mark_quote_accepted(bigint),
  public.mark_quote_rejected(bigint),
  private.mark_quote_rejected(bigint)
to authenticated;
```

- [ ] **Step 5: Rebuild, run the tests and watch them pass**

Run the Rebuild procedure (R), then `supabase test db 2>&1 | tail -25`.
Expected: `All tests successful.`, with 8 files and 152 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas supabase/tests
git commit -m "feat(db): add price/markup overrides, send check, quote outcomes and expiry"
```

---

### Task 8: Worker functions

**Files:**
- Create: `supabase/schemas/21_worker_api.sql`
- Modify: `supabase/schemas/90_grants.sql` (append)
- Create: `supabase/tests/database/08_worker.test.sql`

**Interfaces:**
- Consumes: `public.slicing_jobs`, `public.quote_items`, `private.enqueue_slicing_job(bigint)`, pgmq `read`,
  `delete` and `archive`.
- Produces, each with a public wrapper executable only by `service_role`:
  - `public.worker_claim_job(visibility_timeout_s integer, max_attempts integer) → table(msg_id bigint,
    read_ct integer, message jsonb)`
  - `public.worker_complete_job(msg_id bigint, job_id bigint, results jsonb) → void`
  - `public.worker_fail_job(msg_id bigint, job_id bigint, error text, final boolean) → void`

- [ ] **Step 1: Write the failing test** at `supabase/tests/database/08_worker.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local');
insert into public.staff (user_id, display_name, role) values ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by)
  overriding system value values (900001, 900001, '00000000-0000-4000-8000-0000000000a1');
insert into public.quote_items (id, quote_id, model_path, original_filename, description, printer_id, material_id)
  overriding system value values
  (900001, 900001, '900001/a/one.stl', 'one.stl', 'One', 900001, 900001),
  (900002, 900001, '900001/b/two.stl', 'two.stl', 'Two', 900001, 900001);
do $$ begin
  perform pgmq.purge_queue('slicing_jobs');
  delete from pgmq.a_slicing_jobs;
  perform private.enqueue_slicing_job(900001);
end $$;

-- Claim and complete (as postgres; privileges are checked at the end)
select results_eq(
  $$select (message->>'job_id')::bigint, read_ct from public.worker_claim_job(600, 3)$$,
  $$select max(id), 1 from public.slicing_jobs where quote_item_id = 900001$$,
  'claim returns the next message'
);
select is((select status from public.slicing_jobs where quote_item_id = 900001), 'running', 'the claimed job is running');
select is((select attempts from public.slicing_jobs where quote_item_id = 900001), 1::smallint, 'with its attempt number');
select isnt((select started_at from public.slicing_jobs where quote_item_id = 900001), null, 'and its start time');
select is_empty($$select * from public.worker_claim_job(600, 3)$$, 'a claimed message is invisible to the next claim');
select lives_ok(
  $$select public.worker_complete_job(
      (select msg_id from pgmq.q_slicing_jobs order by msg_id limit 1),
      (select max(id) from public.slicing_jobs where quote_item_id = 900001),
      '{"print_time_s": 3600, "filament_g": 25.5, "filament_mm": 8500, "layer_count": 150,
        "bbox_x_mm": 50, "bbox_y_mm": 40, "bbox_z_mm": 30, "slicer_version": "PrusaSlicer 2.9.0"}')$$,
  'complete accepts the results'
);
select results_eq(
  $$select status, print_time_s, filament_g, layer_count, slicer_version
    from public.slicing_jobs where quote_item_id = 900001$$,
  $$values ('succeeded'::text, 3600, 25.50::numeric, 150, 'PrusaSlicer 2.9.0'::text)$$,
  'the job stores the results'
);
select results_eq(
  $$select print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm from public.quote_items where id = 900001$$,
  $$values (3600, 25.50::numeric, 50.0::numeric, 40.0::numeric, 30.0::numeric)$$,
  'the newest job''s results are copied onto the item'
);
select is((select count(*)::int from pgmq.q_slicing_jobs), 0, 'the message is deleted');
select is((select count(*)::int from pgmq.a_slicing_jobs), 0, 'not archived');

-- An older job never overwrites a newer one
do $$ begin
  perform private.enqueue_slicing_job(900002);
  perform private.enqueue_slicing_job(900002);
  perform * from public.worker_claim_job(600, 3);
  perform * from public.worker_claim_job(600, 3);
end $$;
select lives_ok(
  $$select public.worker_complete_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900002)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900002),
      '{"print_time_s": 1000, "filament_g": 10, "bbox_x_mm": 10, "bbox_y_mm": 10, "bbox_z_mm": 10}')$$,
  'the newer job completes first'
);
select lives_ok(
  $$select public.worker_complete_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select min(id) from public.slicing_jobs where quote_item_id = 900002)),
      (select min(id) from public.slicing_jobs where quote_item_id = 900002),
      '{"print_time_s": 2000, "filament_g": 20, "bbox_x_mm": 20, "bbox_y_mm": 20, "bbox_z_mm": 20}')$$,
  'the older job completes later'
);
select is((select print_time_s from public.quote_items where id = 900002), 1000, 'an older job never overwrites newer results');
select is(
  (select status from public.slicing_jobs where id = (select min(id) from public.slicing_jobs where quote_item_id = 900002)),
  'succeeded',
  'the older job is still recorded as succeeded'
);

-- Failures
do $$ begin
  perform private.enqueue_slicing_job(900001);
  perform * from public.worker_claim_job(600, 3);
end $$;
select lives_ok(
  $$select public.worker_fail_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900001),
      'slicer crashed', false)$$,
  'a non-final failure is recorded'
);
select results_eq(
  $$select status, error from public.slicing_jobs
    where id = (select max(id) from public.slicing_jobs where quote_item_id = 900001)$$,
  $$values ('queued'::text, 'slicer crashed'::text)$$,
  'the job goes back to queued with the error'
);
select is(
  (select count(*)::int from pgmq.q_slicing_jobs
   where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
  1,
  'the message stays for redelivery'
);
select lives_ok(
  $$select public.worker_fail_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900001),
      'slicer crashed again', true)$$,
  'a final failure is recorded'
);
select results_eq(
  $$select status, finished_at is not null from public.slicing_jobs
    where id = (select max(id) from public.slicing_jobs where quote_item_id = 900001)$$,
  $$values ('failed'::text, true)$$,
  'the job is failed with its finish time'
);
select is(
  (select count(*)::int from pgmq.a_slicing_jobs
   where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
  1,
  'and its message is archived'
);

-- A message read more often than allowed (the worker died every time)
do $$ begin
  perform private.enqueue_slicing_job(900002);
  perform * from pgmq.read('slicing_jobs', 0, 1);
  perform * from pgmq.read('slicing_jobs', 0, 1);
  perform * from pgmq.read('slicing_jobs', 0, 1);
end $$;
select is_empty($$select * from public.worker_claim_job(600, 2)$$, 'a message read more than max_attempts times is not handed out');
select results_eq(
  $$select status, error from public.slicing_jobs
    where id = (select max(id) from public.slicing_jobs where quote_item_id = 900002)$$,
  $$values ('failed'::text, 'worker stopped on every attempt'::text)$$,
  'its job is failed'
);
select is(
  (select count(*)::int from pgmq.a_slicing_jobs
   where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900002)),
  1,
  'and its message archived'
);

select throws_ok(
  $$select public.worker_complete_job(1, 1, '{"print_time_s": 10}')$$,
  '22023', 'invalid_results', 'incomplete results are rejected'
);

-- The item was deleted while its job ran
do $$ begin
  perform private.enqueue_slicing_job(900002);
  perform * from public.worker_claim_job(600, 3);
  perform set_config('test.job_id', (select max(id)::text from public.slicing_jobs where quote_item_id = 900002), true);
  perform set_config(
    'test.msg_id',
    (select msg_id::text from pgmq.q_slicing_jobs where message->>'job_id' = current_setting('test.job_id')),
    true
  );
  delete from public.quote_items where id = 900002;
end $$;
select lives_ok(
  $$select public.worker_complete_job(
      current_setting('test.msg_id')::bigint, current_setting('test.job_id')::bigint,
      '{"print_time_s": 1, "filament_g": 1, "bbox_x_mm": 1, "bbox_y_mm": 1, "bbox_z_mm": 1}')$$,
  'completing a job whose item was deleted does not fail'
);
select is(
  (select count(*)::int from pgmq.a_slicing_jobs where msg_id = current_setting('test.msg_id')::bigint),
  1,
  'its message is archived'
);

-- Privileges
select ok(has_function_privilege('service_role', 'public.worker_claim_job(integer, integer)', 'execute'), 'the service role can claim jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_claim_job(integer, integer)', 'execute'), 'staff cannot claim jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_complete_job(bigint, bigint, jsonb)', 'execute'), 'staff cannot complete jobs');
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
select is_empty($$select * from public.worker_claim_job(600, 3)$$, 'the service role reaches the worker functions through the wrappers');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db 2>&1 | tail -25`
Expected: `08_worker.test.sql` fails with `function public.worker_claim_job(integer, integer) does not exist`.

- [ ] **Step 3: Write `supabase/schemas/21_worker_api.sql`**

```sql
-- Functions used by the slicer-worker (service role only). Each changes the job, the item and the queue message in
-- one transaction. See docs/services/slicer-worker.md#processing-loop.

-- Reads the next message and marks its job running. Messages read more than max_attempts times (the worker died on
-- every attempt) fail their job and are archived; messages whose job no longer exists are archived. Returns no rows
-- when nothing is ready.
create or replace function private.worker_claim_job(p_visibility_timeout_s integer, p_max_attempts integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_msg record;
  v_job_id bigint;
begin
  loop
    select m.msg_id, m.read_ct, m.message into v_msg
    from pgmq.read('slicing_jobs', p_visibility_timeout_s, 1) as m;
    if not found then
      return;
    end if;

    select j.id into v_job_id
    from public.slicing_jobs j
    where j.id = (v_msg.message ->> 'job_id')::bigint
    for update;

    if not found then
      perform pgmq.archive('slicing_jobs', v_msg.msg_id);
    elsif v_msg.read_ct > p_max_attempts then
      update public.slicing_jobs
      set status = 'failed', error = 'worker stopped on every attempt', finished_at = now()
      where id = v_job_id;
      perform pgmq.archive('slicing_jobs', v_msg.msg_id);
    else
      update public.slicing_jobs
      set status = 'running', started_at = now(), attempts = v_msg.read_ct
      where id = v_job_id;
      return query select v_msg.msg_id, v_msg.read_ct, v_msg.message;
      return;
    end if;
  end loop;
end;
$$;

create or replace function public.worker_claim_job(visibility_timeout_s integer, max_attempts integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
security invoker
set search_path = ''
as $$
  select * from private.worker_claim_job($1, $2);
$$;

-- Stores the results, deletes the message, and copies the results onto the item only when this is the item's
-- newest job and the quote is still a draft, so a slow older job never overwrites newer results.
create or replace function private.worker_complete_job(p_msg_id bigint, p_job_id bigint, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.slicing_jobs;
begin
  if p_results is null
     or p_results ->> 'print_time_s' is null
     or p_results ->> 'filament_g' is null
     or p_results ->> 'bbox_x_mm' is null
     or p_results ->> 'bbox_y_mm' is null
     or p_results ->> 'bbox_z_mm' is null then
    raise exception 'invalid_results' using errcode = '22023';
  end if;

  select * into v_job from public.slicing_jobs where id = p_job_id for update;
  if not found then
    -- The item (and its jobs) was deleted while the job ran.
    perform pgmq.archive('slicing_jobs', p_msg_id);
    return;
  end if;

  update public.slicing_jobs set
    status = 'succeeded',
    error = null,
    finished_at = now(),
    print_time_s = (p_results ->> 'print_time_s')::integer,
    filament_g = (p_results ->> 'filament_g')::numeric,
    filament_mm = (p_results ->> 'filament_mm')::numeric,
    layer_count = (p_results ->> 'layer_count')::integer,
    bbox_x_mm = (p_results ->> 'bbox_x_mm')::numeric,
    bbox_y_mm = (p_results ->> 'bbox_y_mm')::numeric,
    bbox_z_mm = (p_results ->> 'bbox_z_mm')::numeric,
    slicer_version = p_results ->> 'slicer_version'
  where id = p_job_id;

  update public.quote_items i set
    print_time_s = (p_results ->> 'print_time_s')::integer,
    filament_g = (p_results ->> 'filament_g')::numeric,
    bbox_x_mm = (p_results ->> 'bbox_x_mm')::numeric,
    bbox_y_mm = (p_results ->> 'bbox_y_mm')::numeric,
    bbox_z_mm = (p_results ->> 'bbox_z_mm')::numeric
  where i.id = v_job.quote_item_id
    and p_job_id = (select max(j.id) from public.slicing_jobs j where j.quote_item_id = i.id)
    and exists (select 1 from public.quotes q where q.id = i.quote_id and q.status = 'draft');

  perform pgmq.delete('slicing_jobs', p_msg_id);
end;
$$;

create or replace function public.worker_complete_job(msg_id bigint, job_id bigint, results jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.worker_complete_job($1, $2, $3);
$$;

-- Records an error. Final: the job fails and the message is archived. Otherwise the job goes back to queued and
-- the message reappears after its visibility timeout.
create or replace function private.worker_fail_job(p_msg_id bigint, p_job_id bigint, p_error text, p_final boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.slicing_jobs where id = p_job_id for update;
  if not found then
    perform pgmq.archive('slicing_jobs', p_msg_id);
    return;
  end if;

  if p_final then
    update public.slicing_jobs set status = 'failed', error = p_error, finished_at = now() where id = p_job_id;
    perform pgmq.archive('slicing_jobs', p_msg_id);
  else
    update public.slicing_jobs set status = 'queued', error = p_error where id = p_job_id;
  end if;
end;
$$;

create or replace function public.worker_fail_job(msg_id bigint, job_id bigint, error text, final boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.worker_fail_job($1, $2, $3, $4);
$$;
```

- [ ] **Step 4: Append the grants** to `supabase/schemas/90_grants.sql`

```sql

-- worker functions: service role only
grant execute on function
  public.worker_claim_job(integer, integer),
  private.worker_claim_job(integer, integer),
  public.worker_complete_job(bigint, bigint, jsonb),
  private.worker_complete_job(bigint, bigint, jsonb),
  public.worker_fail_job(bigint, bigint, text, boolean),
  private.worker_fail_job(bigint, bigint, text, boolean)
to service_role;
```

- [ ] **Step 5: Rebuild, run the tests and watch them pass**

Run the Rebuild procedure (R), then `supabase test db 2>&1 | tail -25`.
Expected: `All tests successful.`, with 9 files and 182 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas supabase/tests
git commit -m "feat(db): add worker claim/complete/fail functions with stale-result guard"
```

---

### Task 9: Storage policies and the expiry job

**Files:**
- Modify: `supabase/schemas/20_quote_api.sql` (append), `supabase/schemas/90_grants.sql` (append)
- Modify: `supabase/migrations/20261011120100_grants_and_setup.sql` (append)
- Create: `supabase/tests/database/09_setup_storage.test.sql`

**Interfaces:**
- Consumes: the buckets and queue from Task 6, `private.expire_quotes()` from Task 7.
- Produces:
  - `private.can_upload_model(p_name text) → boolean`;
  - storage policies `models: …` and `branding: …`;
  - cron job `expire-quotes`.

- [ ] **Step 1: Write the failing test** at `supabase/tests/database/09_setup_storage.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by, status, sent_at) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now());
insert into storage.objects (bucket_id, name) values
  ('models', '900001/seed/existing.stl'),
  ('branding', 'test-logo.png');

-- What the migration sets up
select is((select count(*)::int from public.settings), 1, 'settings has its single row');
select ok(exists (select 1 from pgmq.list_queues() where queue_name = 'slicing_jobs'), 'the slicing_jobs queue exists');
select results_eq(
  $$select id, public, file_size_limit, allowed_mime_types from storage.buckets
    where id in ('branding', 'models') order by id$$,
  $$values ('branding'::text, false, 1048576::bigint, array['image/png', 'image/jpeg', 'image/svg+xml']::text[]),
           ('models'::text, false, 104857600::bigint, null::text[])$$,
  'both buckets are private with their size limits'
);
select results_eq(
  $$select schedule, command from cron.job where jobname = 'expire-quotes'$$,
  $$values ('15 0 * * *'::text, 'select private.expire_quotes()'::text)$$,
  'quotes are expired by a daily cron job'
);
select is(
  array(
    select policyname::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'models:%' or policyname like 'branding:%')
    order by 1
  ),
  array[
    'branding: owner delete', 'branding: owner update', 'branding: owner upload', 'branding: staff read',
    'models: staff delete', 'models: staff read', 'models: staff update in draft quotes',
    'models: staff upload to draft quotes'
  ],
  'all storage policies are in place'
);

-- Operator
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', '900001/u1/part.stl')$$,
  'staff can upload into a draft quote''s folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', '900002/u1/part.stl')$$,
  '42501', null, 'not into a sent quote''s folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', 'loose/part.stl')$$,
  '42501', null, 'not outside a quote folder'
);
select ok(exists (select 1 from storage.objects where name = '900001/seed/existing.stl'), 'staff can read models');
select ok(exists (select 1 from storage.objects where name = 'test-logo.png'), 'staff can read branding');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('branding', 'other.png')$$,
  '42501', null, 'operators cannot upload branding'
);

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select ok(
  not exists (select 1 from storage.objects where bucket_id in ('models', 'branding')),
  'non-staff see no files'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', '900001/u2/part.stl')$$,
  '42501', null, 'non-staff cannot upload models'
);

-- Owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('branding', 'logo2.png')$$,
  'owners can upload branding'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `supabase test db 2>&1 | tail -25`

Expected: `09_setup_storage.test.sql` fails on:
- the cron and policies assertions;
- the RLS assertions, because without policies, inserts are denied and reads return nothing.

- [ ] **Step 3: Append the upload helper** to `supabase/schemas/20_quote_api.sql`

```sql

-- Storage upload rule for the models bucket: the first folder must be the id of a draft quote.
create or replace function private.can_upload_model(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if not private.is_staff() or v_folder !~ '^[0-9]{1,18}$' then
    return false;
  end if;
  return exists (select 1 from public.quotes where id = v_folder::bigint and status = 'draft');
end;
$$;
```

Append to `supabase/schemas/90_grants.sql`:

```sql

-- storage policy helper
grant execute on function private.can_upload_model(text) to authenticated;
```

- [ ] **Step 4: Append the storage policies and the cron job** to
  `supabase/migrations/20261011120100_grants_and_setup.sql`

```sql

-- Storage policies (storage.objects is managed by Supabase, so the schema diff skips it).
create policy "models: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'models' and (select private.is_staff()));
create policy "models: staff upload to draft quotes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'models' and private.can_upload_model(name));
create policy "models: staff update in draft quotes" on storage.objects
  for update to authenticated
  using (bucket_id = 'models' and (select private.is_staff()))
  with check (bucket_id = 'models' and private.can_upload_model(name));
create policy "models: staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'models' and (select private.is_staff()));

create policy "branding: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'branding' and (select private.is_staff()));
create policy "branding: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and (select private.is_owner()));
create policy "branding: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'branding' and (select private.is_owner()))
  with check (bucket_id = 'branding' and (select private.is_owner()));
create policy "branding: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding' and (select private.is_owner()));

-- Daily at 00:15 UTC: sent quotes past their validity (Europe/Rome date) become expired.
select cron.schedule('expire-quotes', '15 0 * * *', 'select private.expire_quotes()');
```

- [ ] **Step 5: Rebuild, run the tests and watch them pass**

Run the Rebuild procedure (R), then `supabase test db 2>&1 | tail -25`.
Expected: `All tests successful.`, with 10 files and 196 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas supabase/migrations supabase/tests
git commit -m "feat(db): add storage policies and the daily quote expiry job"
```

---

### Task 10: Seed, API smoke test and final checks

**Files:**
- Create: `supabase/seed.sql`
- Scratch, not committed: `C:\Users\ALESSA~1\AppData\Local\Temp\claude\C--Progetti-3D-Quote\d370474d-9dcc-4606-8b5d-703aaec3c361\scratchpad\smoke_api.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - local logins `owner@3dquote.local` and `operator@3dquote.local`, both with password `password123`;
  - two printers, three materials and one client.

- [ ] **Step 1: Write the smoke script** at the scratch path above

This is the failing check: the owner can't log in before the seed exists.

```python
"""Throwaway end-to-end check of the local Data API, Storage API and RPC wiring. Not committed."""

import json
import subprocess
import sys
import urllib.error
import urllib.request
import uuid


def status_env() -> dict[str, str]:
    out = subprocess.run(["supabase", "status", "-o", "env"], capture_output=True, text=True, check=True).stdout
    env = {}
    for line in out.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"')
    return env


ENV = status_env()
API = ENV["API_URL"]
KEY = ENV.get("PUBLISHABLE_KEY") or ENV["ANON_KEY"]


def call(method: str, path: str, token: str | None = None, body=None, raw: bytes | None = None,
         content_type: str = "application/json", prefer: str | None = None):
    headers = {"apikey": KEY, "Content-Type": content_type}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            text = res.read().decode()
            return res.status, json.loads(text) if text else None
    except urllib.error.HTTPError as err:
        text = err.read().decode()
        return err.code, json.loads(text) if text.startswith(("{", "[")) else text


def check(label: str, condition: bool, detail=None) -> None:
    print(("PASS " if condition else "FAIL ") + label + ("" if condition else f" -> {detail}"))
    if not condition:
        sys.exit(1)


status, body = call("POST", "/auth/v1/token?grant_type=password",
                    body={"email": "owner@3dquote.local", "password": "password123"})
check("owner logs in", status == 200 and "access_token" in body, (status, body))
token = body["access_token"]

status, body = call("GET", "/rest/v1/printers?select=id,name", token)
check("owner reads printers", status == 200 and len(body) == 2, (status, body))
printer_id = body[0]["id"]
status, body = call("GET", "/rest/v1/materials?select=id&limit=1", token)
material_id = body[0]["id"]
status, body = call("GET", "/rest/v1/clients?select=id&limit=1", token)
client_id = body[0]["id"]

status, body = call("POST", "/rest/v1/quotes", token, body={"client_id": client_id},
                    prefer="return=representation")
check("owner creates a quote", status == 201 and body[0]["number"].startswith("Q-"), (status, body))
quote_id = body[0]["id"]

model_path = f"{quote_id}/{uuid.uuid4()}/cube.stl"
status, body = call("POST", f"/storage/v1/object/models/{model_path}", token, raw=b"solid cube\nendsolid cube\n",
                    content_type="application/octet-stream")
check("owner uploads a model", status == 200, (status, body))

status, body = call("POST", "/rest/v1/rpc/create_quote_item", token, body={
    "quote_id": quote_id, "model_path": model_path, "original_filename": "cube.stl", "description": "cube",
    "printer_id": printer_id, "material_id": material_id, "layer_height_mm": 0.2, "infill_percent": 15,
})
check("create_quote_item via RPC", status == 200 and isinstance(body, int), (status, body))
item_id = body

status, body = call("GET", f"/rest/v1/slicing_jobs?quote_item_id=eq.{item_id}&select=status", token)
check("a queued job is visible", status == 200 and body == [{"status": "queued"}], (status, body))

status, body = call("POST", "/rest/v1/rpc/get_quote_send_blockers", token, body={"quote_id": quote_id})
codes = sorted(row["code"] for row in body) if status == 200 else body
check("send blockers via RPC", status == 200 and codes == ["not_priced", "not_sliced"], (status, body))

status, body = call("POST", "/rest/v1/rpc/mark_quote_sent", token, body={"quote_id": quote_id})
check("sending is refused with a stable code", status >= 400 and "quote_not_sendable" in json.dumps(body), (status, body))

status, body = call("DELETE", f"/storage/v1/object/models/{model_path}", token)
check("owner deletes the model file", status == 200, (status, body))
status, body = call("DELETE", f"/rest/v1/quotes?id=eq.{quote_id}", token, prefer="return=representation")
check("owner deletes the draft quote", status == 200 and len(body) == 1, (status, body))

status, body = call("GET", "/rest/v1/printers?select=id")
check("anon is refused", status in (401, 403), (status, body))

status, body = call("POST", "/rest/v1/rpc/worker_claim_job", token, body={"visibility_timeout_s": 600, "max_attempts": 3})
check("staff cannot call worker functions", status in (401, 403, 404), (status, body))

print("smoke: all checks passed")
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -I "C:\Users\ALESSA~1\AppData\Local\Temp\claude\C--Progetti-3D-Quote\d370474d-9dcc-4606-8b5d-703aaec3c361\scratchpad\smoke_api.py"`
Expected: `FAIL owner logs in -> (400, …invalid_credentials…)`. The user doesn't exist yet.

- [ ] **Step 3: Write `supabase/seed.sql`**

```sql
-- Local development data only. Never run against a cloud project.
-- Logins (password123): owner@3dquote.local (owner), operator@3dquote.local (operator).

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'owner@3dquote.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'operator@3dquote.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

insert into public.staff (user_id, display_name, role, language) values
  ('00000000-0000-4000-8000-000000000001', 'Owner', 'owner', 'it'),
  ('00000000-0000-4000-8000-000000000002', 'Operator', 'operator', 'it');

update public.settings set
  shop_name = '3D Quote Lab',
  shop_email = 'info@3dquote.local',
  energy_price_kwh = 0.30,
  failure_allowance_pct = 5,
  setup_fee = 3.00,
  default_markup_pct = 40,
  minimum_item_price = 10.00
where id = 1;

insert into public.printers (name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w) values
  ('MK4 #1', 'Prusa MK4', 250, 210, 220, 1.50, 120),
  ('X1C #1', 'Bambu Lab X1 Carbon', 256, 256, 256, 2.00, 180);

insert into public.materials (name, type, color, density_g_cm3, cost_per_kg) values
  ('Prusament PLA Galaxy Black', 'PLA', 'Black', 1.24, 25.00),
  ('Prusament PETG Signal White', 'PETG', 'White', 1.27, 27.00),
  ('Generic TPU 95A', 'TPU', 'Red', 1.21, 35.00);

insert into public.clients (name, company, email) values
  ('Mario Rossi', 'Rossi Meccanica', 'mario.rossi@example.com');
```

- [ ] **Step 4: Reset, run the smoke script and watch it pass**

```bash
supabase db reset 2>&1 | tail -5
python -I "C:\Users\ALESSA~1\AppData\Local\Temp\claude\C--Progetti-3D-Quote\d370474d-9dcc-4606-8b5d-703aaec3c361\scratchpad\smoke_api.py"
supabase db reset 2>&1 | tail -3
```

Expected: every line is `PASS …`, ending with `smoke: all checks passed`. The second reset removes the smoke data.

If login fails with a 500 that mentions `converting NULL to string`, set the remaining token columns of the
`auth.users` insert (`email_change_token_current`, `phone_change`, `phone_change_token`, `reauthentication_token`)
to `''` and record a `Ruling:`.

- [ ] **Step 5: Run the final database checks**

```bash
supabase test db 2>&1 | tail -6
supabase db diff 2>&1 | tail -5
supabase db lint --level warning 2>&1 | tail -10
supabase db advisors --help | head -30
```

Then run `supabase db advisors` with the flags its help lists for the local database: `--local`, both the
`security` and `performance` types, and level `info`.

Expected:
- tests: `All tests successful.`;
- `db diff`: `No schema changes found`;
- `db lint`: `No schema errors found`;
- advisors: no `ERROR` or `WARN`.

Any `INFO` findings are written down for the ADR in Task 11. On a fresh database these are probably
`unused_index`, and `rls_enabled_no_policy` for `private.quote_counters`. Fix any `WARN` or `ERROR` in the schema
files, rebuild and re-run.

- [ ] **Step 6: Check the web app is unaffected**

```bash
npm test 2>&1 | tail -5 && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3
```

Expected: 36 tests pass, lint is clean, and the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): seed local owner and operator logins with sample catalog"
```

---

### Task 11: Documentation

**Files:**
- Create: `docs/architecture/adr/0003-database-schema-and-security.md`
- Modify: `docs/supabase/data-model.md`, `docs/services/slicer-worker.md`, `docs/architecture/overview.md`,
  `docs/development/getting-started.md`, `docs/README.md`

**Interfaces:**
- Consumes: the final schema, and the advisor `INFO` findings noted in Task 10 Step 5.

- [ ] **Step 1: Write `docs/architecture/adr/0003-database-schema-and-security.md`**

```markdown
# ADR-0003: Database schema workflow and security model

- **Status: Accepted**
- **Date:** 2026-10-11

## Context

Supabase is the backend ([ADR-0001](0001-monorepo-and-stack.md)). The [data model](../../supabase/data-model.md)
needs:
- row level security for staff and owner roles;
- prices that never change once a quote is sent;
- slicing jobs queued in the same transaction as the item that needs them;
- concurrency-safe quote numbers.

Since 2026, Supabase no longer exposes new tables to the Data API automatically. Grants must be explicit.
Development runs on a local stack only.

## Decision

**Schema workflow**
- `supabase/schemas/*.sql` is the source of truth. The files are loaded in name order (`NN_` prefixes).
- They define tables, functions, triggers, RLS policies, and table and function grants. `supabase db diff -f <name>`
  generates versioned migrations from them.
- `supabase/migrations/20261011120100_grants_and_setup.sql` is written by hand. It holds what the diff doesn't
  capture:
  - default privileges and column privileges;
  - data rows (the settings row and the storage buckets);
  - the pgmq queue, storage policies and the cron job.
- Until the first deploy, `20261011120000_initial_schema.sql` is regenerated in place. After that, every change is a
  new pair: a generated migration, plus a hand-written one if needed.

**Access**
- `anon` has no privileges.
- `authenticated` can `select` every public table. RLS limits rows to active staff, via `private.is_staff()` and
  `private.is_owner()`.
- Writes are granted per table, or per column where only some columns are editable:
  - quotes: client, valid-until date, notes;
  - items: description, quantity;
  - staff: name, language, role, active.
- Status, prices and slicing results can't be written through the API.
- Actions with side effects are functions. Each is a `security invoker` SQL wrapper in `public` that calls a
  `security definer` function in the non-exposed `private` schema, which:
  - has `set search_path = ''`;
  - checks staff or owner first;
  - raises stable error codes, which the [data model](../../supabase/data-model.md#errors) lists.
- Triggers hold the invariants for every role, the service role included:
  - non-draft quotes and their items are frozen;
  - there is always an active owner;
  - quote numbers are assigned on insert;
  - a quantity change clears the price.
- The slicer-worker uses three service-role functions that own the queue protocol (claim, complete, fail).

## Alternatives considered

- **Imperative migrations only:** simpler tooling, but no single place that shows the current schema.
- **The pg-delta engine (`supabase db schema declarative sync`):** captures more, including storage policies and
  grants, but is experimental, and it's unclear whether it handles column privileges.
- **`security definer` functions directly in `public`, with EXECUTE revoked from anon:** fewer functions, but the
  advisors flag them, and one missing revoke exposes them.
- **RLS alone for status and prices:** RLS can't restrict individual columns, so column grants plus triggers do it.
- **Pricing as a SQL function:** rejected in favour of an Edge Function, which will be built later.

## Consequences

- Making a new column writable means a column grant in a hand-written migration, not just a schema file edit.
- A table-level `revoke` in a future generated migration also removes that table's column grants. Re-grant them in
  the same change's hand-written migration.
- The error codes are a contract with the web app; changing one is a breaking change.
- Remaining advisor findings, all `INFO`:
  - <one bullet per finding from Task 10 Step 5: lint name, object, and why it stays — e.g. "unused_index on a fresh
    database: indexes back foreign keys and the expiry query">
```

Replace the angle-bracket bullet with the real findings recorded in Task 10 Step 5. If there were none, write
`none`. Don't leave the placeholder.

- [ ] **Step 2: Update `docs/supabase/data-model.md`**

1. **Status line:** replace it with `- **Status: Implemented** — local only. Source of truth: supabase/schemas/ and
   the migrations in supabase/migrations/ ([ADR-0003](../architecture/adr/0003-database-schema-and-security.md)).`
2. **Conventions:** add these bullets:
   - "Tables without user-editable state may omit `updated_at`."
   - "`slicing_jobs` uses `queued_at` instead of `created_at`."
3. **`quotes` table:**
   - `valid_until` becomes `date not null`, "default today + `settings.default_validity_days` (Europe/Rome)";
   - `created_by` default `auth.uid()`;
   - add the partial index `(valid_until) where status = 'sent'`;
   - add a note: "Numbers come from `private.quote_counters` (one row per year) in a before-insert trigger; supplied
     values are replaced."
4. **`quote_items` table:**
   - defaults: `quantity 1`, `layer_height_mm 0.20`, `infill_percent 20`, `supports false`;
   - `printer_id` and `material_id` are `on delete restrict`;
   - `item_total` is a generated column;
   - the override check constraint;
   - add a note: "A quantity change clears the price breakdown; the override stays."
5. **`settings` table:** `energy_price_kwh` default `0`; the row is inserted by the migration.
6. **Access → Functions:** replace "(proposed)" and the list with:
   - the public/private wrapper pattern;
   - the full function list from the spec (web app and worker functions) with their signatures;
   - the send blocker codes table.
7. **New section `## Errors`:** the error contract table from this plan's Global Constraints (errcode → messages).
8. **Storage:** list the eight policies by name, and the upload rule "first folder = id of a draft quote".
9. **Open questions:** delete the "Where pricing runs" bullet. Pricing is an Edge Function, decided 2026-10-11 and
   not built yet; say so in the Overview.

- [ ] **Step 3: Update `docs/services/slicer-worker.md`**

Replace steps 1, 2, 6 and 7 of `## Processing loop` with:

```markdown
1. Call `worker_claim_job(VISIBILITY_TIMEOUT_S, MAX_ATTEMPTS)` (RPC, service role). It reads one message and marks
   its job `running` with `started_at` and the attempt number. Messages already read more than `MAX_ATTEMPTS` times
   (the worker died on every attempt) are failed and archived inside the function, which then reads the next one.
   No row means the queue is empty: wait `POLL_INTERVAL_S` and try again.
2. (Done by step 1.)
```

…and for steps 6–7:

```markdown
6. On success: `worker_complete_job(msg_id, job_id, results)` stores the results, copies them onto the item if this
   is still the item's newest job, and deletes the message — one transaction.
7. On error: `worker_fail_job(msg_id, job_id, error, final)` with `final = read_ct >= MAX_ATTEMPTS`. Not final: the
   job goes back to `queued` and the message reappears after the visibility timeout. Final: the job is `failed` and
   the message archived.
```

Remove the "(proposed)" marker from `## Job message` and `## Output`. They are now implemented by
`private.enqueue_slicing_job` and `worker_complete_job`.

- [ ] **Step 4: Update `docs/architecture/overview.md`**

In `## Open questions`, replace the line

`- **Where pricing runs:** an Edge Function or a SQL function (could be triggered when slicing succeeds).`

with

`- **When pricing runs:** pricing is an Edge Function (decided 2026-10-11, not built yet); still open is whether it is called by the web app after each change or triggered when a slice succeeds.`

- [ ] **Step 5: Update `docs/development/getting-started.md`**

Add a section after `## First setup`:

````markdown
## Local Supabase

Docker must be running. From the repository root:

```bash
supabase start          # first run pulls the images; prints URLs and keys
supabase db reset       # rebuild the database from supabase/migrations and supabase/seed.sql
supabase test db        # pgTAP tests in supabase/tests/database
supabase status         # URLs and keys again
```

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
3. If the change needs data rows, column grants, storage policies, cron jobs or queues, add them with
   `supabase migration new <change_name>_setup`.
4. Run `supabase db reset`, then `supabase test db` and `supabase db advisors --local`.

See [ADR-0003](../architecture/adr/0003-database-schema-and-security.md) for why the workflow is split.

### First owner on a cloud project

Public sign-ups are disabled. Once you've been invited and have set your password, run this once in the SQL editor:

```sql
insert into public.staff (user_id, display_name, role)
select id, 'Your Name', 'owner' from auth.users where email = 'you@example.com';
```
````

In `## Common commands`, replace the `supabase start` row with
`| supabase start / supabase db reset / supabase test db | Local Supabase stack, rebuild the database, run the pgTAP tests |`.

- [ ] **Step 6: Update `docs/README.md`**

- Architecture decisions row: append `, [0003 database schema and security](architecture/adr/0003-database-schema-and-security.md)`.
- Data model row: change `Draft Postgres schema` to `Postgres schema`.

- [ ] **Step 7: Check the links and commit**

```bash
for f in docs/README.md docs/supabase/data-model.md docs/development/getting-started.md docs/architecture/adr/0003-database-schema-and-security.md; do
  grep -o "](\([^)#]*\.md\)" "$f" | sed 's/](//' | while read -r link; do
    test -f "$(dirname "$f")/$link" || echo "BROKEN in $f: $link"
  done
done
grep -n "<one bullet" docs/architecture/adr/0003-database-schema-and-security.md || echo "no placeholder left"
```

Expected:
- no `BROKEN` lines;
- `no placeholder left`.

```bash
git add docs
git commit -m "docs: document the implemented schema, worker protocol and local Supabase workflow (ADR-0003)"
```
