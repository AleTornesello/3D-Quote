# Quote Plates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace quote items with plates: a plate has one printer, a print time and one or more materials with grams, and the quote total only exists once every plate is complete.

**Architecture:** Two new tables (`quote_plates`, `quote_plate_materials`) replace `quote_items`. A first migration adds them and copies the data; a second switches every dependent (send check, quotes list, duplication, overrides) and drops `quote_items`, `slicing_jobs` and the slicing functions. `price-quote` sums the cost of the materials per plate. The editor's Items section becomes a Plates section with typed inputs.

**Tech Stack:** Postgres/Supabase (declarative schemas in `supabase/schemas/` plus hand-written migrations, pgTAP), Deno Edge Functions, React 19 + TanStack Query + react-i18next + Vitest, `@react-pdf/renderer`.

**Spec:** `docs/superpowers/specs/2026-10-16-quote-plates-design.md`

## Global Constraints

- Branch `develop`; commit after each task; never push or merge to `main` unless asked (project memory).
- A plate is **complete** when it has a printer, `print_time_s > 0`, and at least one material row; every row has `grams > 0`, at most one row per material per plate.
- The quote total (and `quotes_list.total`) exists only when there is at least one plate **and every plate is complete and has a `plate_total`**. An override on an incomplete plate does not make the total appear.
- Setup fee and minimum price apply **per plate**. Material cost = sum of `grams / 1000 × cost_per_kg` over the plate's materials, per copy; `quantity` multiplies per-copy cost.
- Plates and their material rows of a non-draft quote never change (`quote_not_draft`), for any role.
- Changing a plate's `quantity`, `printer_id`, `print_time_s`, or any of its material rows clears its computed price (the override stays).
- Uploads and slicing are out of scope. The slicer DB layer is removed (it is tied to `quote_items`); the upload UI is deleted (a new upload system is coming; git history keeps the old one).
- Every user-facing string goes in both `apps/web/src/i18n/locales/en.json` and `it.json`.
- Database errors use stable message strings; web maps them in `apps/web/src/data/errors.ts`.
- Do not touch other Supabase projects; the cloud project is "3D Quote" (ref `pzukbipwiupezwpvnazh`). Applying migrations/functions there is Task 8 and needs the user's go-ahead.

## Review Focus

- A quote with an incomplete plate **and an owner override on it** must still show no total (list and editor).
- Removing the last material row of a priced plate: the plate becomes incomplete and its price is cleared.
- Two browser tabs: material added while the quote was just sent → `quote_not_draft`, no row written.
- Migrated item with `filament_g` null, `material_id` null or `print_time_s = 0` → incomplete plate, no material row, no constraint violation.
- Duplicating a quote copies plates **and material rows**, and skips nothing silently; duplicate of a quote with an inactive material still copies (inactive is only blocked when adding).
- Grams typed with a comma (`12,5`) in the Italian locale save as 12.5; `0`, empty and `abc` show a validation error and save nothing.
- Print time `h:mm` parsing: `1:30` ok, `0:00` rejected, `1:75` rejected, `90` rejected.

## File Structure

**Database**
- Create `supabase/schemas/06_quote_plates.sql` (tables, triggers); replaces `06_quote_items.sql` (deleted in Task 2).
- Modify `supabase/schemas/10_policies.sql`, `20_quote_api.sql`, `22_service_api.sql`, `08_quotes_list.sql`, `90_grants.sql`; delete `07_slicing_jobs.sql`, `21_worker_api.sql`.
- Create `supabase/migrations/20261016090000_quote_plates.sql` (tables + data copy) and `20261016090100_quote_plates_cutover.sql` (switch + drop).
- Tests: create `supabase/tests/database/15_quote_plates.test.sql`; update `01`, `04`, `05` (delete), `06`, `07`, `08` (delete), `11`, `12`, `13`, `14`.

**Edge Functions** — modify `supabase/functions/_shared/pricing.ts`, `_shared/price-quote.ts`, `duplicate-quote/duplicate.ts`, tests in `supabase/functions/tests/`.

**Web**
- Create `data/quote-plates.ts`, `pages/quote-editor/{PlateCard,PlateMaterials,PlatePrice}.tsx`, `pages/quote-editor/QuotePlates.test.tsx`.
- Rename/modify `data/{quote-rules,query-keys,quote-live,quotes,errors}.ts`, `pages/QuoteEditorPage.tsx`, `quote-editor/{OverrideDialog,QuoteTotals,QuoteActions,SendQuoteDialog,use-auto-price}`, `pdf/*`, `test/fixtures.ts`, `lib/database.types.ts`, locales.
- Delete `data/quote-items.ts`, `data/model-upload.ts(+test)`, `quote-editor/{ItemCard,ItemSettings,ItemPrice,SlicingStatus,UploadZone,use-uploads}`, `QuoteItems.test.tsx`, `QuoteUploads.test.tsx`.

---

### Task 1: Plates tables, rules and API (migration 1, data copied)

**Files:**
- Create: `supabase/schemas/06_quote_plates.sql`
- Modify: `supabase/schemas/10_policies.sql` (append), `supabase/schemas/20_quote_api.sql` (append), `supabase/schemas/90_grants.sql` (append)
- Create: `supabase/migrations/20261016090000_quote_plates.sql`
- Test: `supabase/tests/database/15_quote_plates.test.sql`

**Interfaces:**
- Produces tables `public.quote_plates`, `public.quote_plate_materials`; RPCs `create_quote_plate(quote_id bigint, description text, printer_id bigint default null) returns bigint`, `set_plate_printer(plate_id bigint, printer_id bigint) returns void`, `save_plate_material(plate_id bigint, material_id bigint, grams numeric) returns bigint`. Direct table writes: update `description, quantity, print_time_s` on plates; update `grams` and delete on material rows; delete on plates. Errors: `quote_not_found`, `quote_not_draft`, `plate_not_found` (P0002), `printer_inactive`, `material_inactive` (22023), `invalid_grams` (22023).

- [ ] **Step 1: Write the failing pgTAP test** `supabase/tests/database/15_quote_plates.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'op.plates@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000f1', 'Plate Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (930001, 'Plate MK4', 'Prusa MK4', 1.50, 120);
insert into public.printers (id, name, model, hourly_rate, power_w, active)
  overriding system value values (930002, 'Old printer', 'Old', 1.50, 120, false);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (930001, 'Plate PLA', 'PLA', 1.24, 25.00), (930002, 'Plate PETG', 'PETG', 1.27, 30.00);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg, active)
  overriding system value values (930003, 'Old PLA', 'PLA', 1.24, 20.00, false);
insert into public.clients (id, name) overriding system value values (930001, 'Plate Client');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (930001, 930001, '00000000-0000-4000-8000-0000000000f1'),
  (930002, 930001, '00000000-0000-4000-8000-0000000000f1');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';

-- Creation
select lives_ok($$select public.create_quote_plate(930001, 'Plate A')$$, 'staff can create a plate in a draft quote');
select results_eq(
  $$select printer_id, print_time_s, quantity from public.quote_plates where quote_id = 930001$$,
  $$values (null::bigint, null::integer, 1)$$,
  'a new plate has no printer or print time and quantity 1'
);
select throws_ok($$select public.create_quote_plate(930001, '  ')$$, '22023', null, 'the description is required');
select throws_ok($$select public.create_quote_plate(930001, 'X', 930002)$$, '22023', 'printer_inactive', 'an inactive printer is refused');

-- Printer and materials
select lives_ok(
  $$select public.set_plate_printer((select id from public.quote_plates where quote_id = 930001), 930001)$$,
  'a printer can be chosen'
);
select lives_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930001, 12.5)$$,
  'a material with grams can be added'
);
select lives_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930001, 20)$$,
  'saving the same material again updates its grams'
);
select results_eq(
  $$select material_id, grams from public.quote_plate_materials m
    join public.quote_plates p on p.id = m.plate_id where p.quote_id = 930001$$,
  $$values (930001::bigint, 20.00::numeric)$$,
  'there is still one row for that material'
);
select throws_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930002, 0)$$,
  '22023', 'invalid_grams', 'grams must be above zero'
);
select throws_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930003, 5)$$,
  '22023', 'material_inactive', 'an inactive material is refused'
);

-- Price invalidation (as postgres: the price columns are not writable by staff)
reset role;
update public.quote_plates set computed_total = 9.99, material_cost = 1, priced_at = now(), print_time_s = 3600
  where quote_id = 930001;
select is(
  (select computed_total from public.quote_plates where quote_id = 930001), null::numeric,
  'changing the print time clears the computed price'
);
update public.quote_plates set computed_total = 9.99, priced_at = now() where quote_id = 930001;
insert into public.quote_plate_materials (plate_id, material_id, grams)
  select id, 930002, 5 from public.quote_plates where quote_id = 930001;
select is(
  (select computed_total from public.quote_plates where quote_id = 930001), null::numeric,
  'adding a material clears the computed price'
);
update public.quote_plates set computed_total = 9.99, priced_at = now() where quote_id = 930001;
delete from public.quote_plate_materials where material_id = 930002;
select is(
  (select computed_total from public.quote_plates where quote_id = 930001), null::numeric,
  'removing a material clears the computed price'
);
update public.quote_plates set override_total = 5, override_reason = 'x' where quote_id = 930001;
update public.quote_plates set quantity = 2 where quote_id = 930001;
select is(
  (select override_total from public.quote_plates where quote_id = 930001), 5.00::numeric,
  'the override survives a change'
);

-- Constraints
select throws_ok(
  $$insert into public.quote_plate_materials (plate_id, material_id, grams)
    select id, 930001, 1 from public.quote_plates where quote_id = 930001$$,
  '23505', null, 'a material appears once per plate'
);
select throws_ok(
  $$update public.quote_plates set print_time_s = 0 where quote_id = 930001$$,
  '23514', null, 'print time must be above zero'
);

-- Non-draft quotes are frozen
select public.create_quote_plate(930002, 'Frozen') as frozen_id \gset
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 930002;
select throws_ok(
  format($$update public.quote_plates set quantity = 3 where id = %s$$, :frozen_id),
  'quote_not_draft', null, 'a plate of a sent quote cannot change'
);
select throws_ok(
  format($$insert into public.quote_plate_materials (plate_id, material_id, grams) values (%s, 930001, 1)$$, :frozen_id),
  'quote_not_draft', null, 'nor can its materials'
);

select * from finish();
rollback;
```

