set check_function_bodies = off;
create extension if not exists "pg_cron" with schema "pg_catalog";

create schema if not exists "pgmq";

create extension if not exists "pgmq" with schema "pgmq";

create schema if not exists "private";


  create table "private"."quote_counters" (
    "year" smallint not null,
    "last_seq" integer not null
      );


alter table "private"."quote_counters" enable row level security;


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


  create table "public"."quote_items" (
    "id" bigint generated always as identity not null,
    "quote_id" bigint not null,
    "model_path" text not null,
    "original_filename" text not null,
    "description" text not null,
    "printer_id" bigint,
    "material_id" bigint,
    "quantity" integer not null default 1,
    "layer_height_mm" numeric(3,2) not null default 0.20,
    "infill_percent" smallint not null default 20,
    "supports" boolean not null default false,
    "print_time_s" integer,
    "filament_g" numeric(10,2),
    "bbox_x_mm" numeric(6,1),
    "bbox_y_mm" numeric(6,1),
    "bbox_z_mm" numeric(6,1),
    "material_cost" numeric(14,4),
    "machine_cost" numeric(14,4),
    "energy_cost" numeric(14,4),
    "failure_cost" numeric(14,4),
    "setup_fee" numeric(14,4),
    "markup_amount" numeric(14,4),
    "markup_pct" numeric(6,2),
    "computed_total" numeric(12,2),
    "override_total" numeric(12,2),
    "override_reason" text,
    "item_total" numeric(12,2) generated always as (COALESCE(override_total, computed_total)) stored,
    "priced_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."quote_items" enable row level security;


  create table "public"."quotes" (
    "id" bigint generated always as identity not null,
    "number" text not null,
    "number_year" smallint not null,
    "number_seq" integer not null,
    "client_id" bigint not null,
    "status" text not null default 'draft'::text,
    "valid_until" date not null,
    "notes" text,
    "created_by" uuid not null default auth.uid(),
    "markup_override_pct" numeric(6,2),
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."quotes" enable row level security;


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


  create table "public"."slicing_jobs" (
    "id" bigint generated always as identity not null,
    "quote_item_id" bigint not null,
    "status" text not null default 'queued'::text,
    "attempts" smallint not null default 0,
    "error" text,
    "print_time_s" integer,
    "filament_g" numeric(10,2),
    "filament_mm" numeric(10,2),
    "layer_count" integer,
    "bbox_x_mm" numeric(6,1),
    "bbox_y_mm" numeric(6,1),
    "bbox_z_mm" numeric(6,1),
    "slicer_version" text,
    "queued_at" timestamp with time zone not null default now(),
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone
      );


alter table "public"."slicing_jobs" enable row level security;


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

CREATE UNIQUE INDEX quote_counters_pkey ON private.quote_counters USING btree (year);

CREATE UNIQUE INDEX clients_pkey ON public.clients USING btree (id);

CREATE UNIQUE INDEX materials_pkey ON public.materials USING btree (id);

CREATE UNIQUE INDEX printers_name_key ON public.printers USING btree (name);

CREATE UNIQUE INDEX printers_pkey ON public.printers USING btree (id);

CREATE INDEX quote_items_material_id_idx ON public.quote_items USING btree (material_id);

CREATE UNIQUE INDEX quote_items_model_path_key ON public.quote_items USING btree (model_path);

CREATE UNIQUE INDEX quote_items_pkey ON public.quote_items USING btree (id);

CREATE INDEX quote_items_printer_id_idx ON public.quote_items USING btree (printer_id);

CREATE INDEX quote_items_quote_id_idx ON public.quote_items USING btree (quote_id);

CREATE INDEX quotes_client_id_idx ON public.quotes USING btree (client_id);

CREATE INDEX quotes_created_by_idx ON public.quotes USING btree (created_by);

CREATE UNIQUE INDEX quotes_number_key ON public.quotes USING btree (number);

CREATE UNIQUE INDEX quotes_number_year_number_seq_key ON public.quotes USING btree (number_year, number_seq);

CREATE UNIQUE INDEX quotes_pkey ON public.quotes USING btree (id);

CREATE INDEX quotes_sent_valid_until_idx ON public.quotes USING btree (valid_until) WHERE (status = 'sent'::text);

CREATE UNIQUE INDEX settings_pkey ON public.settings USING btree (id);

CREATE UNIQUE INDEX slicing_jobs_pkey ON public.slicing_jobs USING btree (id);

CREATE INDEX slicing_jobs_quote_item_id_idx ON public.slicing_jobs USING btree (quote_item_id, id DESC);

CREATE UNIQUE INDEX staff_pkey ON public.staff USING btree (user_id);

alter table "private"."quote_counters" add constraint "quote_counters_pkey" PRIMARY KEY using index "quote_counters_pkey";

alter table "public"."clients" add constraint "clients_pkey" PRIMARY KEY using index "clients_pkey";

alter table "public"."materials" add constraint "materials_pkey" PRIMARY KEY using index "materials_pkey";

alter table "public"."printers" add constraint "printers_pkey" PRIMARY KEY using index "printers_pkey";

alter table "public"."quote_items" add constraint "quote_items_pkey" PRIMARY KEY using index "quote_items_pkey";

alter table "public"."quotes" add constraint "quotes_pkey" PRIMARY KEY using index "quotes_pkey";

alter table "public"."settings" add constraint "settings_pkey" PRIMARY KEY using index "settings_pkey";

alter table "public"."slicing_jobs" add constraint "slicing_jobs_pkey" PRIMARY KEY using index "slicing_jobs_pkey";

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

alter table "public"."quote_items" add constraint "quote_items_filament_g_check" CHECK ((filament_g >= (0)::numeric)) not valid;

alter table "public"."quote_items" validate constraint "quote_items_filament_g_check";

alter table "public"."quote_items" add constraint "quote_items_infill_percent_check" CHECK (((infill_percent >= 0) AND (infill_percent <= 100))) not valid;

alter table "public"."quote_items" validate constraint "quote_items_infill_percent_check";

alter table "public"."quote_items" add constraint "quote_items_layer_height_mm_check" CHECK ((layer_height_mm > (0)::numeric)) not valid;

alter table "public"."quote_items" validate constraint "quote_items_layer_height_mm_check";

alter table "public"."quote_items" add constraint "quote_items_material_id_fkey" FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE RESTRICT not valid;

alter table "public"."quote_items" validate constraint "quote_items_material_id_fkey";

alter table "public"."quote_items" add constraint "quote_items_model_path_key" UNIQUE using index "quote_items_model_path_key";

alter table "public"."quote_items" add constraint "quote_items_override_check" CHECK (((override_total IS NULL) OR ((override_total >= (0)::numeric) AND (NULLIF(btrim(override_reason), ''::text) IS NOT NULL)))) not valid;

alter table "public"."quote_items" validate constraint "quote_items_override_check";

alter table "public"."quote_items" add constraint "quote_items_print_time_s_check" CHECK ((print_time_s >= 0)) not valid;

alter table "public"."quote_items" validate constraint "quote_items_print_time_s_check";

alter table "public"."quote_items" add constraint "quote_items_printer_id_fkey" FOREIGN KEY (printer_id) REFERENCES public.printers(id) ON DELETE RESTRICT not valid;

alter table "public"."quote_items" validate constraint "quote_items_printer_id_fkey";

alter table "public"."quote_items" add constraint "quote_items_quantity_check" CHECK ((quantity > 0)) not valid;

alter table "public"."quote_items" validate constraint "quote_items_quantity_check";

alter table "public"."quote_items" add constraint "quote_items_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE CASCADE not valid;

alter table "public"."quote_items" validate constraint "quote_items_quote_id_fkey";

alter table "public"."quotes" add constraint "quotes_client_id_fkey" FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT not valid;

alter table "public"."quotes" validate constraint "quotes_client_id_fkey";

alter table "public"."quotes" add constraint "quotes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.staff(user_id) not valid;

alter table "public"."quotes" validate constraint "quotes_created_by_fkey";

alter table "public"."quotes" add constraint "quotes_markup_override_pct_check" CHECK ((markup_override_pct >= (0)::numeric)) not valid;

alter table "public"."quotes" validate constraint "quotes_markup_override_pct_check";

alter table "public"."quotes" add constraint "quotes_number_key" UNIQUE using index "quotes_number_key";

alter table "public"."quotes" add constraint "quotes_number_year_number_seq_key" UNIQUE using index "quotes_number_year_number_seq_key";

alter table "public"."quotes" add constraint "quotes_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'expired'::text]))) not valid;

alter table "public"."quotes" validate constraint "quotes_status_check";

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

alter table "public"."slicing_jobs" add constraint "slicing_jobs_attempts_check" CHECK ((attempts >= 0)) not valid;

alter table "public"."slicing_jobs" validate constraint "slicing_jobs_attempts_check";

alter table "public"."slicing_jobs" add constraint "slicing_jobs_quote_item_id_fkey" FOREIGN KEY (quote_item_id) REFERENCES public.quote_items(id) ON DELETE CASCADE not valid;

alter table "public"."slicing_jobs" validate constraint "slicing_jobs_quote_item_id_fkey";

alter table "public"."slicing_jobs" add constraint "slicing_jobs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text]))) not valid;

alter table "public"."slicing_jobs" validate constraint "slicing_jobs_status_check";

alter table "public"."staff" add constraint "staff_display_name_check" CHECK ((btrim(display_name) <> ''::text)) not valid;

alter table "public"."staff" validate constraint "staff_display_name_check";

alter table "public"."staff" add constraint "staff_language_check" CHECK ((language = ANY (ARRAY['it'::text, 'en'::text]))) not valid;

alter table "public"."staff" validate constraint "staff_language_check";

alter table "public"."staff" add constraint "staff_role_check" CHECK ((role = ANY (ARRAY['operator'::text, 'owner'::text]))) not valid;

alter table "public"."staff" validate constraint "staff_role_check";

alter table "public"."staff" add constraint "staff_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."staff" validate constraint "staff_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.assign_quote_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

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

CREATE OR REPLACE FUNCTION private.quote_items_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.quote_items_reprice_on_quantity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.quotes_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
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

grant delete on table "public"."quote_items" to "authenticated";

grant select on table "public"."quote_items" to "authenticated";

grant delete on table "public"."quote_items" to "service_role";

grant insert on table "public"."quote_items" to "service_role";

grant references on table "public"."quote_items" to "service_role";

grant select on table "public"."quote_items" to "service_role";

grant trigger on table "public"."quote_items" to "service_role";

grant truncate on table "public"."quote_items" to "service_role";

grant update on table "public"."quote_items" to "service_role";

grant delete on table "public"."quotes" to "authenticated";

grant select on table "public"."quotes" to "authenticated";

grant delete on table "public"."quotes" to "service_role";

grant insert on table "public"."quotes" to "service_role";

grant references on table "public"."quotes" to "service_role";

grant select on table "public"."quotes" to "service_role";

grant trigger on table "public"."quotes" to "service_role";

grant truncate on table "public"."quotes" to "service_role";

grant update on table "public"."quotes" to "service_role";

grant select on table "public"."settings" to "authenticated";

grant delete on table "public"."settings" to "service_role";

grant insert on table "public"."settings" to "service_role";

grant references on table "public"."settings" to "service_role";

grant select on table "public"."settings" to "service_role";

grant trigger on table "public"."settings" to "service_role";

grant truncate on table "public"."settings" to "service_role";

grant update on table "public"."settings" to "service_role";

grant select on table "public"."slicing_jobs" to "authenticated";

grant delete on table "public"."slicing_jobs" to "service_role";

grant insert on table "public"."slicing_jobs" to "service_role";

grant references on table "public"."slicing_jobs" to "service_role";

grant select on table "public"."slicing_jobs" to "service_role";

grant trigger on table "public"."slicing_jobs" to "service_role";

grant truncate on table "public"."slicing_jobs" to "service_role";

grant update on table "public"."slicing_jobs" to "service_role";

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



  create policy "quote_items_delete"
  on "public"."quote_items"
  as permissive
  for delete
  to authenticated
using ((( SELECT private.is_staff() AS is_staff) AND (EXISTS ( SELECT 1
   FROM public.quotes q
  WHERE ((q.id = quote_items.quote_id) AND (q.status = 'draft'::text))))));



  create policy "quote_items_select"
  on "public"."quote_items"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "quote_items_update"
  on "public"."quote_items"
  as permissive
  for update
  to authenticated
using ((( SELECT private.is_staff() AS is_staff) AND (EXISTS ( SELECT 1
   FROM public.quotes q
  WHERE ((q.id = quote_items.quote_id) AND (q.status = 'draft'::text))))))
with check ((( SELECT private.is_staff() AS is_staff) AND (EXISTS ( SELECT 1
   FROM public.quotes q
  WHERE ((q.id = quote_items.quote_id) AND (q.status = 'draft'::text))))));



  create policy "quotes_delete"
  on "public"."quotes"
  as permissive
  for delete
  to authenticated
using ((( SELECT private.is_owner() AS is_owner) AND (status = 'draft'::text)));



  create policy "quotes_insert"
  on "public"."quotes"
  as permissive
  for insert
  to authenticated
with check (( SELECT private.is_staff() AS is_staff));



  create policy "quotes_select"
  on "public"."quotes"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "quotes_update"
  on "public"."quotes"
  as permissive
  for update
  to authenticated
using ((( SELECT private.is_staff() AS is_staff) AND (status = 'draft'::text)))
with check ((( SELECT private.is_staff() AS is_staff) AND (status = 'draft'::text)));



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



  create policy "slicing_jobs_select"
  on "public"."slicing_jobs"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



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

CREATE TRIGGER quote_items_guard BEFORE DELETE OR UPDATE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION private.quote_items_guard();

CREATE TRIGGER quote_items_reprice_on_quantity BEFORE UPDATE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION private.quote_items_reprice_on_quantity();

CREATE TRIGGER quote_items_set_updated_at BEFORE UPDATE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER quotes_assign_number BEFORE INSERT ON public.quotes FOR EACH ROW EXECUTE FUNCTION private.assign_quote_number();

CREATE TRIGGER quotes_guard BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION private.quotes_guard();

CREATE TRIGGER quotes_set_updated_at BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER staff_guard BEFORE DELETE OR UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.staff_guard();

CREATE TRIGGER staff_set_updated_at BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


