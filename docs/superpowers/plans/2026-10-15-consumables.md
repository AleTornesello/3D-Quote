# Consumables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Consumables catalog section (bolts, screws…) with a stock counter; optional consumable lines on a quote that deduct stock when the quote is sent.

**Architecture:** Two new tables (`consumables`, `quote_consumables`) in the declarative schema, stock moved inside `mark_quote_sent` and returned by a trigger on `quotes`. The web app gets a Materials-style page and a draft-only card in the quote editor; totals, the PDF and quote duplication include the lines.

**Tech Stack:** PostgreSQL (Supabase, declarative schemas + pgTAP), React 19, TanStack Query, react-hook-form + zod, i18next (it/en), Vitest + Testing Library with the in-repo fake Supabase, `@react-pdf/renderer`.

**Spec:** `docs/superpowers/specs/2026-10-15-consumables-design.md`

## Global Constraints

- Work on branch `develop`; commit after each task; do not push or merge, and do not touch the cloud Supabase project (the user asks for that separately).
- No markup on consumables: a line total is `quantity × unit_price`; VAT applies to the whole net total.
- Stock changes only in `mark_quote_sent` (deduct) and on `sent → rejected | expired` (give back). Drafts never touch stock. Accepted keeps it deducted.
- Consumables: all staff read, owners write. Quote lines: any staff member, draft quotes only.
- A quote still needs at least one printed item (`no_items` blocker unchanged).
- Every new UI string goes in both `apps/web/src/i18n/locales/en.json` and `it.json` (tests render in Italian).
- Money is shown with `useFormat().currency`; the line price is frozen when the line is added.
- Migrations: a generated `<ts>_consumables.sql` and a hand-written `<ts>_consumables_setup.sql` (grants), as in earlier features. Mirror the table and function grants in `supabase/schemas/90_grants.sql`; column grants only in the setup migration.
- Windows machine, Git Bash or PowerShell; Docker and the Supabase CLI (2.120) are installed.

## Review Focus

- Two quotes sent at once that together need more stock than exists: the second must fail (Task 1 tests: consumable rows are locked before the blocker check).
- Quantity edited on a line after the consumable's stock dropped: the editor warns, the send dialog lists `insufficient_stock` (Tasks 1 and 4).
- A consumable that is deactivated while a draft line uses it: the line stays, sending still works, and re-adding it is refused (Task 1).
- Duplicating a quote with a consumable that became inactive: the line is skipped, not an error (Task 1).
- A quote with only consumable lines and no printed item: still blocked by `no_items`; `quotes_list.total` stays empty (Task 1).

---

## File Structure

Create:
- `supabase/schemas/06_consumables.sql`: both tables, indexes, guard and updated_at triggers, the stock-return trigger.
- `supabase/migrations/<ts>_consumables.sql`, `<ts>_consumables_setup.sql`
- `supabase/tests/database/14_consumables.test.sql`
- `apps/web/src/data/consumables.ts`, `apps/web/src/data/quote-consumables.ts`
- `apps/web/src/pages/ConsumablesPage.tsx`, `ConsumablesPage.test.tsx`
- `apps/web/src/pages/consumables/ConsumableSheet.tsx`, `consumable-form.ts`
- `apps/web/src/pages/quote-editor/QuoteConsumables.tsx`, `QuoteConsumables.test.tsx`

Modify:
- `supabase/schemas/08_quotes_list.sql`, `10_policies.sql`, `20_quote_api.sql`, `22_service_api.sql`, `90_grants.sql`
- `apps/web/src/lib/database.types.ts` (regenerated)
- `apps/web/src/data/query-keys.ts`, `errors.ts`, `quote-rules.ts` (+ `.test.ts`)
- `apps/web/src/app/sections.ts`, `routes.tsx`, `routes.test.tsx`, `layout/AppShell.test.tsx` (if they count sections)
- `apps/web/src/pages/QuoteEditorPage.tsx`, `quote-editor/QuoteTotals.tsx`, `quote-editor/QuoteActions.tsx`
- `apps/web/src/pdf/quote-pdf-data.ts` (+ test), `QuotePdf.tsx`, `ExportPdfDialog.tsx`, `sample-data.ts`
- `apps/web/src/test/fixtures.ts`
- `apps/web/src/i18n/locales/en.json`, `it.json`
- `docs/supabase/data-model.md`, `docs/frontend/functional-analysis.md`, `docs/frontend/web-app.md`

---

### Task 1: Database

**Files:**
- Create: `supabase/schemas/06_consumables.sql`, `supabase/tests/database/14_consumables.test.sql`, two migrations
- Modify: `supabase/schemas/08_quotes_list.sql`, `10_policies.sql`, `20_quote_api.sql`, `22_service_api.sql`, `90_grants.sql`

**Interfaces:**
- Produces tables `public.consumables(id, name, unit, unit_price, stock, active, created_at, updated_at)` and `public.quote_consumables(id, quote_id, consumable_id, quantity, unit_price, line_total, created_at, updated_at)`.
- Produces `public.add_quote_consumable(quote_id bigint, consumable_id bigint, quantity integer) → bigint` (authenticated). Raises `consumable_inactive` (errcode 22023).
- `get_quote_send_blockers` may return `(null, 'insufficient_stock')`.

- [ ] **Step 1: Start the local stack**