Note: `plan(20)`: count the assertions above (lives_ok ×5, results_eq ×2, throws_ok ×6, is ×4, throws_ok ×2 frozen + 1 constraint pair already counted). Run once and set the plan number to the actual count.

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db supabase/tests/database/15_quote_plates.test.sql` (needs Docker/local stack: `supabase start` first).
Expected: FAIL (`create_quote_plate` does not exist).

- [ ] **Step 3: Declare the schema** `supabase/schemas/06_quote_plates.sql`

```sql
-- Quote plates: one print job (everything printed together, supports included). Printer and print time are
-- typed by hand; the materials and their grams live in quote_plate_materials.

create table public.quote_plates (
  id bigint generated always as identity primary key,
  quote_id bigint not null references public.quotes (id) on delete cascade,
  description text not null check (nullif(btrim(description), '') is not null),
  printer_id bigint references public.printers (id) on delete restrict,
  print_time_s integer check (print_time_s > 0),
  quantity integer not null default 1 check (quantity > 0),
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
  plate_total numeric(12,2) generated always as (coalesce(override_total, computed_total)) stored,
  priced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_plates_override_check check (
    override_total is null or (override_total >= 0 and nullif(btrim(override_reason), '') is not null)
  )
);

create index quote_plates_quote_id_idx on public.quote_plates (quote_id);
create index quote_plates_printer_id_idx on public.quote_plates (printer_id);

create table public.quote_plate_materials (
  id bigint generated always as identity primary key,
  plate_id bigint not null references public.quote_plates (id) on delete cascade,
  material_id bigint not null references public.materials (id) on delete restrict,
  grams numeric(10,2) not null check (grams > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plate_id, material_id)
);

create index quote_plate_materials_material_id_idx on public.quote_plate_materials (material_id);

alter table public.quote_plates enable row level security;
alter table public.quote_plate_materials enable row level security;

-- Plates of a non-draft quote never change, for any role. FOR SHARE on the quote waits for (and blocks) a
-- concurrent mark_quote_sent, which locks the quote FOR UPDATE.
create or replace function private.quote_plates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' and new.quote_id <> old.quote_id then
    raise exception 'quote_plate_move_not_allowed';
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

create trigger quote_plates_guard
  before update or delete on public.quote_plates
  for each row execute function private.quote_plates_guard();

-- A new quantity, printer or print time invalidates the price; the override is the owner's decision and stays.
create or replace function private.quote_plates_reprice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity is distinct from old.quantity
     or new.printer_id is distinct from old.printer_id
     or new.print_time_s is distinct from old.print_time_s then
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

create trigger quote_plates_reprice
  before update on public.quote_plates
  for each row execute function private.quote_plates_reprice();

create trigger quote_plates_set_updated_at
  before update on public.quote_plates
  for each row execute function private.set_updated_at();

-- Material rows follow the same draft rule, through their plate.
create or replace function private.quote_plate_materials_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate_id bigint := coalesce(new.plate_id, old.plate_id);
  v_status text;
begin
  if tg_op = 'UPDATE' and new.plate_id <> old.plate_id then
    raise exception 'quote_plate_move_not_allowed';
  end if;

  select q.status into v_status
  from public.quote_plates p
  join public.quotes q on q.id = p.quote_id
  where p.id = v_plate_id
  for share of q;
  -- Not found: the plate (or its quote) is being deleted and this is the cascade.
  if found and v_status <> 'draft' then
    raise exception 'quote_not_draft';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger quote_plate_materials_guard
  before insert or update or delete on public.quote_plate_materials
  for each row execute function private.quote_plate_materials_guard();

-- Any change to a plate's materials invalidates the plate's price. Security definer: staff may not write the
-- price columns themselves.
create or replace function private.quote_plate_materials_reprice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.quote_plates set
    material_cost = null,
    machine_cost = null,
    energy_cost = null,
    failure_cost = null,
    setup_fee = null,
    markup_amount = null,
    markup_pct = null,
    computed_total = null,
    priced_at = null
  where id = coalesce(new.plate_id, old.plate_id);
  return null;
end;
$$;

create trigger quote_plate_materials_reprice
  after insert or update or delete on public.quote_plate_materials
  for each row execute function private.quote_plate_materials_reprice();

create trigger quote_plate_materials_set_updated_at
  before update on public.quote_plate_materials
  for each row execute function private.set_updated_at();
```

- [ ] **Step 4: Policies** — append to `supabase/schemas/10_policies.sql`

```sql
-- quote_plates / quote_plate_materials: staff read; staff edit and remove rows of draft quotes (creation goes
-- through create_quote_plate and save_plate_material)
create policy quote_plates_select on public.quote_plates
  for select to authenticated using ((select private.is_staff()));
create policy quote_plates_update on public.quote_plates
  for update to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  )
  with check (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );
create policy quote_plates_delete on public.quote_plates
  for delete to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );

create policy quote_plate_materials_select on public.quote_plate_materials
  for select to authenticated using ((select private.is_staff()));
create policy quote_plate_materials_update on public.quote_plate_materials
  for update to authenticated
  using (
    (select private.is_staff())
    and exists (
      select 1 from public.quote_plates p join public.quotes q on q.id = p.quote_id
      where p.id = plate_id and q.status = 'draft'
    )
  )
  with check (
    (select private.is_staff())
    and exists (
      select 1 from public.quote_plates p join public.quotes q on q.id = p.quote_id
      where p.id = plate_id and q.status = 'draft'
    )
  );
create policy quote_plate_materials_delete on public.quote_plate_materials
  for delete to authenticated
  using (
    (select private.is_staff())
    and exists (
      select 1 from public.quote_plates p join public.quotes q on q.id = p.quote_id
      where p.id = plate_id and q.status = 'draft'
    )
  );
```

- [ ] **Step 5: API** — append to `supabase/schemas/20_quote_api.sql`

```sql
-- Plates: create_quote_plate, set_plate_printer, save_plate_material.

