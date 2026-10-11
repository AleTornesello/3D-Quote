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