Run: `supabase start` (Docker must be running; stop another project's stack first if the ports are taken).
Expected: prints the local URLs.

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/database/14_consumables.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'owner.cs@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'operator.cs@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000e1', 'Cons Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000e2', 'Cons Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (930001, 'Cons MK4', 'Prusa MK4', 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (930001, 'Cons PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (930001, 'Cons Client');
insert into public.consumables (id, name, unit, unit_price, stock) overriding system value values
  (930001, 'Bolt M3', 'pcs', 0.10, 10),
  (930002, 'Insert M3', 'pcs', 0.50, 2);
-- Quotes 930001 (the main one), 930002 and 930003 (expiry and acceptance), 930004/930005 (copy).
insert into public.quotes (id, client_id, created_by, valid_until) overriding system value values
  (930001, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930002, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930003, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930004, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930005, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30);
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id,
  print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, computed_total
) overriding system value values
  (930001, 930001, '930001/a/ok.stl', 'ok.stl', 'OK', 930001, 930001, 3600, 25, 50, 40, 30, 10.00);
insert into public.slicing_jobs (quote_item_id, status) values (930001, 'succeeded');

-- Constraints
select throws_ok(
  $$insert into public.consumables (name, unit, unit_price, stock) values ('Bad', 'pcs', 1, -1)$$,
  '23514', null, 'stock cannot be negative'
);
select throws_ok(
  $$insert into public.consumables (name, unit, unit_price, stock) values ('Bolt M3', 'pcs', 1, 1)$$,
  '23505', null, 'names are unique'
);

-- Catalog access
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
select is((select count(*)::int from public.consumables where id in (930001, 930002)), 2, 'staff read consumables');
select throws_ok(
  $$insert into public.consumables (name, unit, unit_price, stock) values ('Op', 'pcs', 1, 1)$$,
  '42501', null, 'an operator cannot create a consumable'
);
select results_eq(
  $$with u as (update public.consumables set stock = 99 where id = 930001 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'an operator cannot change stock'
);

-- Quote lines
select lives_ok($$select public.add_quote_consumable(930001, 930001, 4)$$, 'staff add a consumable to a draft');
select is(
  (select line_total from public.quote_consumables where quote_id = 930001 and consumable_id = 930001),
  0.40::numeric, 'the line total is quantity times the frozen price'
);
select lives_ok($$select public.add_quote_consumable(930001, 930001, 2)$$, 'adding it again is accepted');
select results_eq(
  $$select count(*)::int, sum(quantity)::int from public.quote_consumables where quote_id = 930001$$,
  $$values (1, 6)$$,
  'adding again raises the quantity of the one line'
);
select is((select stock from public.consumables where id = 930001), 10, 'a draft does not touch stock');
select throws_ok(
  $$update public.quote_consumables set quantity = 0 where quote_id = 930001$$,
  '23514', null, 'a line needs a positive quantity'
);

-- An inactive consumable cannot be added, but a line already on the draft stays
reset role;
update public.consumables set active = false where id = 930002;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
select throws_ok(
  $$select public.add_quote_consumable(930001, 930002, 1)$$,
  '22023', 'consumable_inactive', 'an inactive consumable cannot be added'
);
reset role;
update public.consumables set active = true where id = 930002;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';

-- Sending: not enough stock blocks, enough stock deducts
select lives_ok($$select public.add_quote_consumable(930001, 930002, 5)$$, 'a line above the stock can be drafted');
select results_eq(
  $$select quote_item_id, code from public.get_quote_send_blockers(930001)$$,
  $$values (null::bigint, 'insufficient_stock'::text)$$,
  'the blockers report the missing stock'
);
select throws_ok($$select public.mark_quote_sent(930001)$$, 'P0001', 'quote_not_sendable', 'sending is refused');
update public.quote_consumables set quantity = 2 where quote_id = 930001 and consumable_id = 930002;
update public.quote_consumables set quantity = 3 where quote_id = 930001 and consumable_id = 930001;
select lives_ok($$select public.mark_quote_sent(930001)$$, 'sending works once the stock is enough');
select results_eq(
  $$select id::int, stock from public.consumables where id in (930001, 930002) order by id$$,
  $$values (930001, 7), (930002, 0)$$,
  'sending deducts the stock'
);
select is(
  (select total from public.quotes_list where id = 930001),
  11.30::numeric, 'the list total adds the consumable lines to the items'
);
select results_eq(
  $$with u as (update public.quote_consumables set quantity = 1 where quote_id = 930001 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'lines of a sent quote cannot be changed'
);

-- Rejected gives the stock back
select lives_ok($$select public.mark_quote_rejected(930001)$$, 'the sent quote is rejected');
select results_eq(
  $$select id::int, stock from public.consumables where id in (930001, 930002) order by id$$,
  $$values (930001, 10), (930002, 2)$$,
  'rejecting gives the stock back'
);

reset role;

-- Expired gives the stock back; accepted keeps it deducted
insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price) values
  (930002, 930001, 2, 0.10),
  (930003, 930001, 1, 0.10);
update public.consumables set stock = stock - 3 where id = 930001;
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22,
  valid_until = (now() at time zone 'Europe/Rome')::date - 1 where id = 930002;
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 930003;
select private.expire_quotes();
select is((select stock from public.consumables where id = 930001), 9, 'expiring gives the stock back');
select private.mark_quote_accepted(930003);
select is((select stock from public.consumables where id = 930001), 9, 'accepting keeps the stock deducted');

-- Deleting a consumable that a quote uses is refused; copying skips inactive ones
select throws_ok(
  $$delete from public.consumables where id = 930001$$,
  '23503', null, 'a consumable used by a quote cannot be deleted'
);
insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price) values
  (930004, 930001, 3, 0.05),
  (930004, 930002, 1, 0.50);
update public.consumables set active = false where id = 930002;
select private.service_copy_quote_items(930004, 930005, '[]'::jsonb);
select results_eq(
  $$select consumable_id::int, quantity, unit_price from public.quote_consumables where quote_id = 930005$$,
  $$values (930001, 3, 0.10::numeric)$$,
  'a copy takes the active lines at the current price and skips inactive ones'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run it to see it fail**

Run: `supabase test db`
Expected: `14_consumables.test.sql` fails (relation `public.consumables` does not exist); the other files still pass.

- [ ] **Step 4: Declare the tables**

Create `supabase/schemas/06_consumables.sql`:

```sql
-- Consumables: bought-in goods used in an assembly (bolts, screws…) with a stock counter, and their lines on quotes.

create table public.consumables (
  id bigint generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  unit text not null default 'pcs' check (btrim(unit) <> ''),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.consumables enable row level security;

create trigger consumables_set_updated_at
  before update on public.consumables
  for each row execute function private.set_updated_at();

-- One line per consumable per quote. The price is frozen when the line is added.
create table public.quote_consumables (
  id bigint generated always as identity primary key,
  quote_id bigint not null references public.quotes (id) on delete cascade,
  consumable_id bigint not null references public.consumables (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_id, consumable_id)
);

create index quote_consumables_consumable_id_idx on public.quote_consumables (consumable_id);

alter table public.quote_consumables enable row level security;

-- Lines of a non-draft quote never change, for any role. FOR SHARE on the quote waits for (and blocks) a concurrent
-- mark_quote_sent, which locks the quote FOR UPDATE.
create or replace function private.quote_consumables_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_quote_id := old.quote_id;
  else
    v_quote_id := new.quote_id;
  end if;
  if tg_op = 'UPDATE' and new.quote_id <> old.quote_id then
    raise exception 'quote_item_move_not_allowed';
  end if;

  select status into v_status from public.quotes where id = v_quote_id for share;
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

create trigger quote_consumables_guard
  before insert or update or delete on public.quote_consumables
  for each row execute function private.quote_consumables_guard();

create trigger quote_consumables_set_updated_at
  before update on public.quote_consumables
  for each row execute function private.set_updated_at();

-- A sent quote that is rejected or expires gives its consumables back. Covers mark_quote_rejected and the daily
-- expire_quotes job. Accepted quotes keep the stock deducted.
create or replace function private.quotes_return_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.consumables c
  set stock = c.stock + qc.quantity
  from public.quote_consumables qc
  where qc.quote_id = new.id and qc.consumable_id = c.id;
  return new;
end;
$$;

create trigger quotes_return_stock
  after update of status on public.quotes
  for each row
  when (old.status = 'sent' and new.status in ('rejected', 'expired'))
  execute function private.quotes_return_stock();
```

- [ ] **Step 5: Policies**

Append to `supabase/schemas/10_policies.sql`:

```sql

-- consumables: staff read, owners write
create policy consumables_select on public.consumables
  for select to authenticated using ((select private.is_staff()));
create policy consumables_insert on public.consumables
  for insert to authenticated with check ((select private.is_owner()));
create policy consumables_update on public.consumables
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy consumables_delete on public.consumables
  for delete to authenticated using ((select private.is_owner()));

-- quote_consumables: staff read; staff edit and remove lines of draft quotes (adding goes through add_quote_consumable)
create policy quote_consumables_select on public.quote_consumables
  for select to authenticated using ((select private.is_staff()));
create policy quote_consumables_update on public.quote_consumables
  for update to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  )
  with check (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );
create policy quote_consumables_delete on public.quote_consumables
  for delete to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );
```

- [ ] **Step 6: API changes in `supabase/schemas/20_quote_api.sql`**

(a) In `private.get_quote_send_blockers`, right after the `valid_until_past` block (the `if v_quote.valid_until < private.shop_today() then … end if;`), add:

```sql
  if exists (
    select 1
    from public.quote_consumables qc
    join public.consumables c on c.id = qc.consumable_id
    where qc.quote_id = p_quote_id and qc.quantity > c.stock
  ) then
    return query select null::bigint, 'insufficient_stock'::text;
  end if;
```

(b) Replace the body of `private.mark_quote_sent` (keep its signature and `security definer`):

```sql
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);
  -- Lock the consumables first, in id order, so two sends can't spend the same stock.
  perform c.id
  from public.consumables c
  where c.id in (select consumable_id from public.quote_consumables where quote_id = p_quote_id)
  order by c.id
  for update;
  if exists (select 1 from private.get_quote_send_blockers(p_quote_id)) then
    raise exception 'quote_not_sendable';
  end if;
  update public.consumables c
  set stock = c.stock - qc.quantity
  from public.quote_consumables qc
  where qc.quote_id = p_quote_id and qc.consumable_id = c.id;
  update public.quotes
  set status = 'sent',
      sent_at = now(),
      vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
  where id = p_quote_id;
end;
```

(c) Add after `retry_slicing`'s public wrapper (before the markup/override functions; any place after `require_draft_quote` works):

```sql
-- add_quote_consumable: adds a line at the consumable's current price, or raises the quantity of the existing one.

create or replace function private.add_quote_consumable(p_quote_id bigint, p_consumable_id bigint, p_quantity integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price numeric;
  v_id bigint;
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);

  select unit_price into v_price from public.consumables where id = p_consumable_id and active;
  if not found then
    raise exception 'consumable_inactive' using errcode = '22023';
  end if;

  insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price)
  values (p_quote_id, p_consumable_id, p_quantity, v_price)
  on conflict (quote_id, consumable_id)
    do update set quantity = public.quote_consumables.quantity + excluded.quantity
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_quote_consumable(quote_id bigint, consumable_id bigint, quantity integer)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.add_quote_consumable($1, $2, $3);
$$;
```

A missing consumable id and an inactive one both raise `consumable_inactive`; that is intended.

- [ ] **Step 7: Copy and list changes**

In `supabase/schemas/22_service_api.sql`, inside `private.service_copy_quote_items`, after the `for r in … end loop;` and before the function's final `end;`, add:

```sql
  -- Consumable lines of active consumables, at today's price.
  insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price)
  select p_new_id, qc.consumable_id, qc.quantity, c.unit_price
  from public.quote_consumables qc
  join public.consumables c on c.id = qc.consumable_id
  where qc.quote_id = p_source_id and c.active;
```

In `supabase/schemas/08_quotes_list.sql`, add a second lateral and change `total`:

```sql
  case when i.item_count > 0 and i.unpriced_count = 0 then i.total + k.total end as total
from public.quotes q
join public.clients c on c.id = q.client_id
join public.staff s on s.user_id = q.created_by
cross join lateral (
  select
    count(*)::integer as item_count,
    count(*) filter (where qi.item_total is null)::integer as unpriced_count,
    sum(qi.item_total) as total
  from public.quote_items qi
  where qi.quote_id = q.id
) i
cross join lateral (
  select coalesce(sum(qc.line_total), 0) as total
  from public.quote_consumables qc
  where qc.quote_id = q.id
) k;
```

(Update the header comment: "total … plus the quote's consumable lines".)

- [ ] **Step 8: Grants**

Append to `supabase/schemas/90_grants.sql` (before the storage helper block or at its end):

```sql

-- consumables (the quote_consumables update is a column grant in the consumables_setup migration)
grant insert, update, delete on public.consumables to authenticated;
grant delete on public.quote_consumables to authenticated;

grant execute on function
  public.add_quote_consumable(bigint, bigint, integer),
  private.add_quote_consumable(bigint, bigint, integer)
to authenticated;
```

- [ ] **Step 9: Generate the migration and write the setup migration**

Run: `supabase db diff -f consumables` and rename nothing: the file lands in `supabase/migrations/<ts>_consumables.sql`. Read it: it must create both tables, the triggers, the policies, the new functions and replace `mark_quote_sent`, `get_quote_send_blockers`, `service_copy_quote_items` and the `quotes_list` view. If the view diff drops and recreates it, add the same two lines the earlier quotes_list migration needed (`alter view public.quotes_list set (security_invoker = true);` and the grants) to the setup file below.

Create `supabase/migrations/<ts+1>_consumables_setup.sql` (a later timestamp than the generated one):

```sql
-- Grants for the consumables tables and functions, mirrored in supabase/schemas/90_grants.sql (generated
-- migrations carry none). New tables get no privileges by default, so every grant is explicit.
revoke all on public.consumables, public.quote_consumables from public, anon, authenticated;
grant select on public.consumables, public.quote_consumables to authenticated;
grant insert, update, delete on public.consumables to authenticated;
grant delete on public.quote_consumables to authenticated;
-- Only the quantity of a line can be edited; the price is frozen.
grant update (quantity) on public.quote_consumables to authenticated;
grant all on public.consumables, public.quote_consumables to service_role;

revoke execute on function
  public.add_quote_consumable(bigint, bigint, integer),
  private.add_quote_consumable(bigint, bigint, integer)
from public, anon, authenticated;
grant execute on function
  public.add_quote_consumable(bigint, bigint, integer),
  private.add_quote_consumable(bigint, bigint, integer)
to authenticated;
```

- [ ] **Step 10: Rebuild and run all database tests**

Run: `supabase db reset` then `supabase test db`
Expected: all files PASS, including `14_consumables.test.sql` (25 tests). If `01_structure.test.sql` fails (a grant, anon access or a missing FK index), fix the schema or setup migration, not the test.
Then run: `supabase db diff` — Expected: no schema changes (the schema files and migrations agree).

- [ ] **Step 11: Commit**

```bash
git add supabase
git commit -m "feat(db): consumables with stock, quote consumable lines, stock moved on send"
```

---

### Task 2: Types, errors and data hooks

**Files:**
- Modify: `apps/web/src/lib/database.types.ts` (generated), `data/query-keys.ts`, `test/fixtures.ts`, `data/quote-rules.ts`, `data/quote-rules.test.ts`
- Create: `apps/web/src/data/consumables.ts`, `apps/web/src/data/quote-consumables.ts`

**Interfaces:**
- Produces `Consumable`, `ConsumableValues`, `useConsumables()`, `useSaveConsumable()`, `useDeleteConsumable()` (`data/consumables.ts`).
- Produces `QuoteConsumable = Tables<'quote_consumables'> & { consumable: { name: string; unit: string; stock: number } }`, `useQuoteConsumables(quoteId)`, `useAddQuoteConsumable()` (`{ quoteId, consumableId, quantity }`), `useUpdateQuoteConsumable()` (`{ line, quantity }`), `useRemoveQuoteConsumable()` (`line`).
- Produces `queryKeys.consumables`, `queryKeys.quoteConsumables(id)`.
- Changes `quoteTotals(items, ratePct, consumables = [])`: `consumables: { line_total: number }[]`; the net adds each line in cents.
- Produces fixtures `consumableRow(overrides)` and `quoteConsumableRow(overrides)`.
- Adds the error mapping `consumable_inactive` (22023) → `errors.consumableInactive`.

- [ ] **Step 1: Regenerate the types**

Run: `npm run gen:types` from the repo root (needs the local stack from Task 1).
Expected: `database.types.ts` gains `consumables`, `quote_consumables` and `add_quote_consumable`. Then `npm run check:types-fresh` passes.

- [ ] **Step 2: Failing tests for `quoteTotals` and the error mapping**

Append to `apps/web/src/data/quote-rules.test.ts` (match the file's existing import of `quoteTotals`):

```ts
describe('quoteTotals with consumables', () => {
  test('adds the consumable lines to the net before VAT', () => {
    expect(quoteTotals([{ item_total: 10 }], 22, [{ line_total: 0.3 }, { line_total: 1 }])).toEqual({
      net: 11.3,
      vat: 2.49,
      gross: 13.79,
    })
  })

  test('without consumables the result is unchanged', () => {
    expect(quoteTotals([{ item_total: 10 }], 22)).toEqual({ net: 10, vat: 2.2, gross: 12.2 })
  })

  test('still null without items or with an unpriced item', () => {
    expect(quoteTotals([], 22, [{ line_total: 5 }])).toBeNull()
    expect(quoteTotals([{ item_total: null }], 22, [{ line_total: 5 }])).toBeNull()
  })
})
```

Append to `apps/web/src/data/errors.test.ts` (use the file's style for building a Postgres error):

```ts
test('an inactive consumable maps to its own message', () => {
  const error = toAppError({ code: '22023', message: 'consumable_inactive' })
  expect(error.kind).toBe('invalid')
  expect(error.messageKey).toBe('errors.consumableInactive')
})
```

Run: `npm test --workspace @3d-quote/web -- quote-rules errors`
Expected: FAIL (`quoteTotals` ignores the third argument; no mapping yet).

- [ ] **Step 3: Implement**

In `quote-rules.ts` replace `quoteTotals`:

```ts
/**
 * Net (the item totals plus the consumable lines), VAT and gross, worked out in integer cents. VAT is rounded
 * half-up once, on the net. Null without items or while any item has no price.
 */
export function quoteTotals(
  items: { item_total: number | null }[],
  ratePct: number,
  consumables: { line_total: number }[] = [],
): QuoteTotals | null {
  if (items.length === 0 || items.some((item) => item.item_total === null)) return null
  const itemCents = items.reduce(
    (sum, item) => sum + Math.round((item.item_total as number) * 100),
    0,
  )
  const netCents = consumables.reduce((sum, line) => sum + Math.round(line.line_total * 100), itemCents)
  // The rate in hundredths of a percent keeps the maths in integers.
  const rateBasisPoints = Math.round(ratePct * 100)
  const vatCents = Math.floor((netCents * rateBasisPoints + 5000) / 10000)
  return { net: netCents / 100, vat: vatCents / 100, gross: (netCents + vatCents) / 100 }
}
```

In `errors.ts` add to `INVALID_MESSAGES`: `consumable_inactive: 'errors.consumableInactive',`.

Add to `en.json` `errors`: `"consumableInactive": "This consumable is not active."`; to `it.json`: `"consumableInactive": "Questo consumabile non è attivo."` (put it next to `materialInactive`).

- [ ] **Step 4: Query keys, fixtures, hooks**

`query-keys.ts`: add `consumables: ['consumables'] as const,` after `materials`, and `quoteConsumables: (id: number) => ['quotes', 'consumables', id] as const,` after `quoteItems`.

`test/fixtures.ts`, after `materialRow`:

```ts
export function consumableRow(
  overrides: Partial<Tables<'consumables'>> = {},
): Tables<'consumables'> {
  return {
    id: nextId++,
    name: 'Vite M3',
    unit: 'pz',
    unit_price: 0.1,
    stock: 10,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

/** A quote line as the lines query returns it, with the consumable's name, unit and stock embedded. */
export function quoteConsumableRow(
  overrides: Partial<Tables<'quote_consumables'>> & {
    consumable?: { name: string; unit: string; stock: number }
  } = {},
) {
  const { consumable = { name: 'Vite M3', unit: 'pz', stock: 10 }, ...rest } = overrides
  return {
    id: nextId++,
    quote_id: 7,
    consumable_id: 1,
    quantity: 1,
    unit_price: 0.1,
    line_total: (rest.quantity ?? 1) * (rest.unit_price ?? 0.1),
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    consumable,
  }
}
```

`data/consumables.ts` (a copy of `materials.ts` with the names changed):

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Consumable = Tables<'consumables'>
export type ConsumableValues = Omit<
  TablesInsert<'consumables'>,
  'id' | 'created_at' | 'updated_at'
>

export function useConsumables() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.consumables,
    queryFn: async () => {
      const { data, error } = await supabase.from('consumables').select('*').order('name')
      if (error) throw toAppError(error)
      return data
    },
  })
}

/** Inserts without `id`, otherwise updates that consumable (partial values allowed, e.g. the Active toggle). */
export function useSaveConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: Partial<ConsumableValues> }) => {
      const { data, error } =
        id === undefined
          ? await supabase
              .from('consumables')
              .insert(values as ConsumableValues)
              .select()
              .single()
          : await supabase.from('consumables').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.consumables }),
  })
}

