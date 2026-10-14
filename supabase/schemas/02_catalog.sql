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
  -- Optional: when set, the app derived hourly_rate from them (purchase_cost / lifetime_hours). Pricing reads hourly_rate only.
  purchase_cost numeric(12,2) check (purchase_cost > 0),
  lifetime_hours integer check (lifetime_hours > 0),
  power_w integer not null check (power_w > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint printers_purchase_pair check ((purchase_cost is null) = (lifetime_hours is null))
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
