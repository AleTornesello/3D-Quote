-- Quote plates replace quote items. This migration adds the plate tables and copies every item into a plate with
-- the same id (and one material row when the item has a material and a weight); the cutover migration switches
-- the dependents and drops quote_items. Mirrors supabase/schemas/06_quote_plates.sql and the plate blocks of
-- 10_policies.sql, 20_quote_api.sql and 90_grants.sql.

-- Tables
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

-- Copy: every item becomes one plate with the same id, before the triggers exist (the materials guard would reject
-- rows of sent quotes). A zero print time becomes no print time; items without a material or weight get no row.
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

-- Rules
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
  v_plate_id bigint := case when tg_op = 'INSERT' then new.plate_id else old.plate_id end;
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
  where id = case when tg_op = 'DELETE' then old.plate_id else new.plate_id end;
  return null;
end;
$$;

create trigger quote_plate_materials_reprice
  after insert or update or delete on public.quote_plate_materials
  for each row execute function private.quote_plate_materials_reprice();

create trigger quote_plate_materials_set_updated_at
  before update on public.quote_plate_materials
  for each row execute function private.set_updated_at();

-- Policies
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

-- API
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

  if p_grams is null or round(p_grams, 2) <= 0 then
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

-- Grants, mirrored in supabase/schemas/90_grants.sql. New tables get no privileges by default.
revoke all on public.quote_plates, public.quote_plate_materials from public, anon, authenticated;
grant select on public.quote_plates, public.quote_plate_materials to authenticated;
grant delete on public.quote_plates, public.quote_plate_materials to authenticated;
-- Staff edit these columns directly; printer and materials go through the functions, prices through the service.
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
-- Trigger functions in private get no default privileges revoke: take PUBLIC's execute away explicitly.
revoke execute on function
  private.quote_plates_guard(), private.quote_plates_reprice(),
  private.quote_plate_materials_guard(), private.quote_plate_materials_reprice()
from public, anon, authenticated;

-- Realtime: the editor refreshes on plate and material changes.
alter publication supabase_realtime add table public.quote_plates, public.quote_plate_materials;
