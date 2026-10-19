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