export function useDeleteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('consumables').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.consumables }),
  })
}
```

`data/quote-consumables.ts`:

```ts
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type QuoteConsumable = Tables<'quote_consumables'> & {
  consumable: { name: string; unit: string; stock: number }
}

/** The quote's consumable lines in the order they were added. */
export function useQuoteConsumables(quoteId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quoteConsumables(quoteId),
    queryFn: async (): Promise<QuoteConsumable[]> => {
      const { data, error } = await supabase
        .from('quote_consumables')
        .select('*, consumable:consumables(name, unit, stock)')
        .eq('quote_id', quoteId)
        .order('id')
      if (error) throw toAppError(error)
      return data as QuoteConsumable[]
    },
  })
}

/** A line change moves the quote's total, so the list refreshes too. */
function refresh(queryClient: QueryClient, quoteId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteConsumables(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
  ])
}

/** Every edit fails once the quote has left draft; reloading the quote turns the editor read-only. */
function refreshIfNotDraft(queryClient: QueryClient, error: unknown, quoteId: number) {
  if (error instanceof AppError && error.kind === 'notDraft') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) })
  }
}

/** Adds a line at the consumable's current price, or raises the quantity of the existing line. */
export function useAddQuoteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      quoteId,
      consumableId,
      quantity,
    }: {
      quoteId: number
      consumableId: number
      quantity: number
    }) => {
      const { data, error } = await supabase.rpc('add_quote_consumable', {
        quote_id: quoteId,
        consumable_id: consumableId,
        quantity,
      })
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: (_id, { quoteId }) => refresh(queryClient, quoteId),
    onError: (error, { quoteId }) => refreshIfNotDraft(queryClient, error, quoteId),
  })
}