create or replace function private.create_quote_plate(p_quote_id bigint, p_description text, p_printer_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);
  if nullif(btrim(p_description), '') is null then
    raise exception 'invalid_description' using errcode = '22023';
  end if;
  perform private.require_active_catalog(p_printer_id, null);

  insert into public.quote_plates (quote_id, description, printer_id)
  values (p_quote_id, btrim(p_description), p_printer_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_quote_plate(
  quote_id bigint,
  description text,
  printer_id bigint default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_quote_plate($1, $2, $3);
$$;

create or replace function private.set_plate_printer(p_plate_id bigint, p_printer_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate public.quote_plates;
begin
  perform private.require_staff();
  select * into v_plate from public.quote_plates where id = p_plate_id;
  if not found then
    raise exception 'plate_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_plate.quote_id);

  if v_plate.printer_id is not distinct from p_printer_id then
    return;
  end if;
  perform private.require_active_catalog(p_printer_id, null);
  update public.quote_plates set printer_id = p_printer_id where id = p_plate_id;
end;
$$;

create or replace function public.set_plate_printer(plate_id bigint, printer_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_plate_printer($1, $2);
$$;

-- Adds the material to the plate, or sets the grams of the row it already has.
create or replace function private.save_plate_material(p_plate_id bigint, p_material_id bigint, p_grams numeric)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
  v_id bigint;
begin
  perform private.require_staff();
  select quote_id into v_quote_id from public.quote_plates where id = p_plate_id;
  if not found then
    raise exception 'plate_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);

  if p_grams is null or p_grams <= 0 or round(p_grams, 2) <= 0 then
    raise exception 'invalid_grams' using errcode = '22023';
  end if;

  select id into v_id from public.quote_plate_materials where plate_id = p_plate_id and material_id = p_material_id;
  if found then
    update public.quote_plate_materials set grams = p_grams where id = v_id;
  else
    perform private.require_active_catalog(null, p_material_id);
    insert into public.quote_plate_materials (plate_id, material_id, grams)
    values (p_plate_id, p_material_id, p_grams)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_plate_material(plate_id bigint, material_id bigint, grams numeric)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.save_plate_material($1, $2, $3);
$$;
```

- [ ] **Step 6: Grants** — append to `supabase/schemas/90_grants.sql`

```sql
-- plates (the column updates are column grants in the quote_plates migration)
grant delete on public.quote_plates, public.quote_plate_materials to authenticated;

grant execute on function
  public.create_quote_plate(bigint, text, bigint),
  private.create_quote_plate(bigint, text, bigint),
  public.set_plate_printer(bigint, bigint),
  private.set_plate_printer(bigint, bigint),
  public.save_plate_material(bigint, bigint, numeric),
  private.save_plate_material(bigint, bigint, numeric)
to authenticated;
```

- [ ] **Step 7: Write migration 1** `supabase/migrations/20261016090000_quote_plates.sql`. Try `supabase db diff -f quote_plates_tmp` to see the generated DDL; then assemble the final file by hand in this order (**data copy before the triggers**, otherwise the materials guard rejects rows of sent quotes):

```sql
-- 1. Tables, indexes, RLS enable: the DDL of supabase/schemas/06_quote_plates.sql, tables only.
-- 2. Copy: every item becomes one plate with the same id.
insert into public.quote_plates (
  id, quote_id, description, printer_id, print_time_s, quantity,
  material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct,
  computed_total, override_total, override_reason, priced_at, created_at, updated_at
) overriding system value
select id, quote_id, description, printer_id, nullif(print_time_s, 0), quantity,
  material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct,
  computed_total, override_total, override_reason, priced_at, created_at, updated_at
from public.quote_items;

select setval(pg_get_serial_sequence('public.quote_plates', 'id'),
  coalesce((select max(id) from public.quote_plates), 1), (select count(*) > 0 from public.quote_plates));

insert into public.quote_plate_materials (plate_id, material_id, grams, created_at, updated_at)
select id, material_id, filament_g, created_at, updated_at
from public.quote_items
where material_id is not null and filament_g > 0;

-- 3. Triggers and functions: the rest of 06_quote_plates.sql (guards, reprice, updated_at).
-- 4. Policies (10_policies.sql block), API functions (20_quote_api.sql block).
-- 5. Grants:
revoke all on public.quote_plates, public.quote_plate_materials from public, anon, authenticated;
grant select on public.quote_plates, public.quote_plate_materials to authenticated;
grant delete on public.quote_plates, public.quote_plate_materials to authenticated;
grant update (description, quantity, print_time_s) on public.quote_plates to authenticated;
grant update (grams) on public.quote_plate_materials to authenticated;
grant all on public.quote_plates, public.quote_plate_materials to service_role;

revoke execute on function
  public.create_quote_plate(bigint, text, bigint), private.create_quote_plate(bigint, text, bigint),
  public.set_plate_printer(bigint, bigint), private.set_plate_printer(bigint, bigint),
  public.save_plate_material(bigint, bigint, numeric), private.save_plate_material(bigint, bigint, numeric)
from public, anon, authenticated;
grant execute on function
  public.create_quote_plate(bigint, text, bigint), private.create_quote_plate(bigint, text, bigint),
  public.set_plate_printer(bigint, bigint), private.set_plate_printer(bigint, bigint),
  public.save_plate_material(bigint, bigint, numeric), private.save_plate_material(bigint, bigint, numeric)
to authenticated;
revoke execute on function
  private.quote_plates_guard(), private.quote_plates_reprice(),
  private.quote_plate_materials_guard(), private.quote_plate_materials_reprice()
from public, anon, authenticated;

-- 6. Realtime
alter publication supabase_realtime add table public.quote_plates, public.quote_plate_materials;
```

Write the real SQL of steps 1, 3 and 4 into the file (copy from Steps 3–5 above; do not leave the comments as placeholders).

- [ ] **Step 8: Run to verify it passes**

Run: `supabase db reset && supabase test db`
Expected: all files PASS, including `15_quote_plates.test.sql`. Fix the `plan(n)` count if pgTAP reports a mismatch.

- [ ] **Step 9: Add a data-migration test** — append to `15_quote_plates.test.sql` (before `finish()`), as a separate block using a fresh quote, asserting that `insert ... select` of the migration's copy logic handles `filament_g` null / `print_time_s = 0`. Since `quote_items` still exists in this task, seed three items (complete; material but null filament; print_time_s 0), run the two `insert … select` statements of the migration against ids in a `930xxx` range inside the test, and assert: 3 plates, 1 material row, the third plate has `print_time_s is null`. Bump `plan(n)`.

- [ ] **Step 10: Commit**

```bash
git add supabase/schemas supabase/migrations supabase/tests
git commit -m "feat(db): quote plates tables, rules and API"
```

---

### Task 2: Cut over dependents and drop items (migration 2)

**Files:**
- Modify: `supabase/schemas/20_quote_api.sql`, `22_service_api.sql`, `08_quotes_list.sql`, `90_grants.sql`, `10_policies.sql`
- Delete: `supabase/schemas/06_quote_items.sql`, `07_slicing_jobs.sql`, `21_worker_api.sql`
- Create: `supabase/migrations/20261016090100_quote_plates_cutover.sql`
- Test: update `supabase/tests/database/{01,04,06,07,11,12,13,14}_*.test.sql`; delete `05_quote_items.test.sql`, `08_worker.test.sql`

**Interfaces:**
- Consumes: Task 1 tables/RPCs.
- Produces: `set_price_override(plate_id, total, reason)`, `clear_price_override(plate_id)` (renamed param), `get_quote_send_blockers(quote_id) returns table (quote_plate_id bigint, code text)` with codes `not_draft`, `no_plates`, `valid_until_past`, `insufficient_stock`, `plate_incomplete`, `not_priced`; `quotes_list` columns `plate_count` (replaces `item_count`) and `total`; `service_copy_quote_plates(source_id, new_id)` (no `files` arg). `quote_items`, `slicing_jobs`, `create_quote_item`, `update_quote_item_settings`, `retry_slicing`, `enqueue_slicing_job`, `worker_*`, `service_copy_quote_items` no longer exist.

- [ ] **Step 1: Update the tests first (they must fail on the old behaviour)**

Edit the existing pgTAP files, replacing items with plates:
- `04_quotes.test.sql`, `06_quote_api.test.sql`, `07_lifecycle.test.sql`, `11_service_quote_copy.test.sql`, `12_quotes_list.test.sql`, `13_vat.test.sql`, `14_consumables.test.sql`: replace every `insert into public.quote_items (...)` by an insert into `public.quote_plates` (`id, quote_id, description, printer_id, print_time_s, computed_total, ...`) plus, where the test needs a complete plate, an insert into `public.quote_plate_materials (plate_id, material_id, grams)`; `item_total` → `plate_total`; `item_count` → `plate_count`; blocker code `no_items` → `no_plates`; `missing_printer_or_material`/`not_sliced` → `plate_incomplete`; drop every `slicing_jobs` seed and every `create_quote_item`/`update_quote_item_settings`/`retry_slicing` assertion (the plate API is covered by `15`).
- `01_structure.test.sql`: replace the `quote_items`/`slicing_jobs` table and function lists with `quote_plates`, `quote_plate_materials`, `create_quote_plate`, `set_plate_printer`, `save_plate_material`, `service_copy_quote_plates`.
- Delete `05_quote_items.test.sql`; move its override/`item_total` assertions into `15_quote_plates.test.sql` (override needs a reason; `plate_total` is the override when set; owner-only `set_price_override`/`clear_price_override` on a draft plate; non-owner gets `owner_required`).
- Delete `08_worker.test.sql`.
- Add to `12_quotes_list.test.sql`: a quote with one complete priced plate and one plate **without a printer but with an override** → `total is null`; and `plate_count` is 2.
- Add to `06_quote_api.test.sql` (send blockers) one case per code: plate without printer → `(plate id, 'plate_incomplete')`; plate with printer, time and material but `computed_total is null` → `not_priced`; complete priced plate → no rows.

Run: `supabase test db`. Expected: FAIL (old functions/tables).

- [ ] **Step 2: Schema files.** Delete `06_quote_items.sql`, `07_slicing_jobs.sql`, `21_worker_api.sql`. In `20_quote_api.sql` remove `enqueue_slicing_job`, `create_quote_item`, `update_quote_item_settings`, `retry_slicing`, and change:

```sql
-- set_markup_override: clear plate prices
  update public.quote_plates set
    material_cost = null, machine_cost = null, energy_cost = null, failure_cost = null,
    setup_fee = null, markup_amount = null, markup_pct = null, computed_total = null, priced_at = null
  where quote_id = p_quote_id;

-- set_price_override / clear_price_override: param p_plate_id / plate_id, table quote_plates,
-- exception 'plate_not_found' instead of 'item_not_found'.
create or replace function public.set_price_override(plate_id bigint, total numeric, reason text) ...
create or replace function public.clear_price_override(plate_id bigint) ...
```

`get_quote_send_blockers` (replace whole function):

```sql
create or replace function private.get_quote_send_blockers(p_quote_id bigint)
returns table (quote_plate_id bigint, code text)
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
  if not exists (select 1 from public.quote_plates where quote_id = p_quote_id) then
    return query select null::bigint, 'no_plates'::text;
  end if;
  if v_quote.valid_until < private.shop_today() then
    return query select null::bigint, 'valid_until_past'::text;
  end if;
  if exists (
    select 1
    from public.quote_consumables qc
    join public.consumables c on c.id = qc.consumable_id
    where qc.quote_id = p_quote_id and qc.quantity > c.stock
  ) then
    return query select null::bigint, 'insufficient_stock'::text;
  end if;

  return query
  select p.id, b.code
  from public.quote_plates p
  cross join lateral (
    select (p.printer_id is not null
            and p.print_time_s is not null
            and exists (select 1 from public.quote_plate_materials m where m.plate_id = p.id)) as complete
  ) c
  cross join lateral (
    values
      (case when not c.complete then 'plate_incomplete' end),
      (case when c.complete and p.plate_total is null then 'not_priced' end)
  ) as b (code)
  where p.quote_id = p_quote_id and b.code is not null
  order by p.id, b.code;
end;
$$;

create or replace function public.get_quote_send_blockers(quote_id bigint)
returns table (quote_plate_id bigint, code text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_quote_send_blockers($1);
$$;
```

`22_service_api.sql`: replace `service_copy_quote_items` with:

```sql
-- Copies every source plate and its materials into the new draft. The override is kept, the price breakdown is
-- not (the Edge Function prices the copy). Consumable lines of active consumables are copied at today's price.
create or replace function private.service_copy_quote_plates(p_source_id bigint, p_new_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_plate_id bigint;
begin
  perform private.require_draft_quote(p_new_id);

  for r in select * from public.quote_plates where quote_id = p_source_id order by id loop
    insert into public.quote_plates (
      quote_id, description, printer_id, print_time_s, quantity, override_total, override_reason
    ) values (
      p_new_id, r.description, r.printer_id, r.print_time_s, r.quantity, r.override_total, r.override_reason
    )
    returning id into v_plate_id;

    insert into public.quote_plate_materials (plate_id, material_id, grams)
    select v_plate_id, m.material_id, m.grams
    from public.quote_plate_materials m
    where m.plate_id = r.id;
  end loop;

  insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price)
  select p_new_id, qc.consumable_id, qc.quantity, c.unit_price
  from public.quote_consumables qc
  join public.consumables c on c.id = qc.consumable_id
  where qc.quote_id = p_source_id and c.active;
end;
$$;

create or replace function public.service_copy_quote_plates(source_id bigint, new_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.service_copy_quote_plates($1, $2);
$$;
```

`08_quotes_list.sql` (replace whole file):

```sql
-- The quotes list (home page). security_invoker: the caller's RLS on every joined table applies.
-- total is null while the quote has no plates or any plate is incomplete or unpriced, so the list shows "—";
-- otherwise it is the plates plus the quote's consumable lines.

create view public.quotes_list
with (security_invoker = true) as
select
  q.id, q.number, q.number_year, q.number_seq, q.status, q.client_id,
  c.name as client_name, c.company as client_company,
  q.valid_until, q.sent_at, q.created_at,
  (q.created_at at time zone 'Europe/Rome')::date as created_on,
  q.created_by, s.display_name as created_by_name,
  p.plate_count,
  case when p.plate_count > 0 and p.open_count = 0 then p.total + k.total end as total
from public.quotes q
join public.clients c on c.id = q.client_id
join public.staff s on s.user_id = q.created_by
cross join lateral (
  select
    count(*)::integer as plate_count,
    count(*) filter (
      where qp.plate_total is null
         or qp.printer_id is null
         or qp.print_time_s is null
         or not exists (select 1 from public.quote_plate_materials m where m.plate_id = qp.id)
    )::integer as open_count,
    sum(qp.plate_total) as total
  from public.quote_plates qp
  where qp.quote_id = q.id
) p
cross join lateral (
  select coalesce(sum(qc.line_total), 0) as total
  from public.quote_consumables qc
  where qc.quote_id = q.id
) k;
```

`10_policies.sql`: delete the `quote_items_*` and `slicing_jobs_select` policies. `90_grants.sql`: delete the `quote_items`, item functions and worker blocks; change `service_copy_quote_items(bigint,bigint,jsonb)` entries to `service_copy_quote_plates(bigint, bigint)`.

- [ ] **Step 3: Write migration 2** `supabase/migrations/20261016090100_quote_plates_cutover.sql` (hand-written; `supabase db diff` helps check it):

```sql
-- Slicing layer
select pgmq.drop_queue('slicing_jobs');
alter publication supabase_realtime drop table public.slicing_jobs, public.quote_items;
drop function if exists
  public.worker_claim_job(integer, integer), private.worker_claim_job(integer, integer),
  public.worker_complete_job(bigint, bigint, jsonb), private.worker_complete_job(bigint, bigint, jsonb),
  public.worker_fail_job(bigint, bigint, text, boolean), private.worker_fail_job(bigint, bigint, text, boolean),
  public.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  private.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  public.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  private.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  public.retry_slicing(bigint), private.retry_slicing(bigint),
  private.enqueue_slicing_job(bigint),
  public.service_copy_quote_items(bigint, bigint, jsonb), private.service_copy_quote_items(bigint, bigint, jsonb),
  public.set_price_override(bigint, numeric, text), private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint), private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint), private.get_quote_send_blockers(bigint);
drop view public.quotes_list;
drop table public.slicing_jobs;
drop table public.quote_items;
drop function if exists private.quote_items_guard(), private.quote_items_reprice_on_quantity();
```

Then the `create or replace`/`create` statements for `set_markup_override`, `set_price_override`, `clear_price_override`, `get_quote_send_blockers` (public+private), `service_copy_quote_plates` (public+private), the `quotes_list` view with its grants (copy the four lines of `20261015204500_consumables_setup.sql` that set `security_invoker` and grants), and grants:

```sql
revoke execute on function
  public.set_price_override(bigint, numeric, text), private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint), private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint), private.get_quote_send_blockers(bigint),
  public.service_copy_quote_plates(bigint, bigint), private.service_copy_quote_plates(bigint, bigint)
from public, anon, authenticated;
grant execute on function
  public.set_price_override(bigint, numeric, text), private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint), private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint), private.get_quote_send_blockers(bigint)
