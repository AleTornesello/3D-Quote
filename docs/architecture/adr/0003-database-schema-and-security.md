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
- They define tables, functions, triggers, RLS policies, the storage policies on `storage.objects`
  (`30_storage.sql`) and, in `90_grants.sql`, every table and function grant. `supabase db diff -f <name>` (the
  default migra engine) generates versioned migrations from them.
- `supabase/migrations/20261011120100_grants_and_setup.sql` is written by hand. It holds what the generated
  migration doesn't apply correctly:
  - default privileges, column privileges and function privileges (migra diffs table grants but not function
    grants, and tables created by a generated migration start with Supabase's default `anon` grants, so the
    effective revokes and grants are applied here, after the tables exist);
  - data rows (the settings row and the storage buckets);
  - the pgmq queue and the cron job.
- `90_grants.sql` mirrors the hand-written grants so `supabase db diff` stays empty. The two change together.
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
- Public sign-ups are off (`[auth] enable_signup = false`). The email provider itself stays on
  (`[auth.email] enable_signup = true`): turning that off disables email logins too.

## Alternatives considered

- **Imperative migrations only:** simpler tooling, but no single place that shows the current schema.
- **The pg-delta engine (`supabase db schema declarative sync`):** may capture more, including function grants, but
  is experimental, and it's unclear whether it handles column privileges.
- **`security definer` functions directly in `public`, with EXECUTE revoked from anon:** fewer functions, but the
  advisors flag them, and one missing revoke exposes them.
- **RLS alone for status and prices:** RLS can't restrict individual columns, so column grants plus triggers do it.
- **Pricing as a SQL function:** rejected in favour of an Edge Function, which will be built later.

## Consequences

- Making a new column writable means a column grant in a hand-written migration, not just a schema file edit.
- A new function grant goes in both `90_grants.sql` and a hand-written migration.
- A table-level `revoke` in a future generated migration also removes that table's column grants. Re-grant them in
  the same change's hand-written migration.
- The error codes are a contract with the web app; changing one is a breaking change.
- Remaining advisor findings, all `INFO`:
  - `unused_index` on `quote_items_quote_id_idx`, `quote_items_printer_id_idx`, `quote_items_material_id_idx`,
    `quotes_client_id_idx`, `quotes_created_by_idx` and `slicing_jobs_quote_item_id_idx`: reported on a fresh
    database with no traffic. They back foreign keys (deletes of quotes, printers, materials and clients) and the
    "newest job of an item" lookup, so they stay.
  - `unused_index` on `quotes_sent_valid_until_idx`: serves the daily expiry job, which hasn't run yet on a fresh
    database. It stays.
  - `rls_enabled_no_policy` on `private.quote_counters`: intended. The table is reached only by the
    `security definer` numbering trigger; no role should read or write it directly.