/** RLS hides lines of quotes that left draft, so no row back means exactly that. */
export function useUpdateQuoteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ line, quantity }: { line: QuoteConsumable; quantity: number }) => {
      const { data, error } = await supabase
        .from('quote_consumables')
        .update({ quantity })
        .eq('id', line.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, { line }) => refresh(queryClient, line.quote_id),
    onError: (error, { line }) => refreshIfNotDraft(queryClient, error, line.quote_id),
  })
}

export function useRemoveQuoteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (line: QuoteConsumable) => {
      const { data, error } = await supabase
        .from('quote_consumables')
        .delete()
        .eq('id', line.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, line) => refresh(queryClient, line.quote_id),
    onError: (error, line) => refreshIfNotDraft(queryClient, error, line.quote_id),
  })
}
```

- [ ] **Step 5: Run tests, typecheck**

Run: `npm test --workspace @3d-quote/web -- quote-rules errors` → PASS. Run: `npm run build --workspace @3d-quote/web` → no type errors. Run: `npm run lint` and `npm run format:check` (fix with `npm run format`).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): consumable types, data hooks and totals with consumable lines"
```

---

### Task 3: Consumables section

**Files:**
- Create: `pages/ConsumablesPage.tsx`, `pages/ConsumablesPage.test.tsx`, `pages/consumables/ConsumableSheet.tsx`, `pages/consumables/consumable-form.ts`
- Modify: `app/sections.ts`, `app/routes.tsx`, `i18n/locales/en.json`, `it.json`, and any test that counts sections (`app/routes.test.tsx`, `layout/AppShell.test.tsx`, `i18n/i18n.test.ts`: run the suite and update the expected lists)