to authenticated;
grant execute on function
  public.service_copy_quote_plates(bigint, bigint), private.service_copy_quote_plates(bigint, bigint)
to service_role;
```

`mark_quote_sent` needs no change (it only calls the blockers function). The `quotes_list` consumers: none in SQL.

- [ ] **Step 4: Run to verify it passes**

Run: `supabase db reset && supabase test db`
Expected: all PASS. Also `supabase db diff` against the schemas folder prints no difference (state: schemas match migrations).

- [ ] **Step 5: Commit**

```bash
git add -A supabase
git commit -m "feat(db): switch send check, list and duplication to plates; drop items and slicing"
```

---

### Task 3: Pricing and Edge Functions

**Files:**
- Modify: `supabase/functions/_shared/pricing.ts`, `_shared/price-quote.ts`, `duplicate-quote/duplicate.ts`
- Test: `supabase/functions/tests/pricing.test.ts`, `price-quote.integration.test.ts`, `duplicate-quote.integration.test.ts`, `helpers.ts`

**Interfaces:**
- Produces: `PriceInput { printTimeS; materials: { grams: Decimal; costPerKg: Decimal }[]; quantity; hourlyRate; powerW; energyPriceKwh; failurePct; setupFee; markupPct; minimumPrice }`, `pricePlate(input): PriceBreakdown` (renamed from `priceItem`), `PricingSnapshot { quoteId; plates: { id; updatedAt; input: PriceInput | null }[] }`.

- [ ] **Step 1: Update `pricing.test.ts` first.** Replace `filamentG: '120.00', costPerKg: '25.00'` in `worked` by `materials: [{ grams: '120.00', costPerKg: '25.00' }]`; in `setupOnly` use `materials: []`; rename `priceItem` → `pricePlate`; add:

```ts
Deno.test('sums the cost of several materials', () => {
  // 100 g at 20/kg = 2.00 and 50 g at 30/kg = 1.50 → 3.50 of material per copy
  const result = pricePlate({
    ...setupOnly('0', '0'),
    materials: [
      { grams: '100', costPerKg: '20.00' },
      { grams: '50', costPerKg: '30.00' },
    ],
  })
  assertEquals(result.material_cost, '3.5000')
})
```

Run: `deno test --config supabase/functions/deno.json supabase/functions/tests/pricing.test.ts`. Expected: FAIL (`pricePlate` not exported).

- [ ] **Step 2: Implement** in `pricing.ts`: `PriceInput` as above (drop `filamentG`, `costPerKg`); rename `priceItem` → `pricePlate`; replace the material line with

```ts
  const material = input.materials.reduce(
    (sum, m) => sum.add(dec(m.grams).div(THOUSAND).mul(dec(m.costPerKg))),
    int(0),
  )
```

and change the comment "Per item" to "Per plate". Update the file header comment ("per item" → "per plate").

- [ ] **Step 3: Run pricing tests.** Expected: PASS.

- [ ] **Step 4: `price-quote.ts`.** Change `QuoteRow.quote_items` → `quote_plates: PlateRow[]`; `ItemRow` → `PlateRow`:

```ts
interface PlateRow {
  id: number
  updated_at: string
  quantity: number
  print_time_s: number | null
  printer: { hourly_rate: Decimal; power_w: number; failure_rate: number } | null
  materials: { grams: Decimal; material: { cost_per_kg: Decimal } | null }[]
}
```

Select string: `'status, markup_override_pct, quote_plates(id, updated_at, quantity, print_time_s, printer:printers(hourly_rate, power_w, failure_rate), materials:quote_plate_materials(grams, material:materials(cost_per_kg)))'`, ordered by `quote_plates`. A plate is priceable when `printer && print_time_s !== null && materials.length > 0 && materials.every(m => m.material)`:

```ts
input: plate.printer && plate.print_time_s !== null && plate.materials.length > 0
  ? {
    printTimeS: plate.print_time_s,
    materials: plate.materials.map((m) => ({ grams: m.grams, costPerKg: m.material!.cost_per_kg })),
    quantity: plate.quantity,
    hourlyRate: plate.printer.hourly_rate,
    powerW: plate.printer.power_w,
    energyPriceKwh: s.energy_price_kwh,
    failurePct: plate.printer.failure_rate,
    setupFee: s.setup_fee,
    markupPct,
    minimumPrice: s.minimum_item_price,
  }
  : null,
