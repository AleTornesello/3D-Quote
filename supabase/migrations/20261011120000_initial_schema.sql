set check_function_bodies = off;
create extension if not exists "pg_cron" with schema "pg_catalog";

create schema if not exists "pgmq";

create extension if not exists "pgmq" with schema "pgmq";

create schema if not exists "private";


  create table "public"."staff" (
    "user_id" uuid not null,
    "display_name" text not null,
    "role" text not null default 'operator'::text,
    "language" text not null default 'it'::text,
    "active" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."staff" enable row level security;

CREATE UNIQUE INDEX staff_pkey ON public.staff USING btree (user_id);

alter table "public"."staff" add constraint "staff_pkey" PRIMARY KEY using index "staff_pkey";

alter table "public"."staff" add constraint "staff_display_name_check" CHECK ((btrim(display_name) <> ''::text)) not valid;

alter table "public"."staff" validate constraint "staff_display_name_check";

alter table "public"."staff" add constraint "staff_language_check" CHECK ((language = ANY (ARRAY['it'::text, 'en'::text]))) not valid;

alter table "public"."staff" validate constraint "staff_language_check";

alter table "public"."staff" add constraint "staff_role_check" CHECK ((role = ANY (ARRAY['operator'::text, 'owner'::text]))) not valid;

alter table "public"."staff" validate constraint "staff_role_check";

alter table "public"."staff" add constraint "staff_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."staff" validate constraint "staff_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.staff
    where user_id = (select auth.uid()) and active and role = 'owner'
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.staff
    where user_id = (select auth.uid()) and active
  );
$function$
;

CREATE OR REPLACE FUNCTION private.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.shop_today()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (now() at time zone 'Europe/Rome')::date;
$function$
;

CREATE OR REPLACE FUNCTION private.staff_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

grant insert on table "public"."staff" to "authenticated";

grant select on table "public"."staff" to "authenticated";

grant delete on table "public"."staff" to "service_role";

grant insert on table "public"."staff" to "service_role";

grant references on table "public"."staff" to "service_role";

grant select on table "public"."staff" to "service_role";

grant trigger on table "public"."staff" to "service_role";

grant truncate on table "public"."staff" to "service_role";

grant update on table "public"."staff" to "service_role";


  create policy "staff_insert"
  on "public"."staff"
  as permissive
  for insert
  to authenticated
with check (( SELECT private.is_owner() AS is_owner));



  create policy "staff_select"
  on "public"."staff"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "staff_update"
  on "public"."staff"
  as permissive
  for update
  to authenticated
using ((( SELECT private.is_owner() AS is_owner) OR ((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_staff() AS is_staff))))
with check ((( SELECT private.is_owner() AS is_owner) OR ((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_staff() AS is_staff))));


CREATE TRIGGER staff_guard BEFORE DELETE OR UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.staff_guard();

CREATE TRIGGER staff_set_updated_at BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