**Interfaces:**
- Consumes `useConsumables`, `useSaveConsumable`, `useDeleteConsumable`, `Consumable`, `ConsumableValues`, `consumableRow` (Task 2).
- Produces route `/consumables`, nav key `nav.consumables`.

- [ ] **Step 1: Strings**

`en.json`: add `"consumables": "Consumables"` to `nav` (after `materials`), and a top-level block after `materials`:

```json
  "consumables": {
    "empty": "No consumables yet.",
    "new": "New consumable",
    "edit": "Edit consumable",
    "fields": {
      "name": "Name",
      "unit": "Unit",
      "unitPrice": "Unit price",
      "stock": "Available",
      "active": "Active"
    },
    "stockValue": "{{value}} {{unit}}",
    "toggleActive": "Toggle {{name}} active",
    "deleteTitle": "Delete consumable {{name}}?",
    "inUse": "This consumable is used by quotes — deactivate it instead."
  },
```

`it.json`: `nav.consumables` = `"Consumabili"`; block:

```json
  "consumables": {
    "empty": "Nessun consumabile.",
    "new": "Nuovo consumabile",
    "edit": "Modifica consumabile",
    "fields": {
      "name": "Nome",
      "unit": "Unità",
      "unitPrice": "Prezzo unitario",
      "stock": "Disponibili",
      "active": "Attivo"
    },
    "stockValue": "{{value}} {{unit}}",
    "toggleActive": "Attiva/disattiva {{name}}",
    "deleteTitle": "Eliminare il consumabile {{name}}?",
    "inUse": "Il consumabile è usato in alcuni preventivi: puoi disattivarlo invece di eliminarlo."
  },
```

- [ ] **Step 2: Failing page test**

Create `apps/web/src/pages/ConsumablesPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { consumableRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const bolt = () => consumableRow({ id: 1, name: 'Vite M3', unit: 'pz', unit_price: 0.1, stock: 10 })

test('lists consumables with price and available quantity', async () => {
  renderApp('/consumables', {
    session,
    tables: { consumables: [bolt(), consumableRow({ id: 2, name: 'Inserto M3', stock: 0 })] },
  })
  const row = await screen.findByRole('row', { name: /Vite M3/ })
  expect(within(row).getByText('0,10 €')).toBeInTheDocument()
  expect(within(row).getByText('10 pz')).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Inserto M3/ })).toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/consumables', { session })
  expect(await screen.findByText('Nessun consumabile.')).toBeInTheDocument()
})

test('operators see the list without owner actions', async () => {
  renderApp('/consumables', { session, staff: operatorStaff, tables: { consumables: [bolt()] } })
  await screen.findByRole('row', { name: /Vite M3/ })
  expect(screen.queryByRole('button', { name: 'Nuovo consumabile' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Modifica Vite M3' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

test('an owner creates a consumable', async () => {
  const { db, user } = renderApp('/consumables', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo consumabile' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo consumabile' })
  await user.type(within(sheet).getByLabelText('Nome'), 'Dado M4')
  await user.clear(within(sheet).getByLabelText('Unità'))
  await user.type(within(sheet).getByLabelText('Unità'), 'pz')
  await user.type(within(sheet).getByLabelText('Prezzo unitario'), '0,05')
  await user.type(within(sheet).getByLabelText('Disponibili'), '200')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('consumables')).toContainEqual({
    op: 'insert',
    filters: [],
    values: { name: 'Dado M4', unit: 'pz', unit_price: 0.05, stock: 200, active: true },
  })
})

test('rejects a negative price and a fractional stock', async () => {
  const { db, user } = renderApp('/consumables', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo consumabile' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo consumabile' })
  await user.type(within(sheet).getByLabelText('Nome'), 'X')
  await user.type(within(sheet).getByLabelText('Prezzo unitario'), '-1')
  await user.type(within(sheet).getByLabelText('Disponibili'), '1,5')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(await within(sheet).findByText('Non può essere negativo.')).toBeInTheDocument()
  expect(within(sheet).getByText('Inserisci un numero intero.')).toBeInTheDocument()
  expect(db.calls('consumables')).toEqual([])
})

test('the Active switch updates the consumable', async () => {
  const { db, user } = renderApp('/consumables', { session, tables: { consumables: [bolt()] } })
  await user.click(await screen.findByRole('switch', { name: 'Attiva/disattiva Vite M3' }))
  await waitFor(() =>
    expect(db.calls('consumables')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
})

test('a consumable used by a quote cannot be deleted, only deactivated', async () => {
  const { db, user } = renderApp('/consumables', { session, tables: { consumables: [bolt()] } })
  const remove = await screen.findByRole('button', { name: 'Elimina Vite M3' })
  // Registered after the list loaded, so it hits the delete and not the list query.
  db.failNext('consumables', { code: '23503', message: 'violates foreign key constraint' })
  await user.click(remove)
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(
    await within(dialog).findByText(/Il consumabile è usato in alcuni preventivi/),
  ).toBeInTheDocument()
})
```

If the Italian validation strings differ from the two used above, copy the exact `validation.nonNegative` / `validation.integer` text from `it.json`. If `Elimina` is not the confirm button's name, copy it from `MaterialsPage.test.tsx`'s delete test.

Run: `npm test --workspace @3d-quote/web -- ConsumablesPage` → FAIL (no route/page).

- [ ] **Step 3: Form helpers**

Create `pages/consumables/consumable-form.ts`:

```ts
import { z } from 'zod'
import type { Consumable, ConsumableValues } from '@/data/consumables'
import { toInputNumber, type Locale } from '@/lib/format'
import { numberField, parseDecimal, requiredText } from '@/lib/forms'

export const consumableSchema = z.object({
  name: requiredText(),
  unit: requiredText(20),
  unit_price: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  stock: numberField({ min: 0, decimals: 0, rangeError: 'validation.nonNegative' }),
  active: z.boolean(),
})

export type ConsumableForm = z.infer<typeof consumableSchema>

export function consumableToForm(consumable: Consumable | null, locale: Locale): ConsumableForm {
  return {
    name: consumable?.name ?? '',
    unit: consumable?.unit ?? 'pz',
    unit_price: toInputNumber(consumable?.unit_price, locale, 2),
    stock: consumable ? String(consumable.stock) : '0',
    active: consumable?.active ?? true,
  }
}

/** Only called on values that passed consumableSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

export function formToConsumable(form: ConsumableForm): ConsumableValues {
  return {
    name: form.name.trim(),
    unit: form.unit.trim(),
    unit_price: number(form.unit_price),
    stock: number(form.stock),
    active: form.active,
  }
}
```

(The default unit is `pz` in the Italian-first app; the test clears it first. `toInputNumber(undefined, …)` already returns `''`, as `materialToForm` relies on.)

- [ ] **Step 4: The sheet**

Create `pages/consumables/ConsumableSheet.tsx`: copy `MaterialSheet.tsx` and reduce it: no type/color/density logic, no `densityEdited` state, no `setValue`/`Controller` for colour. Fields in order, each in a `FormField` with ids `consumable-name`, `consumable-unit`, `consumable-price` (`inputMode="decimal"`), `consumable-stock` (`inputMode="numeric"`) and the Active `Switch` in a `Controller`, labels `consumables.fields.*`, title `consumables.new` / `consumables.edit`, resolver `consumableSchema`, `defaultValues: consumableToForm(consumable, locale)`, submit `save.mutateAsync({ id: consumable?.id, values: formToConsumable(values) })`, then `onClose()`; the same `formError` paragraph and the `Save` button disabled unless dirty. The exported component is `ConsumableSheet({ consumable, onClose })`.