```

`writePrices` updates `quote_plates` (`.update({ ...pricePlate(plate.input), priced_at })`), iterates `snapshot.plates`; comment mentions `quote_plates_guard`. Rename `items` → `plates` in the snapshot and result variables (`PriceQuoteResult` keeps `priced`/`skipped`).

- [ ] **Step 5: `duplicate.ts`.** Remove the storage copy entirely:

```ts
export async function duplicateQuote(admin, sourceId, callerId): Promise<number> {
  // …source check unchanged…
  const { data: newId, error: createError } = await admin.rpc('service_create_quote_copy', {
    source_id: sourceId, created_by: callerId,
  })
  if (createError) throw createError
  const { error: copyError } = await admin.rpc('service_copy_quote_plates', {
    source_id: sourceId, new_id: newId,
  })
  if (copyError) {
    console.error(`Duplicating quote ${sourceId} failed`, copyError)
    // Allowed: the copy is a draft. Its plates, if any, cascade.
    const { error } = await admin.from('quotes').delete().eq('id', newId)
    if (error) console.error(`Deleting the partial copy ${newId} failed`, error)
    throw new HttpError(500, 'duplicate_failed')
  }
  return newId
}
```

Update the doc comment accordingly. Check `duplicate-quote/index.ts` for the item-priced step (`priceQuote`) and any mention of items/files.

- [ ] **Step 6: Integration tests.** In `tests/helpers.ts` and both `*.integration.test.ts`, replace `quote_items` seeding with `quote_plates` + `quote_plate_materials` (printer, `print_time_s`, one material 120 g) and assertions on `plate_total`/`computed_total`. Add to `price-quote.integration.test.ts`: (a) a plate with two materials gets `material_cost` equal to the sum; (b) a plate without materials is skipped (`skipped: 1`, `computed_total` stays null); add to the duplicate test: the copy has the same plates and material rows, and no storage calls. These need the local stack: `supabase start`, then `npm run functions:test`.

- [ ] **Step 7: Run checks.** `npm run functions:check && npm run functions:test`. Expected: PASS.

- [ ] **Step 8: Commit** — `git add supabase/functions && git commit -m "feat(functions): price and duplicate plates"`.

---

### Task 4: Web data layer and rules

**Files:**
- Modify: `apps/web/src/lib/database.types.ts` (regenerate), `data/query-keys.ts`, `data/quote-rules.ts`, `data/quote-rules.test.ts`, `data/quote-live.ts`, `data/quotes.ts`, `data/errors.ts`, `data/errors.test.ts`, `test/fixtures.ts`
- Create: `data/quote-plates.ts`
- Delete: `data/quote-items.ts`, `data/model-upload.ts`, `data/model-upload.test.ts`

**Interfaces:**
- Produces:
  - `type QuotePlate = Tables<'quote_plates'> & { materials: Tables<'quote_plate_materials'>[] }`
  - hooks: `useQuotePlates(quoteId)`, `useCreatePlate()` (`{ quoteId, description, printer_id? }`), `useUpdatePlate()` (`{ plate, values: { description?; quantity?; print_time_s? } }`), `useSetPlatePrinter()` (`{ plate, printerId }`), `useSaveMaterial()` (`{ plate, materialId, grams }`), `useRemoveMaterial()` (`{ plate, materialRowId }`), `useRemovePlate()`, `useSetPriceOverride()` (`{ plate, total, reason }`), `useClearPriceOverride()`, `useCachedQuotePlates()`.
  - rules: `isPlateComplete(plate)`, `incompletePlates(plates)`, `unpricedPlates(plates)`, `quoteTotals(plates, ratePct, consumables)`, `parseDuration(text): number | null`.
  - `queryKeys.quotePlates(id)`.

- [ ] **Step 1: Regenerate types.** Apply both migrations locally (done in Tasks 1–2), then `npm run gen:types`. Expected: `database.types.ts` has `quote_plates`, `quote_plate_materials`, no `quote_items`/`slicing_jobs`; `quotes_list.plate_count`.

- [ ] **Step 2: Write failing rule tests** in `quote-rules.test.ts` (delete the tests of removed rules: slicing state, upload validation, `descriptionFromFilename`, `safeObjectName`, `modelPath`, `defaultCatalogChoice`, `unpricedItems`; replace `quoteTotals` tests):

```ts
import { incompletePlates, isPlateComplete, parseDuration, quoteTotals, unpricedPlates } from './quote-rules'

const plate = (over = {}) => ({
  printer_id: 1, print_time_s: 3600, plate_total: 10, priced_at: '2026-10-16T08:00:00Z',
  materials: [{ grams: 12 }], ...over,
})

describe('isPlateComplete', () => {
  it('needs printer, print time and a material', () => {
    expect(isPlateComplete(plate())).toBe(true)
    expect(isPlateComplete(plate({ printer_id: null }))).toBe(false)
    expect(isPlateComplete(plate({ print_time_s: null }))).toBe(false)
    expect(isPlateComplete(plate({ materials: [] }))).toBe(false)
  })
})

describe('quoteTotals', () => {
  it('is null without plates', () => expect(quoteTotals([], 22)).toBeNull())
  it('is null while a plate is incomplete, even with an override total', () => {
    expect(quoteTotals([plate(), plate({ printer_id: null, plate_total: 5 })], 22)).toBeNull()
  })
  it('is null while a complete plate has no price', () => {
    expect(quoteTotals([plate({ plate_total: null })], 22)).toBeNull()
  })
  it('adds the plates and the consumables, then VAT', () => {
    expect(quoteTotals([plate(), plate({ plate_total: 20.5 })], 22, [{ line_total: 4.5 }]))
      .toEqual({ net: 35, vat: 7.7, gross: 42.7 })
  })
})

describe('unpricedPlates', () => {
  it('lists complete plates that have no price yet', () => {
    const open = plate({ priced_at: null })
    expect(unpricedPlates([plate(), open, plate({ printer_id: null, priced_at: null })])).toEqual([open])
  })
})

describe('incompletePlates', () => {
  it('lists the incomplete ones', () => {
    const bad = plate({ materials: [] })
    expect(incompletePlates([plate(), bad])).toEqual([bad])
  })
})

describe('parseDuration', () => {
  it.each([['1:30', 5400], ['0:05', 300], ['12:00', 43200], [' 2:00 ', 7200]])('%s', (text, s) => {
    expect(parseDuration(text)).toBe(s)
  })
  it.each(['', '0:00', '1:75', '90', '1:5', 'abc', '-1:00', '1:30:00'])('rejects %s', (text) => {
    expect(parseDuration(text)).toBeNull()
  })
})
```

Run: `npm test --workspace @3d-quote/web -- quote-rules`. Expected: FAIL.

- [ ] **Step 3: Implement the rules** in `quote-rules.ts`. Delete everything from `JobStatus` through `safeObjectName`/`modelPath`/`unpricedItems`/`defaultCatalogChoice` (upload and slicing rules). Add:

```ts
type PlateShape = {
  printer_id: number | null
  print_time_s: number | null
  materials: { grams: number }[]
}

/** A plate can be priced: it has a printer, a print time and at least one material. */
export function isPlateComplete(plate: PlateShape): boolean {
  return plate.printer_id !== null && plate.print_time_s !== null && plate.materials.length > 0
}

export function incompletePlates<T extends PlateShape>(plates: T[]): T[] {
  return plates.filter((plate) => !isPlateComplete(plate))
}

/** Complete plates `price-quote` would price that have no price yet. */
export function unpricedPlates<T extends PlateShape & { priced_at: string | null }>(plates: T[]): T[] {
  return plates.filter((plate) => isPlateComplete(plate) && plate.priced_at === null)
}

/** "h:mm" (minutes 00–59, at least one minute in total) as seconds, or null. */
export function parseDuration(text: string): number | null {
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(text.trim())
  if (!match) return null
  const seconds = (Number(match[1]) * 60 + Number(match[2])) * 60
  return seconds > 0 ? seconds : null
}

export function quoteTotals(
  plates: (PlateShape & { plate_total: number | null })[],
  ratePct: number,
  consumables: { line_total: number }[] = [],
): QuoteTotals | null {
  if (plates.length === 0 || plates.some((p) => !isPlateComplete(p) || p.plate_total === null)) return null
  const plateCents = plates.reduce((sum, p) => sum + Math.round((p.plate_total as number) * 100), 0)
  const netCents = consumables.reduce((sum, line) => sum + Math.round(line.line_total * 100), plateCents)
  const rateBasisPoints = Math.round(ratePct * 100)
  const vatCents = Math.floor((netCents * rateBasisPoints + 5000) / 10000)
  return { net: netCents / 100, vat: vatCents / 100, gross: (netCents + vatCents) / 100 }
}
```

Keep `vatRateFor`, `pdfFileName`, list rules unchanged. Update the file's header doc comments. Run the tests: PASS.

- [ ] **Step 4: Query keys.** `queryKeys.quoteItems` → `quotePlates: (id: number) => ['quotes', 'plates', id] as const`.

- [ ] **Step 5: `data/quote-plates.ts`** (new; model it on the deleted `quote-items.ts`):

```ts
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type QuotePlate = Tables<'quote_plates'> & { materials: Tables<'quote_plate_materials'>[] }

/** The quote's plates in creation order, each with its materials in creation order. */
export function useQuotePlates(quoteId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quotePlates(quoteId),
    queryFn: async (): Promise<QuotePlate[]> => {
      const { data, error } = await supabase
        .from('quote_plates')
        .select('*, materials:quote_plate_materials(*)')
        .eq('quote_id', quoteId)
        .order('id')
        .order('id', { referencedTable: 'materials' })
      if (error) throw toAppError(error)
      return data
    },
  })
}

/** A plate change can move the quote's total, so the list refreshes too. */
function refreshPlates(queryClient: QueryClient, quoteId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.quotePlates(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
  ])
}

/** Every edit fails once the quote has left draft; reloading the quote turns the editor read-only. */
function refreshIfNotDraft(queryClient: QueryClient, error: unknown, quoteId: number) {
  if (error instanceof AppError && error.kind === 'notDraft') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) })
  }
}

function useRefreshing() {
  const queryClient = useQueryClient()
  return {
    onSuccess: (quoteId: number) => refreshPlates(queryClient, quoteId),
    onError: (error: unknown, quoteId: number) => refreshIfNotDraft(queryClient, error, quoteId),
  }
}

export function useCreatePlate() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ quoteId, description, printer_id }: {
      quoteId: number; description: string; printer_id: number | null
    }) => {
      const { data, error } = await supabase.rpc('create_quote_plate', {
        quote_id: quoteId,
        description,
        ...(printer_id !== null ? { printer_id } : {}),
      })
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: (_id, { quoteId }) => refresh.onSuccess(quoteId),
    onError: (error, { quoteId }) => refresh.onError(error, quoteId),
  })
}

