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