- [ ] **Step 5: The page and the route**

Create `pages/ConsumablesPage.tsx` by copying `MaterialsPage.tsx` with these changes: hooks `useConsumables/useSaveConsumable/useDeleteConsumable`, type `Consumable`, `ConsumableSheet`, translation namespace `consumables`/`nav.consumables`, and columns:

```tsx
    { key: 'name', header: t('consumables.fields.name'), cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'unitPrice', header: t('consumables.fields.unitPrice'), cell: (c) => format.currency(c.unit_price) },
    {
      key: 'stock',
      header: t('consumables.fields.stock'),
      cell: (c) => t('consumables.stockValue', { value: format.number(c.stock), unit: c.unit }),
    },
    // the Active column and the owner-only actions column: as in MaterialsPage
```

`sections.ts`: import `Package` from `lucide-react` and insert `{ path: '/consumables', labelKey: 'nav.consumables', icon: Package },` between materials and settings. `routes.tsx`: import `ConsumablesPage` and add `'/consumables': <ConsumablesPage />,` to `SECTION_PAGES` (alphabetical, before `/materials`).

- [ ] **Step 6: Run everything**

Run: `npm test --workspace @3d-quote/web` — the new tests PASS; fix any existing test that lists the sections or checks that en/it have the same keys (update its expectation to include Consumables, between Materials and Settings). Then `npm run lint`, `npm run format:check`, `npm run build --workspace @3d-quote/web`.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): Consumables section"
```

---

### Task 4: Consumables card in the quote editor

**Files:**
- Create: `pages/quote-editor/QuoteConsumables.tsx`, `pages/quote-editor/QuoteConsumables.test.tsx`
- Modify: `pages/QuoteEditorPage.tsx`, `pages/quote-editor/QuoteTotals.tsx`, `i18n/locales/en.json`, `it.json`

**Interfaces:**
- Consumes `useQuoteConsumables`, `useAddQuoteConsumable`, `useUpdateQuoteConsumable`, `useRemoveQuoteConsumable`, `QuoteConsumable` (Task 2), `useConsumables`, `quoteTotals(items, rate, consumables)`.
- Produces `<QuoteConsumables quoteId editable />`, and `QuoteTotals` gains a required prop `consumables: QuoteConsumable[]`.

- [ ] **Step 1: Strings**

`en.json`: in `quotes.editor` add `"consumables": "Consumables"`, and to `blockers`: `"insufficient_stock": "Some consumables exceed the available stock."`. In `quotes.editor` also add a block:

```json
      "consumable": {
        "add": "Add consumable",
        "choose": "Choose…",
        "quantity": "Quantity",
        "remove": "Remove {{name}}",
        "empty": "No consumables.",
        "unitPrice": "{{price}} each",
        "lowStock": "Only {{stock}} {{unit}} available.",
        "quantityInvalid": "Enter a whole number greater than zero."
      },
```

`it.json` (same places): `"consumables": "Consumabili"`, blocker `"insufficient_stock": "Alcuni consumabili superano la quantità disponibile."`, and

```json
      "consumable": {
        "add": "Aggiungi consumabile",
        "choose": "Scegli…",
        "quantity": "Quantità",
        "remove": "Rimuovi {{name}}",
        "empty": "Nessun consumabile.",
        "unitPrice": "{{price}} cad.",
        "lowStock": "Disponibili solo {{stock}} {{unit}}.",
        "quantityInvalid": "Inserisci un numero intero maggiore di zero."
      },
```

- [ ] **Step 2: Failing test**

Create `pages/quote-editor/QuoteConsumables.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  consumableRow,
  quoteConsumableRow,
  quoteItemRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

function renderEditor(lines: Row[], status = 'draft') {
  return renderApp('/quotes/7', {
    session,
    tables: {
      quotes: [quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status })],
      clients: [clientRow({ id: 1 })],
      quote_items: [
        quoteItemRow({
          id: 31,
          printer_id: 11,
          material_id: 21,
          print_time_s: 3600,
          computed_total: 10,
          item_total: 10,
          priced_at: '2026-10-13T09:00:00Z',
        }),
      ],
      consumables: [
        consumableRow({ id: 1, name: 'Vite M3', unit: 'pz', unit_price: 0.1, stock: 10 }),
        consumableRow({ id: 2, name: 'Inserto M3', unit: 'pz', unit_price: 0.5, stock: 2 }),
        consumableRow({ id: 3, name: 'Dado vecchio', active: false }),
      ],
      quote_consumables: lines,
    },
    rpc: { add_quote_consumable: () => 1 },
  })
}

const line = (overrides: Parameters<typeof quoteConsumableRow>[0]) =>
  quoteConsumableRow({ id: 51, consumable_id: 1, ...overrides })

test('lists the lines and adds their total to the quote total', async () => {
  renderEditor([line({ quantity: 3 })])
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  expect(within(card).getByText('Vite M3')).toBeInTheDocument()
  expect(within(card).getByText('0,30 €')).toBeInTheDocument()
  // 10,00 € of items + 0,30 € of consumables
  expect(await screen.findByText('10,30 €')).toBeInTheDocument()
})

test('adds a consumable with a quantity; inactive ones are not offered', async () => {
  const { db, user } = renderEditor([])
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  expect(within(card).queryByRole('option', { name: /Dado vecchio/ })).not.toBeInTheDocument()
  await user.selectOptions(within(card).getByLabelText('Aggiungi consumabile'), 'Inserto M3')
  await user.clear(within(card).getByLabelText('Quantità'))
  await user.type(within(card).getByLabelText('Quantità'), '2')
  await user.click(within(card).getByRole('button', { name: 'Aggiungi' }))
  await waitFor(() =>
    expect(db.rpcCalls('add_quote_consumable')).toEqual([
      { quote_id: 7, consumable_id: 2, quantity: 2 },
    ]),
  )
})

test('changing a quantity saves it; zero is refused', async () => {
  const { db, user } = renderEditor([line({ quantity: 3 })])
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  const quantity = within(card).getByLabelText('Quantità', { selector: '#consumable-51-quantity' })
  await user.clear(quantity)
  await user.type(quantity, '0')
  await user.tab()
  expect(await within(card).findByText('Inserisci un numero intero maggiore di zero.')).toBeInTheDocument()
  await user.clear(quantity)
  await user.type(quantity, '5')
  await user.tab()
  await waitFor(() =>
    expect(db.calls('quote_consumables')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 51]],
      values: { quantity: 5 },
    }),
  )
})

test('warns when a line asks for more than the stock', async () => {
  renderEditor([
    line({ id: 52, consumable_id: 2, quantity: 5, consumable: { name: 'Inserto M3', unit: 'pz', stock: 2 } }),
  ])
  expect(await screen.findByText('Disponibili solo 2 pz.')).toBeInTheDocument()
})

test('removes a line', async () => {
  const { db, user } = renderEditor([line({ quantity: 3 })])
  await user.click(await screen.findByRole('button', { name: 'Rimuovi Vite M3' }))
  await waitFor(() =>
    expect(db.calls('quote_consumables')).toContainEqual({
      op: 'delete',
      filters: [['eq', 'id', 51]],
    }),
  )
})