/** Description, quantity or print time. RLS hides plates of quotes that left draft, so no row back means that. */
export function useUpdatePlate() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ plate, values }: {
      plate: QuotePlate
      values: { description?: string; quantity?: number; print_time_s?: number }
    }) => {
      const { data, error } = await supabase
        .from('quote_plates').update(values).eq('id', plate.id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_d, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useSetPlatePrinter() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ plate, printerId }: { plate: QuotePlate; printerId: number }) => {
      const { error } = await supabase.rpc('set_plate_printer', {
        plate_id: plate.id, printer_id: printerId,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_d, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

/** Adds the material or sets its grams when the plate already has it. */
export function useSaveMaterial() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ plate, materialId, grams }: {
      plate: QuotePlate; materialId: number; grams: number
    }) => {
      const { error } = await supabase.rpc('save_plate_material', {
        plate_id: plate.id, material_id: materialId, grams,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_d, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useRemoveMaterial() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ materialRowId }: { plate: QuotePlate; materialRowId: number }) => {
      const { data, error } = await supabase
        .from('quote_plate_materials').delete().eq('id', materialRowId).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_d, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useRemovePlate() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async (plate: QuotePlate) => {
      const { data, error } = await supabase
        .from('quote_plates').delete().eq('id', plate.id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_d, plate) => refresh.onSuccess(plate.quote_id),
    onError: (error, plate) => refresh.onError(error, plate.quote_id),
  })
}

/** Owner only: sets the plate total by hand; the computed breakdown is kept. */
export function useSetPriceOverride() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ plate, total, reason }: { plate: QuotePlate; total: number; reason: string }) => {
      const { error } = await supabase.rpc('set_price_override', { plate_id: plate.id, total, reason })
      if (error) throw toAppError(error)
    },
    onSuccess: (_d, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useClearPriceOverride() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async (plate: QuotePlate) => {
      const { error } = await supabase.rpc('clear_price_override', { plate_id: plate.id })
      if (error) throw toAppError(error)
    },
    onSuccess: (_d, plate) => refresh.onSuccess(plate.quote_id),
    onError: (error, plate) => refresh.onError(error, plate.quote_id),
  })
}

/** Reads the quote's plates from the cache as they are right now (fresher than the last render). */
export function useCachedQuotePlates() {
  const queryClient = useQueryClient()
  return useCallback(
    (quoteId: number) => queryClient.getQueryData<QuotePlate[]>(queryKeys.quotePlates(quoteId)) ?? [],
    [queryClient],
  )
}
```

- [ ] **Step 6: Delete** `data/quote-items.ts`, `data/model-upload.ts`, `data/model-upload.test.ts`.

- [ ] **Step 7: Live updates** `quote-live.ts`: `useQuoteLiveUpdates(quoteId)` (no ids parameter): one channel, two `postgres_changes` listeners — `quote_plates` with `filter: quote_id=eq.${quoteId}`, and `quote_plate_materials` with no filter (RLS limits it to staff; the refetch is cheap and debounced). Invalidate `queryKeys.quotePlates(quoteId)`. Remove `ids` and the effect dependency on it; update the doc comment.

- [ ] **Step 8: `quotes.ts`.** `item_count` → `plate_count` (type + `LIST_COLUMNS`); `queryKeys.quoteItems` → `quotePlates` in `refreshChangedQuote`, `useRefreshQuote`, `usePriceQuote`; `useDeleteQuote` no longer lists/removes model files (drop the `quote_items` select, the `paths` block and its comments); `SendBlocker = { quote_plate_id: number | null; code: string }` and the cast comment; `usePriceQuote` doc "sliced items" → "complete plates".

- [ ] **Step 9: Errors.** In `data/errors.ts` map the new database messages: `plate_not_found`, `invalid_grams`, `invalid_description` (add kinds/message keys following how `consumable_inactive` is mapped there) and add the keys to both locales in Task 7. Add a case to `errors.test.ts` for `invalid_grams`.

- [ ] **Step 10: Fixtures.** In `test/fixtures.ts` delete `jobRow`, `quoteItemRow`, the `ItemJob`/`Tables<'quote_items'>` imports; rename `item_count` → `plate_count` in `quoteListRow`; add:

```ts
export function plateMaterialRow(overrides: Partial<Tables<'quote_plate_materials'>> = {}) {
  return { id: nextId++, plate_id: 1, material_id: 1, grams: 12, created_at: CREATED, updated_at: CREATED, ...overrides }
}

/** A quote plate as the plates query returns it, with its materials embedded. */
export function quotePlateRow(
  overrides: Partial<Tables<'quote_plates'>> & { materials?: Tables<'quote_plate_materials'>[] } = {},
) {
  const { materials = [], ...rest } = overrides
  const id = rest.id ?? nextId++
  return {
    id, quote_id: 7, description: 'Plate 1', printer_id: null, print_time_s: null, quantity: 1,
    material_cost: null, machine_cost: null, energy_cost: null, failure_cost: null, setup_fee: null,
    markup_amount: null, markup_pct: null, computed_total: null, override_total: null,
    override_reason: null, plate_total: null, priced_at: null, created_at: CREATED, updated_at: CREATED,
    ...rest,
    materials: materials.map((m) => ({ ...m, plate_id: id })),
  }
}
```

- [ ] **Step 11: Compile gate.** `npm run build --workspace @3d-quote/web` will fail until Tasks 5–6; this is expected. Run only `npm test --workspace @3d-quote/web -- quote-rules errors` and expect PASS.

- [ ] **Step 12: Commit** — `git add -A apps/web && git commit -m "feat(web): plate data layer and rules"`.

---

### Task 5: Plate cards in the editor

**Files:**
- Create: `pages/quote-editor/{PlateCard,PlateMaterials,PlatePrice}.tsx`, `pages/quote-editor/QuotePlates.test.tsx`
- Modify: `pages/QuoteEditorPage.tsx`, `quote-editor/use-auto-price.ts`, `quote-editor/OverrideDialog.tsx`
- Delete: `quote-editor/{ItemCard,ItemSettings,ItemPrice,SlicingStatus,UploadZone,use-uploads}.tsx|ts`, `QuoteItems.test.tsx`, `QuoteUploads.test.tsx`, `QuoteLive.test.tsx` rewritten for plates

**Interfaces:**
- Consumes: Task 4 hooks and rules; `InlineField`, `FormField`, `NativeSelect`, `materialLabel(material, t)`, `usePrinters()`, `useMaterials()`, `useFormat()`.
- Produces: `<PlateCard plate editable notCalculated />`; `useAutoPrice(quote, plates)` returns `{ recalculate, pricing, notCalculated(plate) }`.

- [ ] **Step 1: Write failing component tests** `QuotePlates.test.tsx`. Look at the deleted `QuoteItems.test.tsx` for the harness (`render-app`, fetch mock / supabase mock helpers) and reuse it exactly; cases:
  1. empty quote shows "Add a plate to start" and an **Add plate** button; clicking calls `create_quote_plate` with description `Plate 1`.
  2. a plate without printer shows "Choose a printer" and "Add at least one material"; the price area says the total isn't calculated.
  3. choosing a printer calls `set_plate_printer`.
  4. typing `2:30` in Print time calls `update` of `quote_plates` with `{ print_time_s: 9000 }`; `0:00` and `90` show `validation.duration` and make no call.
  5. adding a material (select a material, type `12,5` in grams, click Add) calls `save_plate_material` with `grams: 12.5`; grams `0` shows an error and makes no call.
  6. an existing material row: editing grams calls `save_plate_material` with that material id; **Remove** deletes the row; the material select no longer offers materials the plate already has.
  7. read-only (sent quote): no inputs, only text.
  8. a complete priced plate shows total and the breakdown; an owner sees **Override price**, staff doesn't.

Run: expected FAIL (components missing).

- [ ] **Step 2: `PlatePrice.tsx`** — `git mv ItemPrice.tsx PlatePrice.tsx` and adapt: prop `plate: QuotePlate`; `item.item_total` → `plate.plate_total`; keys `quotes.plate.price.*`; the "calculating/not calculated" paragraph shows only when `isPlateComplete(plate)`; unit price = `plate_total / quantity`; `OverrideDialog plate={plate}`; `clear.mutate(plate, …)`. Replace the line `item.print_time_s !== null &&` with `isPlateComplete(plate) &&`.

- [ ] **Step 3: `PlateMaterials.tsx`**

```tsx
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toAppError } from '@/data/errors'
import { useMaterials } from '@/data/materials'
import type { QuotePlate, useRemoveMaterial, useSaveMaterial } from '@/data/quote-plates'
import { toInputNumber } from '@/lib/format'
import { numberField, parseDecimal } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { materialLabel } from '../quotes/labels'
import { InlineField } from './InlineField'

// numeric(10,2) and > 0 in the database.
const GRAMS = numberField({ gt: 0, max: 99999999, decimals: 2, rangeError: 'validation.grams' })

function gramsProblem(text: string) {
  const result = GRAMS.safeParse(text)
  return result.success ? null : (result.error.issues[0]?.message ?? 'validation.number')
}

