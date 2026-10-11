-- Base objects every other schema file relies on.

create schema if not exists private;

create extension if not exists pgmq;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- The shop's calendar date. Quote number years, the send check and the expiry job all use it, so this is the one
-- place to change the timezone.
create or replace function private.shop_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Rome')::date;
$$;