test('a sent quote shows the lines read-only, without a warning', async () => {
  renderEditor(
    [line({ quantity: 5, consumable: { name: 'Vite M3', unit: 'pz', stock: 1 } })],
    'sent',
  )
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  expect(within(card).getByText('Vite M3')).toBeInTheDocument()
  expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  expect(within(card).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(card).queryByText(/Disponibili solo/)).not.toBeInTheDocument()
})

test('a sent quote without lines shows no card', async () => {
  renderEditor([], 'sent')
  await screen.findByText('Q-2026-0007')
  expect(screen.queryByRole('region', { name: 'Consumabili' })).not.toBeInTheDocument()
})
```

Run: `npm test --workspace @3d-quote/web -- QuoteConsumables` → FAIL.

- [ ] **Step 3: The card**

Create `pages/quote-editor/QuoteConsumables.tsx`:

```tsx
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { QueryError } from '@/components/QueryError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useConsumables } from '@/data/consumables'
import { toAppError } from '@/data/errors'
import {
  useAddQuoteConsumable,
  useRemoveQuoteConsumable,
  useUpdateQuoteConsumable,
  type QuoteConsumable,
} from '@/data/quote-consumables'
import { parseDecimal } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { InlineField } from './InlineField'

const isPositiveInteger = (text: string) => {
  const value = parseDecimal(text)
  return value !== null && Number.isInteger(value) && value > 0
}

/**
 * The quote's consumable lines (bolts, screws…). Editable while the quote is a draft; a quote that left draft shows
 * its lines only when it has any. Stock is only checked here as a warning: it is spent when the quote is sent.
 */
