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
  -- Lock in id order, as mark_quote_sent does, so a concurrent send cannot deadlock with this.
  perform 1 from public.consumables
  where id in (select consumable_id from public.quote_consumables where quote_id = new.id)
  order by id for update;
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