/** The plate's materials: one row each with its grams, and a row to add another. */
export function PlateMaterials({
  plate, editable, busy, save, remove,
}: {
  plate: QuotePlate
  editable: boolean
  busy: boolean
  save: ReturnType<typeof useSaveMaterial>
  remove: ReturnType<typeof useRemoveMaterial>
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const materials = useMaterials()
  const [newMaterial, setNewMaterial] = useState('')
  const [newGrams, setNewGrams] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const byId = new Map((materials.data ?? []).map((m) => [m.id, m]))
  const used = new Set(plate.materials.map((m) => m.material_id))
  const options = (materials.data ?? []).filter((m) => m.active && !used.has(m.id))
  const id = `plate-${plate.id}`

  async function add() {
    const problem = newMaterial ? gramsProblem(newGrams) : 'quotes.plate.chooseMaterial'
    if (problem) return setAddError(problem)
    setAddError(null)
    try {
      await save.mutateAsync({
        plate, materialId: Number(newMaterial), grams: parseDecimal(newGrams) as number,
      })
      setNewMaterial('')
      setNewGrams('')
    } catch (caught) {
      setAddError(toAppError(caught).messageKey)
    }
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{t('quotes.plate.materials')}</legend>
      {plate.materials.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('quotes.plate.noMaterials')}</p>
      )}
      <ul className="grid gap-2">
        {plate.materials.map((row) => {
          const material = byId.get(row.material_id)
          const name = material ? materialLabel(material, t) : '—'
          return (
            <li key={row.id} className="flex flex-wrap items-end gap-3">
              <span className="min-w-40 flex-1 pb-2">{name}</span>
              {editable ? (
                <>
                  <InlineField
                    id={`${id}-grams-${row.id}`}
                    label={t('quotes.plate.grams')}
                    value={toInputNumber(row.grams, format.locale, 2)}
                    inputMode="decimal"
                    disabled={busy}
                    validate={gramsProblem}
                    onSave={(text) =>
                      save.mutateAsync({ plate, materialId: row.material_id, grams: parseDecimal(text) as number })
                    }
                  />
                  <Button
                    variant="ghost" size="sm" disabled={busy}
                    aria-label={t('quotes.plate.removeMaterial', { name })}
                    onClick={() =>
                      remove.mutate(
                        { plate, materialRowId: row.id },
                        { onError: (caught) => toast.error(t(toAppError(caught).messageKey)) },
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </>
              ) : (
                <span className="pb-2 tabular-nums">{format.number(row.grams, 2)} g</span>
              )}
            </li>
          )
        })}
      </ul>
      {editable && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField id={`${id}-new-material`} label={t('quotes.plate.addMaterial')}>
            <NativeSelect
              id={`${id}-new-material`} className="w-full" value={newMaterial} disabled={busy}
              onChange={(event) => setNewMaterial(event.target.value)}
            >
              <NativeSelectOption value="">{t('quotes.plate.choose')}</NativeSelectOption>
              {options.map((m) => (
                <NativeSelectOption key={m.id} value={String(m.id)}>{materialLabel(m, t)}</NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id={`${id}-new-grams`} label={t('quotes.plate.grams')} error={addError ? t(addError) : undefined}>
            <Input
              id={`${id}-new-grams`} inputMode="decimal" value={newGrams} disabled={busy}
              aria-invalid={!!addError} onChange={(event) => setNewGrams(event.target.value)}
            />
          </FormField>
          <Button variant="outline" disabled={busy} onClick={() => void add()}>
            {t('quotes.plate.add')}
          </Button>
        </div>
      )}
    </fieldset>
  )
}
```

(`FormField`'s `error` prop takes a translated string as `InlineField` passes an i18n key to it — check `FormField` and pass the same form `InlineField` does; keep consistent.)

- [ ] **Step 4: `PlateCard.tsx`**

```tsx
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toAppError } from '@/data/errors'
import { usePrinters } from '@/data/printers'
import {
  useClearPriceOverride, useRemoveMaterial, useRemovePlate, useSaveMaterial, useSetPlatePrinter,
  useUpdatePlate, type QuotePlate,
} from '@/data/quote-plates'
import { parseDuration } from '@/data/quote-rules'
import { formatDuration } from '@/lib/format'
import { numberField } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { InlineField } from './InlineField'
import { PlateMaterials } from './PlateMaterials'
import { PlatePrice } from './PlatePrice'

const QUANTITY = numberField({ min: 1, max: 2147483647, decimals: 0, rangeError: 'validation.quantity' })

/** One quote plate. `editable` is true while the quote is a draft. */
export function PlateCard({ plate, editable, notCalculated }: {
  plate: QuotePlate; editable: boolean; notCalculated: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const printers = usePrinters()
  const update = useUpdatePlate()
  const setPrinter = useSetPlatePrinter()
  const saveMaterial = useSaveMaterial()
  const removeMaterial = useRemoveMaterial()
  const clear = useClearPriceOverride()
  const remove = useRemovePlate()
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const busy = [update, setPrinter, saveMaterial, removeMaterial, clear, remove].some((m) => m.isPending)
  const id = `plate-${plate.id}`
  const printer = printers.data?.find((p) => p.id === plate.printer_id)
  // Deactivated printers stay listed for the plate that already uses them, so the select shows the truth.
  const printerOptions = (printers.data ?? []).filter((p) => p.active || p.id === plate.printer_id)
  const missing = [
    plate.printer_id === null && t('quotes.plate.missing.printer'),
    plate.print_time_s === null && t('quotes.plate.missing.printTime'),
    plate.materials.length === 0 && t('quotes.plate.missing.materials'),
  ].filter(Boolean)

  async function confirmRemove() {
    setRemoveError(null)
    try {
      await remove.mutateAsync(plate)
      setRemoving(false)
    } catch (caught) {
      setRemoveError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <article aria-labelledby={`${id}-title`} className="grid gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`${id}-title`} className={editable ? 'sr-only' : 'font-medium'}>{plate.description}</h3>
        {editable && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(true)}>
            <Trash2 aria-hidden />
            {t('quotes.plate.remove')}
          </Button>
        )}
      </div>
      {editable ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InlineField
            id={`${id}-description`} label={t('quotes.plate.description')} value={plate.description}
            disabled={busy} revertOnError
            validate={(text) => (text.trim() ? null : 'validation.required')}
            onSave={(text) => update.mutateAsync({ plate, values: { description: text.trim() } })}
          />
          <FormField id={`${id}-printer`} label={t('quotes.plate.printer')}>
            <NativeSelect
              id={`${id}-printer`} className="w-full" disabled={busy}
              value={plate.printer_id === null ? '' : String(plate.printer_id)}
              onChange={(event) => {
                if (!event.target.value) return
                setPrinter.mutate(
                  { plate, printerId: Number(event.target.value) },
                  { onError: (caught) => toast.error(t(toAppError(caught).messageKey)) },
                )
              }}
            >
              <NativeSelectOption value="">{t('quotes.plate.choose')}</NativeSelectOption>
              {printerOptions.map((p) => (
                <NativeSelectOption key={p.id} value={String(p.id)}>
                  {p.active ? p.name : t('quotes.plate.inactive', { name: p.name })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <InlineField
            id={`${id}-time`} label={t('quotes.plate.printTime')} inputMode="text" disabled={busy}
            value={plate.print_time_s === null ? '' : formatDuration(plate.print_time_s)}
            validate={(text) => (parseDuration(text) === null ? 'validation.duration' : null)}
            onSave={(text) =>
              update.mutateAsync({ plate, values: { print_time_s: parseDuration(text) as number } })
            }
          />
          <InlineField
            id={`${id}-quantity`} label={t('quotes.plate.quantity')} value={String(plate.quantity)}
            inputMode="numeric" disabled={busy}
            validate={(text) => {
              const r = QUANTITY.safeParse(text)
              return r.success ? null : (r.error.issues[0]?.message ?? 'validation.number')
            }}
            onSave={(text) => update.mutateAsync({ plate, values: { quantity: Number(text.trim()) } })}
          />
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <div><dt className="text-sm text-muted-foreground">{t('quotes.plate.printer')}</dt><dd>{printer?.name ?? '—'}</dd></div>
          <div><dt className="text-sm text-muted-foreground">{t('quotes.plate.printTime')}</dt><dd>{plate.print_time_s === null ? '—' : formatDuration(plate.print_time_s)}</dd></div>
          <div><dt className="text-sm text-muted-foreground">{t('quotes.plate.quantity')}</dt><dd>{format.number(plate.quantity)}</dd></div>
        </dl>
      )}
      <PlateMaterials plate={plate} editable={editable} busy={busy} save={saveMaterial} remove={removeMaterial} />
      {editable && missing.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('quotes.plate.incomplete', { missing: missing.join(', ') })}
        </p>
      )}
      <PlatePrice plate={plate} editable={editable} notCalculated={notCalculated} busy={busy} clear={clear} />
      {removing && (
        <ConfirmDeleteDialog
          title={t('quotes.plate.removeTitle', { name: plate.description })}
          body={t('quotes.plate.removeBody')}
          pending={remove.isPending}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onCancel={() => { setRemoving(false); setRemoveError(null) }}
        />
      )}
    </article>
  )
}
```

(`formatDuration` is the existing "Seconds as h:mm" helper in `lib/format.ts:56` — confirm its exported name and import it; do not write a second one.)

- [ ] **Step 5: `OverrideDialog.tsx`** — prop `plate: QuotePlate`; import `useSetPriceOverride` from `@/data/quote-plates`; `item.*` → `plate.*`; call `setOverride.mutateAsync({ plate, total, reason })`; i18n keys `quotes.item.overrideDialog.*` → `quotes.plate.overrideDialog.*`.

- [ ] **Step 6: `use-auto-price.ts`** — mechanical rename: `useCachedQuoteItems` → `useCachedQuotePlates`, `unpricedItems` → `unpricedPlates`, `QuoteItem` → `QuotePlate`, variable `items` → `plates`, `item.id`/`updated_at` unchanged, `notCalculated(plate)`; update the doc comment ("plates that are complete and have no price"). Logic is unchanged: a material or printer change bumps `updated_at` and clears `priced_at`, which re-triggers the effect.

- [ ] **Step 7: `QuoteEditorPage.tsx`**

```tsx
function QuoteEditor({ quote }: { quote: Quote }) {
  const { t } = useTranslation()
  const plates = useQuotePlates(quote.id)
  const plateList = plates.data ?? []
  const consumables = useQuoteConsumables(quote.id)
  const consumableList = consumables.data ?? []
  const editable = quote.status === 'draft'
  const pricing = useAutoPrice(quote, plates.data)
  const createPlate = useCreatePlate()
  useQuoteLiveUpdates(quote.id)

  function addPlate() {
    createPlate.mutate(
      {
        quoteId: quote.id,
        description: t('quotes.plate.defaultName', { number: plateList.length + 1 }),
        // Same printer as the newest plate, if it is still active.
        printer_id: plateList.at(-1)?.printer_id ?? null,
      },
      { onError: (caught) => toast.error(t(toAppError(caught).messageKey)) },
    )
  }
  // …header/actions as before with plates={plateList}…
  // Plates section: list of <PlateCard plate editable notCalculated={pricing.notCalculated(plate)} />,
  // empty state <p>{t('quotes.plate.empty')}</p>, and when editable:
  // <Button variant="outline" disabled={createPlate.isPending} onClick={addPlate}><Plus aria-hidden />{t('quotes.plate.add')}</Button>
}
```

Remove `useUploads`, `useLeaveGuard`, `UploadZone`, `useRefreshQuote` imports (the leave guard was only for uploads). The default printer: if `printers` says it is inactive the RPC returns `printer_inactive`; to avoid that, read `usePrinters()` and pass the printer only when active. Pass `plates={plateList}` to `QuoteActions` and `QuoteTotals`.

- [ ] **Step 8: Delete** the files listed above; rewrite `QuoteLive.test.tsx` to assert the two `postgres_changes` subscriptions (`quote_plates` filtered by quote id, `quote_plate_materials`) and that an event invalidates `quotePlates(quoteId)` after 250 ms (adapt the existing test's channel mock).

- [ ] **Step 9: Run** `npm test --workspace @3d-quote/web -- QuotePlates QuoteLive`. Expected: PASS (the build still fails until Task 6).

- [ ] **Step 10: Commit** — `git add -A apps/web && git commit -m "feat(web): plate cards with printer, print time and materials"`.

---

### Task 6: Totals, actions, send dialog, PDF, list

**Files:**
- Modify: `quote-editor/{QuoteTotals,QuoteActions,SendQuoteDialog}.tsx`, `pdf/{quote-pdf-data.ts,quote-pdf-data.test.ts,ExportPdfDialog.tsx,ExportPdf.test.tsx,QuotePdf.tsx,QuotePdf.render.test.ts,sample-data.ts}`, `pages/QuoteEditorPage.test.tsx`, `pages/QuotesPage.tsx` + test (plate count if shown), `QuoteConsumables.test.tsx` (fixtures import)
- Test: the files above

**Interfaces:**
- Consumes: `QuotePlate`, `quoteTotals(plates, rate, consumables)`, `incompletePlates`.

- [ ] **Step 1: Failing tests first.**
  - `QuoteTotals`: with one complete plate priced 10 and one incomplete plate → no amounts (`—`) and the text "Complete all plates to see the total" listing the incomplete plate's description; complete plates → net/VAT/total.
  - `SendQuoteDialog`: blockers `[{ quote_plate_id: 5, code: 'plate_incomplete' }, { quote_plate_id: null, code: 'no_plates' }]` render "Plate 1: choose a printer, a print time and a material." and "The quote has no plates."
  - `QuoteActions`: Mark as sent is **enabled** with incomplete plates (the dialog explains), Export PDF is disabled with `quotes.pdf.needsPlates` for zero plates and `needsComplete` for incomplete/unpriced ones.
  - `quote-pdf-data`: rows show description, `printer · materials` summary column (e.g. `PLA 12 g · PETG 5 g`), quantity, unit price, total; throws `quote_not_priced` when a plate is incomplete.

- [ ] **Step 2: `QuoteTotals.tsx`** — prop `plates: QuotePlate[]`; `quoteTotals(plates, rate, consumables)`; when `rate !== null && totals === null && editable`, render under the figures `<p>{t('quotes.editor.completePlates')}</p>` plus a `<ul>` of `incompletePlates(plates).map(p => p.description)` (and, when all are complete but unpriced, only the "calculating" hint is needed — pricing runs automatically). Doc comment updated.

- [ ] **Step 3: `QuoteActions.tsx`** — drop `isSlicingInProgress`, the `waitSlicing` hint and `slicing` prop usage; **Mark as sent** is always enabled in draft. `const exportBlocked = plates.length === 0 || incompletePlates(plates).length > 0 || plates.some((p) => p.plate_total === null) || !consumablesReady`; hint keys `needsPlates` / `needsComplete` / `loadingConsumables`. Props: `plates: QuotePlate[]`; pass `plates` to `SendQuoteDialog` and `ExportPdfDialog`.

- [ ] **Step 4: `SendQuoteDialog.tsx`** — `plates` prop; `describe(blocker)` looks up `plates.find(p => p.id === blocker.quote_plate_id)` and interpolates `{ plate: plate?.description ?? '' }`; key `quote_plate_id` for React keys.

- [ ] **Step 5: PDF.** In `quote-pdf-data.ts`: `items: QuoteItem[]` → `plates: QuotePlate[]`; the `materials` input keeps `Pick<Material, 'id'|'name'|'type'|'color'>[]`; replace `materialLabel(materials, id)` by

```ts
function materialsSummary(materials: QuotePdfInput['materials'], rows: { material_id: number; grams: number }[], locale: string): string {
  return rows
    .map((row) => {
      const label = materialLabel(materials, row.material_id)
      return label ? `${label} · ${formatNumber(row.grams, locale)} g` : ''
    })
    .filter(Boolean)
    .join(', ')
}
```

and rows: `description: plate.description`, `material: materialsSummary(...)`, `quantity`, `unitPrice: money(plate.plate_total / plate.quantity)`, `total: money(plate.plate_total)`. `quoteTotals(plates, …)` as before (it throws `quote_not_priced` on null). Update `ExportPdfDialog.tsx` (prop and the materials it loads), `sample-data.ts`, and the three PDF tests (`quote-pdf-data.test.ts`, `ExportPdf.test.tsx`, `QuotePdf.render.test.ts`) to use `quotePlateRow` with `materials`.

- [ ] **Step 6: Update remaining tests** that import `quoteItemRow`/`jobRow`: `QuoteEditorPage.test.tsx`, `QuoteConsumables.test.tsx`, `QuotesPage.test.tsx`, `render-app.tsx` (any `quote_items` route mock → `quote_plates`). Run `grep -rn "quote_items\|quoteItem\|QuoteItem\|item_count\|ItemJob" apps/web/src` — expected: no matches.

- [ ] **Step 7: Verify.** `npm run lint && npm run format:check && npm test && npm run build`. Expected: all pass (i18n key parity test may fail until Task 7: do Task 7 before this step if needed).

- [ ] **Step 8: Commit** — `git add -A apps/web && git commit -m "feat(web): totals, send check and PDF from plates"`.

---

### Task 7: Translations and documentation

**Files:**
- Modify: `apps/web/src/i18n/locales/en.json`, `it.json`; `docs/supabase/data-model.md`, `docs/frontend/functional-analysis.md` (§3.4, §5.2, §5.3, §5.6, §7), `docs/frontend/web-app.md`, `docs/architecture/overview.md`, `docs/services/slicer-worker.md` (status note: queue/functions removed), `docs/superpowers/specs/2026-10-16-quote-plates-design.md`

- [ ] **Step 1: Locales.** In both files: replace `quotes.item.*` with `quotes.plate.*` and delete `quotes.item.slicing`, `results`, `download*`, `layerHeight`, `infill`, `supports`, `quotes.upload.*`, `quotes.editor.waitSlicing`, blockers `no_items|missing_printer_or_material|not_sliced`, `quotes.pdf.needsItems`. Add (English; write the Italian equivalents next to them):

```json
"plate": {
  "defaultName": "Plate {{number}}",
  "empty": "Add a plate to start.",
  "add": "Add plate",
  "remove": "Remove",
  "removeTitle": "Remove {{name}}?",
  "removeBody": "The plate and its materials will be deleted.",
  "description": "Description",
  "printer": "Printer",
  "printTime": "Print time (h:mm)",
  "quantity": "Copies",
  "choose": "Choose…",
  "inactive": "{{name}} (inactive)",
  "materials": "Materials",
  "noMaterials": "No materials yet.",
  "addMaterial": "Add material",
  "grams": "Grams",
  "chooseMaterial": "Choose a material.",
  "removeMaterial": "Remove {{name}}",
  "incomplete": "Missing: {{missing}}.",
  "missing": { "printer": "a printer", "printTime": "the print time", "materials": "at least one material" },
  "price": { /* the old quotes.item.price block, "Item total" → "Plate total" */ },
  "overrideDialog": { /* the old quotes.item.overrideDialog block, "item total" → "plate total" */ }
}
```

plus `quotes.editor.plates: "Plates"`, `quotes.editor.completePlates: "Complete all plates to see the total."`, blockers `no_plates: "The quote has no plates."`, `plate_incomplete: "{{plate}}: choose a printer, a print time and a material."`, `not_priced: "{{plate}}: price not calculated."`, `quotes.pdf.needsPlates`, `quotes.pdf.needsComplete`, `validation.duration: "Enter the time as hours:minutes, e.g. 2:30."`, `validation.grams: "Enter grams above zero."`, and the error messages for `invalid_grams`, `plate_not_found`, `invalid_description` wired in Task 4. Replace `quotes.editor.items` usages with `quotes.editor.plates` in the page. List columns showing an item count (if any) use `plate_count`.

- [ ] **Step 2: Run** `npm test --workspace @3d-quote/web -- i18n` (key parity test). Expected: PASS.

- [ ] **Step 3: Docs.** Update the files listed so they describe plates (tables, rules, send blockers, formula "per plate", total gating, removal of slicing/uploads). In the spec: replace the *Migration* paragraph's "Slicing jobs are left in place" with "the slicing queue, slicing jobs and worker functions are dropped with `quote_items` (they reference it); the upload UI is deleted", set `print_time_s > 0`, and set Status to *Implemented* at the end of Task 8.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "docs, i18n: quote plates"`.

---

### Task 8: Whole-system verification and cloud rollout

- [ ] **Step 1: Full local verification.** `supabase db reset && supabase test db && npm run functions:check && npm run functions:test && npm run lint && npm run format:check && npm test && npm run build && npm run check:types-fresh`. Expected: all green. Use the `superpowers:verification-before-completion` skill before claiming this.
- [ ] **Step 2: Browser check.** Start the app (`run` skill), create a quote, add a plate: no total; set printer and time: still no total; add two materials with grams: total appears; remove a material row: total disappears until priced again; send the quote. Report what was observed.
- [ ] **Step 3: Ask the user** before touching the cloud project: this applies two migrations to "3D Quote" (ref `pzukbipwiupezwpvnazh`) that **drop `quote_items` and `slicing_jobs`**, and redeploys `price-quote` and `duplicate-quote`. On a yes: apply both migrations in order with the Supabase MCP `apply_migration` (never other projects), deploy the two functions with `deploy_edge_function`, run `get_advisors` for security, and update the memory note.
- [ ] **Step 4: Mark the spec Implemented, commit.** Do not push or merge to `main` unless asked.