export function QuoteConsumables({
  quoteId,
  lines,
  editable,
}: {
  quoteId: number
  lines: QuoteConsumable[]
  editable: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const consumables = useConsumables()
  const add = useAddQuoteConsumable()
  const update = useUpdateQuoteConsumable()
  const remove = useRemoveQuoteConsumable()
  const [choice, setChoice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const busy = add.isPending || update.isPending || remove.isPending

  if (!editable && lines.length === 0) return null

  async function addLine() {
    setError(null)
    if (!choice || !isPositiveInteger(quantity)) {
      setError(choice ? 'quotes.editor.consumable.quantityInvalid' : 'validation.required')
      return
    }
    try {
      await add.mutateAsync({
        quoteId,
        consumableId: Number(choice),
        quantity: Number(parseDecimal(quantity)),
      })
      setChoice('')
      setQuantity('1')
    } catch (caught) {
      setError(toAppError(caught).messageKey)
    }
  }

  const offered = (consumables.data ?? []).filter((consumable) => consumable.active)

  return (
    <section aria-labelledby="quote-consumables-title" className="grid gap-4">
      <h2 id="quote-consumables-title" className="text-lg font-semibold">
        {t('quotes.editor.consumables')}
      </h2>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('quotes.editor.consumable.empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {lines.map((line) => {
            const low = editable && line.quantity > line.consumable.stock
            return (
              <li key={line.id} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{line.consumable.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('quotes.editor.consumable.unitPrice', {
                        price: format.currency(line.unit_price),
                      })}
                    </p>
                  </div>
                  <p className="font-medium">{format.currency(line.line_total)}</p>
                </div>
                {editable ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <InlineField
                      id={`consumable-${line.id}-quantity`}
                      label={t('quotes.editor.consumable.quantity')}
                      value={String(line.quantity)}
                      inputMode="numeric"
                      disabled={busy}
                      revertOnError
                      validate={(text) =>
                        isPositiveInteger(text) ? null : 'quotes.editor.consumable.quantityInvalid'
                      }
                      onSave={(text) =>
                        update.mutateAsync({ line, quantity: Number(parseDecimal(text)) })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={t('quotes.editor.consumable.remove', { name: line.consumable.name })}
                      onClick={() => remove.mutate(line)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm">
                    {t('quotes.editor.consumable.quantity')}: {format.number(line.quantity)}
                  </p>
                )}
                {low && (
                  <p role="status" className="text-sm text-destructive">
                    {t('quotes.editor.consumable.lowStock', {
                      stock: format.number(line.consumable.stock),
                      unit: line.consumable.unit,
                    })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(toAppError(remove.error).messageKey)}
        </p>
      )}
      {consumables.isError && (
        <QueryError error={consumables.error} onRetry={() => void consumables.refetch()} />
      )}
      {editable && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField id={`quote-${quoteId}-consumable`} label={t('quotes.editor.consumable.add')}>
            <NativeSelect
              id={`quote-${quoteId}-consumable`}
              value={choice}
              disabled={busy}
              onChange={(event) => setChoice(event.target.value)}
            >
              <NativeSelectOption value="">{t('quotes.editor.consumable.choose')}</NativeSelectOption>
              {offered.map((consumable) => (
                <NativeSelectOption key={consumable.id} value={String(consumable.id)}>
                  {consumable.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id={`quote-${quoteId}-consumable-quantity`} label={t('quotes.editor.consumable.quantity')}>
            <Input
              id={`quote-${quoteId}-consumable-quantity`}
              inputMode="numeric"
              className="w-24"
              value={quantity}
              disabled={busy}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </FormField>
          <Button disabled={busy} onClick={() => void addLine()}>
            {t('common.add')}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
    </section>
  )
}
```

Notes for the implementer: (1) the section already has an accessible name from its `aria-labelledby` heading, so tests find it as `region`; (2) `common.add` probably does not exist: add `"add": "Add"` / `"add": "Aggiungi"` to `common` in both locale files, and use the exact Italian word in the test (`Aggiungi`); (3) in the "add" test, `getByLabelText('Quantità')` matches both the new-line field and any line field: scope with the new field's id `#quote-7-consumable-quantity` if the test is ambiguous; (4) `FormField` takes `id`, `label`, `error`, `children` as in `MaterialSheet`.

- [ ] **Step 4: Wire it in**

`QuoteEditorPage.tsx`: import `useQuoteConsumables` and `QuoteConsumables`; in `QuoteEditor` add `const consumables = useQuoteConsumables(quote.id)` and `const consumableList = consumables.data ?? []`. After the items `<section>`'s upload zone and before `QuoteTotals`, nothing changes in place; instead render the consumables card as a sibling section between the items section and the totals: restructure so the totals sit last:

```tsx
      </section>   {/* end of the items section; move <QuoteTotals> out of it */}
      <QuoteConsumables quoteId={quote.id} lines={consumableList} editable={editable} />
      {items.isSuccess && (
        <QuoteTotals
          quote={quote}
          items={itemList}
          consumables={consumableList}
          editable={editable}
          pricing={pricing.pricing}
          onRecalculate={pricing.recalculate}
        />
      )}
```

Also show a failed lines query instead of hiding it: below the `QuoteConsumables` card add
`{consumables.isError && consumables.data === undefined && (<QueryError error={consumables.error} onRetry={() => void consumables.refetch()} />)}` (import `QueryError` is already there).

`QuoteTotals.tsx`: add the prop `consumables: QuoteConsumable[]` (import the type) and compute `quoteTotals(items, rate, consumables)`. While the lines are loading the total would briefly omit them; pass `consumables.isSuccess` into the render condition: `{items.isSuccess && consumables.isSuccess && (<QuoteTotals … />)}`.

- [ ] **Step 5: Existing tests**

`QuoteItems.test.tsx` and other editor tests now also read `quote_consumables` and `consumables`: the fake DB returns empty tables for unseeded names, so they keep passing; run them to confirm.

- [ ] **Step 6: Run everything**

Run: `npm test --workspace @3d-quote/web`, `npm run lint`, `npm run format:check`, `npm run build --workspace @3d-quote/web`. Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): consumables card in the quote editor, included in the totals"
```

---

### Task 5: PDF export

**Files:**
- Modify: `pdf/quote-pdf-data.ts`, `pdf/quote-pdf-data.test.ts`, `pdf/QuotePdf.tsx`, `pdf/ExportPdfDialog.tsx`, `pdf/sample-data.ts`, `pages/quote-editor/QuoteActions.tsx`, `i18n/locales/en.json`, `it.json`

**Interfaces:**
- Consumes `QuoteConsumable`, `quoteTotals` (Tasks 2, 4).
- `QuotePdfInput` gains `consumables: QuoteConsumable[]`; `QuotePdfData` gains `consumables: { title: string; columns: QuotePdfRow; rows: QuotePdfRow[] } | null`. `ExportPdfDialog` takes a new prop `consumables`.

- [ ] **Step 1: Strings**

`pdf` block (top-level, last one in each file): `en`: `"consumables": "Consumables"` and in `pdf.columns` `"unit": "Unit"`; `it`: `"consumables": "Consumabili"` and `"unit": "Unità"`.

- [ ] **Step 2: Failing tests**

In `quote-pdf-data.test.ts`, extend the test helper that builds the input (the function at line ~36 that calls `toQuotePdfData`) so it passes `consumables: []` by default and accepts an override, then add:

```ts
  test('prints consumable lines in their own table and adds them to the totals', () => {
    const data = build({
      consumables: [
        {
          id: 1, quote_id: 1, consumable_id: 1, quantity: 3, unit_price: 0.1, line_total: 0.3,
          created_at: '', updated_at: '',
          consumable: { name: 'Vite M3', unit: 'pz', stock: 10 },
        },
      ],
    })
    expect(data.consumables?.title).toBe('Consumabili')
    expect(data.consumables?.columns.material).toBe('Unità')
    expect(data.consumables?.rows).toEqual([
      { description: 'Vite M3', material: 'pz', quantity: '3', unitPrice: '0,10 €', total: '0,30 €' },
    ])
    // The totals include the 0,30 € (use the net the existing items produce in this test file).
    expect(data.totals[0].value).toBe(/* items net + 0,30 € */)
  })

  test('has no consumables table when the quote has none', () => {
    expect(build({}).consumables).toBeNull()
  })
```

Fill the net with the sum of this file's fixture items plus `0,30 €` (read the existing totals test in the file for the number). `build` is the file's existing helper; use its real name.

Run: `npm test --workspace @3d-quote/web -- quote-pdf-data` → FAIL.

- [ ] **Step 3: Implement the data**

In `quote-pdf-data.ts`: import `QuoteConsumable`; add `consumables: QuoteConsumable[]` to `QuotePdfInput`; add to `QuotePdfData`:

```ts
  consumables: { title: string; columns: QuotePdfRow; rows: QuotePdfRow[] } | null
```

In `toQuotePdfData`, destructure `consumables`, call `quoteTotals(items, rate, consumables)`, and add to the returned object after `rows`:

```ts
    consumables:
      consumables.length === 0
        ? null
        : {
            title: t('pdf.consumables'),
            columns: {
              description: t('pdf.columns.description'),
              material: t('pdf.columns.unit'),
              quantity: t('pdf.columns.quantity'),
              unitPrice: t('pdf.columns.unitPrice'),
              total: t('pdf.columns.total'),
            },
            rows: consumables.map((line) => ({
              description: line.consumable.name,
              material: line.consumable.unit,
              quantity: formatNumber(line.quantity, locale),
              unitPrice: money(line.unit_price),
              total: money(line.line_total),
            })),
          },
```

`sample-data.ts`: add `consumables: null,` to the returned object (before `...overrides`).

- [ ] **Step 4: Layout and dialog**

`QuotePdf.tsx`: after the items table `<View>` and before the totals, add:

```tsx
        {data.consumables && (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>{data.consumables.title}</Text>
            <TableRow values={data.consumables.columns} head />
            {data.consumables.rows.map((values, index) => (
              <TableRow key={index} values={values} />
            ))}
          </View>
        )}
```

`ExportPdfDialog.tsx`: add prop `consumables: QuoteConsumable[]` (import the type), pass `consumables` into `toQuotePdfData`. `QuoteActions.tsx`: add prop `consumables: QuoteConsumable[]` to `QuoteActions`, pass it to `<ExportPdfDialog … consumables={consumables} />`; in `QuoteEditorPage.tsx` pass `consumables={consumableList}` to `<QuoteActions>`. Update every other caller or test that renders these (`ExportPdf.test.tsx` renders through the app, so it needs nothing; a direct render needs `consumables={[]}`).

Add a layout test to `QuotePdf.render.test.ts` following the file's pattern: `sampleQuotePdfData({ consumables: { title: 'Consumabili', columns: <the sample columns with material: 'Unità'>, rows: [{ description: 'Vite M3', material: 'pz', quantity: '3', unitPrice: '0,10 €', total: '0,30 €' }] } })` renders without throwing.

- [ ] **Step 5: Run everything**

Run: `npm test --workspace @3d-quote/web`, `npm run lint`, `npm run format:check`, `npm run build --workspace @3d-quote/web`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): consumables in the PDF export and its totals"
```

---

### Task 6: Documentation and final checks

**Files:**
- Modify: `docs/supabase/data-model.md`, `docs/frontend/functional-analysis.md`, `docs/frontend/web-app.md`, `docs/README.md` (only if it indexes specs), the spec's `Status` line

- [ ] **Step 1: Data model doc**

In `docs/supabase/data-model.md`: add `consumables` and `quote_consumables` to the ER diagram (`quotes ||--o{ quote_consumables : "has"`, `consumables ||--o{ quote_consumables : "used by"`) and a section for each after `materials` / `quote_items` in the existing style (columns table, constraints, the guard and the stock-return trigger). Add them to the RLS table (`consumables`: staff / owner / owner / owner; `quote_consumables`: staff / — / staff, parent quote draft / staff, parent quote draft) and the column-grant table (`quote_consumables`: `quantity`). Document `add_quote_consumable` under the web app functions, the changed `mark_quote_sent` (deducts stock after locking the consumables) and `service_copy_quote_items` (copies active consumable lines), the new send blocker `insufficient_stock` in the blockers table, the `consumable_inactive` error in the errors list, and the `quotes_list.total` change. Name the migrations `consumables` and `consumables_setup`.

- [ ] **Step 2: Functional analysis and web app docs**

`docs/frontend/functional-analysis.md`: add Consumables to the section list (§2), a section describing the screen (fields, owner-only editing, deactivate instead of delete), the quote editor card (add, quantity, stock warning, read-only after draft), the stock rules (deducted on send, returned on reject/expire), pricing (no markup, VAT on the whole net) and the PDF table. `docs/frontend/web-app.md`: add the new files to its structure list.

- [ ] **Step 3: Spec status**

Change the spec's `- **Status:** Proposed` to `Implemented`.

- [ ] **Step 4: Full verification**

Run, from the repo root: `supabase db reset`, `supabase test db`, `npm run check:types-fresh`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run functions:check`.
Expected: everything passes. `npm run functions:test` needs the local stack running; run it too and expect `duplicate-quote.integration.test.ts` to still pass.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: consumables in the data model, functional analysis and web app guide"
```

- [ ] **Step 6: Hand back**

Report what was verified. Do not apply the migrations to the cloud project or push: ask the user first (the cloud project is `pzukbipwiupezwpvnazh`, applied through the Supabase MCP `apply_migration`, with the version numbers renamed to the repo's afterwards).
