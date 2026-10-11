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
