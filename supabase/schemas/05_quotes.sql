-- Quotes, their yearly numbering, and the rule that only drafts can change.

create table public.quotes (
  id bigint generated always as identity primary key,
  number text not null unique,
  number_year smallint not null,
  number_seq integer not null,
  client_id bigint not null references public.clients (id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  valid_until date not null,
  notes text,
  created_by uuid not null default auth.uid() references public.staff (user_id),
  markup_override_pct numeric(6,2) check (markup_override_pct >= 0),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (number_year, number_seq)
);

create index quotes_client_id_idx on public.quotes (client_id);
create index quotes_created_by_idx on public.quotes (created_by);
create index quotes_sent_valid_until_idx on public.quotes (valid_until) where status = 'sent';

alter table public.quotes enable row level security;

-- One counter row per year; the upsert below makes numbering safe under concurrent inserts.
create table private.quote_counters (
  year smallint primary key,
  last_seq integer not null
);

alter table private.quote_counters enable row level security;

-- Assigns <prefix>-<year>-<seq> (seq zero-padded to 4 digits, longer past 9999) and the default validity.
-- Values supplied for number, number_year and number_seq are always replaced.
create or replace function private.assign_quote_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from private.shop_today())::smallint;
  v_seq integer;
  v_prefix text;
  v_validity smallint;
begin
  insert into private.quote_counters as c (year, last_seq)
  values (v_year, 1)
  on conflict (year) do update set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;

  select quote_prefix, default_validity_days into v_prefix, v_validity
  from public.settings
  where id = 1;

  new.number_year := v_year;
  new.number_seq := v_seq;
  new.number := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  if new.valid_until is null then
    new.valid_until := private.shop_today() + v_validity;
  end if;
  return new;
end;
$$;

create trigger quotes_assign_number
  before insert on public.quotes
  for each row execute function private.assign_quote_number();

-- Once a quote leaves draft, the only change allowed is sent → accepted / rejected / expired, and it can't be
-- deleted (with its frozen items) by any role, the service role included.
create or replace function private.quotes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'quote_not_draft';
    end if;
    return old;
  end if;

  if old.status <> 'draft'
     and not (
       old.status = 'sent'
       and new.status in ('accepted', 'rejected', 'expired')
       and (to_jsonb(new) - array['status', 'updated_at']) = (to_jsonb(old) - array['status', 'updated_at'])
     ) then
    raise exception 'quote_not_draft';
  end if;
  return new;
end;
$$;

create trigger quotes_guard
  before update or delete on public.quotes
  for each row execute function private.quotes_guard();

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function private.set_updated_at();
