-- Staff: who may use the tool, and the access helpers every policy uses.

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (btrim(display_name) <> ''),
  role text not null default 'operator' check (role in ('operator', 'owner')),
  language text not null default 'it' check (language in ('it', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff enable row level security;

create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function private.set_updated_at();

-- True when the caller is active staff. Security definer so policies can read staff without going through
-- staff's own RLS.
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff
    where user_id = (select auth.uid()) and active
  );
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff
    where user_id = (select auth.uid()) and active and role = 'owner'
  );
$$;

-- Only owners change roles or access, and there is always at least one active owner. Requests without a user
-- (service role, migrations) may change roles but are still held to the last-owner rule.
create or replace function private.staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.role is distinct from old.role or new.active is distinct from old.active)
     and (select auth.uid()) is not null
     and not private.is_owner() then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active) then
    -- Lock the owner rows so two owners can't demote each other at the same time.
    perform 1 from public.staff where role = 'owner' and active for update;
    if not exists (
      select 1 from public.staff
      where role = 'owner' and active and user_id <> old.user_id
    ) then
      raise exception 'last_owner';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger staff_guard
  before update or delete on public.staff
  for each row execute function private.staff_guard();
