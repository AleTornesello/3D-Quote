set check_function_bodies = off;
create extension if not exists "pg_cron" with schema "pg_catalog";

create schema if not exists "pgmq";

create extension if not exists "pgmq" with schema "pgmq";

create schema if not exists "private";


  create table "public"."clients" (
    "id" bigint generated always as identity not null,
    "name" text not null,
    "company" text,
    "email" text,
    "phone" text,
    "notes" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."clients" enable row level security;


  create table "public"."materials" (
    "id" bigint generated always as identity not null,
    "name" text not null,
    "type" text not null,
    "color" text,
    "density_g_cm3" numeric(4,2) not null,
    "cost_per_kg" numeric(12,2) not null,
    "active" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."materials" enable row level security;


  create table "public"."printers" (
    "id" bigint generated always as identity not null,
    "name" text not null,
    "model" text not null,
    "build_x_mm" numeric(6,1) not null,
    "build_y_mm" numeric(6,1) not null,
    "build_z_mm" numeric(6,1) not null,
    "nozzle_diameter_mm" numeric(3,2) not null default 0.40,
    "hourly_rate" numeric(12,2) not null,
    "power_w" integer not null,
    "active" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."printers" enable row level security;


  create table "public"."settings" (
    "id" smallint not null default 1,
    "currency" text not null default 'EUR'::text,
    "energy_price_kwh" numeric(8,4) not null default 0,
    "failure_allowance_pct" numeric(5,2) not null default 0,
    "setup_fee" numeric(12,2) not null default 0,
    "default_markup_pct" numeric(6,2) not null default 0,
    "minimum_item_price" numeric(12,2) not null default 0,
    "quote_prefix" text not null default 'Q'::text,
    "default_validity_days" smallint not null default 30,
    "pdf_terms_it" text,
    "pdf_terms_en" text,
    "shop_name" text,
    "shop_address" text,
    "shop_vat_number" text,
    "shop_email" text,
    "shop_phone" text,
    "shop_logo_path" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."settings" enable row level security;


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

CREATE UNIQUE INDEX clients_pkey ON public.clients USING btree (id);

CREATE UNIQUE INDEX materials_pkey ON public.materials USING btree (id);

CREATE UNIQUE INDEX printers_name_key ON public.printers USING btree (name);

CREATE UNIQUE INDEX printers_pkey ON public.printers USING btree (id);

CREATE UNIQUE INDEX settings_pkey ON public.settings USING btree (id);

CREATE UNIQUE INDEX staff_pkey ON public.staff USING btree (user_id);

alter table "public"."clients" add constraint "clients_pkey" PRIMARY KEY using index "clients_pkey";

alter table "public"."materials" add constraint "materials_pkey" PRIMARY KEY using index "materials_pkey";

alter table "public"."printers" add constraint "printers_pkey" PRIMARY KEY using index "printers_pkey";

alter table "public"."settings" add constraint "settings_pkey" PRIMARY KEY using index "settings_pkey";

alter table "public"."staff" add constraint "staff_pkey" PRIMARY KEY using index "staff_pkey";

alter table "public"."clients" add constraint "clients_name_check" CHECK ((btrim(name) <> ''::text)) not valid;

alter table "public"."clients" validate constraint "clients_name_check";

alter table "public"."materials" add constraint "materials_cost_per_kg_check" CHECK ((cost_per_kg >= (0)::numeric)) not valid;

alter table "public"."materials" validate constraint "materials_cost_per_kg_check";

alter table "public"."materials" add constraint "materials_density_g_cm3_check" CHECK ((density_g_cm3 > (0)::numeric)) not valid;

alter table "public"."materials" validate constraint "materials_density_g_cm3_check";

alter table "public"."materials" add constraint "materials_name_check" CHECK ((btrim(name) <> ''::text)) not valid;

alter table "public"."materials" validate constraint "materials_name_check";

alter table "public"."materials" add constraint "materials_type_check" CHECK ((type = ANY (ARRAY['PLA'::text, 'PETG'::text, 'ABS'::text, 'ASA'::text, 'TPU'::text, 'PA'::text, 'PC'::text, 'other'::text]))) not valid;

alter table "public"."materials" validate constraint "materials_type_check";

alter table "public"."printers" add constraint "printers_build_x_mm_check" CHECK ((build_x_mm > (0)::numeric)) not valid;

alter table "public"."printers" validate constraint "printers_build_x_mm_check";

alter table "public"."printers" add constraint "printers_build_y_mm_check" CHECK ((build_y_mm > (0)::numeric)) not valid;

alter table "public"."printers" validate constraint "printers_build_y_mm_check";

alter table "public"."printers" add constraint "printers_build_z_mm_check" CHECK ((build_z_mm > (0)::numeric)) not valid;

alter table "public"."printers" validate constraint "printers_build_z_mm_check";

alter table "public"."printers" add constraint "printers_hourly_rate_check" CHECK ((hourly_rate >= (0)::numeric)) not valid;

alter table "public"."printers" validate constraint "printers_hourly_rate_check";

alter table "public"."printers" add constraint "printers_model_check" CHECK ((btrim(model) <> ''::text)) not valid;

alter table "public"."printers" validate constraint "printers_model_check";

alter table "public"."printers" add constraint "printers_name_check" CHECK ((btrim(name) <> ''::text)) not valid;

alter table "public"."printers" validate constraint "printers_name_check";

alter table "public"."printers" add constraint "printers_name_key" UNIQUE using index "printers_name_key";

alter table "public"."printers" add constraint "printers_nozzle_diameter_mm_check" CHECK ((nozzle_diameter_mm > (0)::numeric)) not valid;

alter table "public"."printers" validate constraint "printers_nozzle_diameter_mm_check";

alter table "public"."printers" add constraint "printers_power_w_check" CHECK ((power_w > 0)) not valid;

alter table "public"."printers" validate constraint "printers_power_w_check";

alter table "public"."settings" add constraint "settings_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text)) not valid;

alter table "public"."settings" validate constraint "settings_currency_check";

alter table "public"."settings" add constraint "settings_default_markup_pct_check" CHECK ((default_markup_pct >= (0)::numeric)) not valid;

alter table "public"."settings" validate constraint "settings_default_markup_pct_check";

alter table "public"."settings" add constraint "settings_default_validity_days_check" CHECK (((default_validity_days >= 1) AND (default_validity_days <= 365))) not valid;

alter table "public"."settings" validate constraint "settings_default_validity_days_check";

alter table "public"."settings" add constraint "settings_energy_price_kwh_check" CHECK ((energy_price_kwh >= (0)::numeric)) not valid;

alter table "public"."settings" validate constraint "settings_energy_price_kwh_check";

alter table "public"."settings" add constraint "settings_failure_allowance_pct_check" CHECK (((failure_allowance_pct >= (0)::numeric) AND (failure_allowance_pct <= (100)::numeric))) not valid;

alter table "public"."settings" validate constraint "settings_failure_allowance_pct_check";

alter table "public"."settings" add constraint "settings_id_check" CHECK ((id = 1)) not valid;

alter table "public"."settings" validate constraint "settings_id_check";

alter table "public"."settings" add constraint "settings_minimum_item_price_check" CHECK ((minimum_item_price >= (0)::numeric)) not valid;

alter table "public"."settings" validate constraint "settings_minimum_item_price_check";

alter table "public"."settings" add constraint "settings_quote_prefix_check" CHECK ((quote_prefix ~ '^[A-Za-z0-9]{1,10}$'::text)) not valid;

alter table "public"."settings" validate constraint "settings_quote_prefix_check";

alter table "public"."settings" add constraint "settings_setup_fee_check" CHECK ((setup_fee >= (0)::numeric)) not valid;

alter table "public"."settings" validate constraint "settings_setup_fee_check";

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

grant delete on table "public"."clients" to "authenticated";

grant insert on table "public"."clients" to "authenticated";

grant select on table "public"."clients" to "authenticated";

grant update on table "public"."clients" to "authenticated";

grant delete on table "public"."clients" to "service_role";

grant insert on table "public"."clients" to "service_role";

grant references on table "public"."clients" to "service_role";

grant select on table "public"."clients" to "service_role";

grant trigger on table "public"."clients" to "service_role";

grant truncate on table "public"."clients" to "service_role";

grant update on table "public"."clients" to "service_role";

grant delete on table "public"."materials" to "authenticated";

grant insert on table "public"."materials" to "authenticated";

grant select on table "public"."materials" to "authenticated";

grant update on table "public"."materials" to "authenticated";

grant delete on table "public"."materials" to "service_role";

grant insert on table "public"."materials" to "service_role";

grant references on table "public"."materials" to "service_role";

grant select on table "public"."materials" to "service_role";

grant trigger on table "public"."materials" to "service_role";

grant truncate on table "public"."materials" to "service_role";

grant update on table "public"."materials" to "service_role";

grant delete on table "public"."printers" to "authenticated";

grant insert on table "public"."printers" to "authenticated";

grant select on table "public"."printers" to "authenticated";

grant update on table "public"."printers" to "authenticated";

grant delete on table "public"."printers" to "service_role";

grant insert on table "public"."printers" to "service_role";

grant references on table "public"."printers" to "service_role";

grant select on table "public"."printers" to "service_role";

grant trigger on table "public"."printers" to "service_role";

grant truncate on table "public"."printers" to "service_role";

grant update on table "public"."printers" to "service_role";

grant select on table "public"."settings" to "authenticated";

grant delete on table "public"."settings" to "service_role";

grant insert on table "public"."settings" to "service_role";

grant references on table "public"."settings" to "service_role";

grant select on table "public"."settings" to "service_role";

grant trigger on table "public"."settings" to "service_role";

grant truncate on table "public"."settings" to "service_role";

grant update on table "public"."settings" to "service_role";

grant insert on table "public"."staff" to "authenticated";

grant select on table "public"."staff" to "authenticated";

grant delete on table "public"."staff" to "service_role";

grant insert on table "public"."staff" to "service_role";

grant references on table "public"."staff" to "service_role";

grant select on table "public"."staff" to "service_role";

grant trigger on table "public"."staff" to "service_role";

grant truncate on table "public"."staff" to "service_role";

grant update on table "public"."staff" to "service_role";


  create policy "clients_delete"
  on "public"."clients"
  as permissive
  for delete
  to authenticated
using (( SELECT private.is_owner() AS is_owner));



  create policy "clients_insert"
  on "public"."clients"
  as permissive
  for insert
  to authenticated
with check (( SELECT private.is_staff() AS is_staff));



  create policy "clients_select"
  on "public"."clients"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "clients_update"
  on "public"."clients"
  as permissive
  for update
  to authenticated
using (( SELECT private.is_staff() AS is_staff))
with check (( SELECT private.is_staff() AS is_staff));



  create policy "materials_delete"
  on "public"."materials"
  as permissive
  for delete
  to authenticated
using (( SELECT private.is_owner() AS is_owner));



  create policy "materials_insert"
  on "public"."materials"
  as permissive
  for insert
  to authenticated
with check (( SELECT private.is_owner() AS is_owner));



  create policy "materials_select"
  on "public"."materials"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "materials_update"
  on "public"."materials"
  as permissive
  for update
  to authenticated
using (( SELECT private.is_owner() AS is_owner))
with check (( SELECT private.is_owner() AS is_owner));



  create policy "printers_delete"
  on "public"."printers"
  as permissive
  for delete
  to authenticated
using (( SELECT private.is_owner() AS is_owner));



  create policy "printers_insert"
  on "public"."printers"
  as permissive
  for insert
  to authenticated
with check (( SELECT private.is_owner() AS is_owner));



  create policy "printers_select"
  on "public"."printers"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "printers_update"
  on "public"."printers"
  as permissive
  for update
  to authenticated
using (( SELECT private.is_owner() AS is_owner))
with check (( SELECT private.is_owner() AS is_owner));



  create policy "settings_select"
  on "public"."settings"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "settings_update"
  on "public"."settings"
  as permissive
  for update
  to authenticated
using (( SELECT private.is_owner() AS is_owner))
with check (( SELECT private.is_owner() AS is_owner));



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


CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER materials_set_updated_at BEFORE UPDATE ON public.materials FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER printers_set_updated_at BEFORE UPDATE ON public.printers FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER staff_guard BEFORE DELETE OR UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.staff_guard();

CREATE TRIGGER staff_set_updated_at BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


