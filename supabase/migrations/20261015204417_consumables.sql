drop view if exists "public"."quotes_list";


  create table "public"."consumables" (
    "id" bigint generated always as identity not null,
    "name" text not null,
    "unit" text not null default 'pcs'::text,
    "unit_price" numeric(12,2) not null,
    "stock" integer not null default 0,
    "active" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."consumables" enable row level security;


  create table "public"."quote_consumables" (
    "id" bigint generated always as identity not null,
    "quote_id" bigint not null,
    "consumable_id" bigint not null,
    "quantity" integer not null,
    "unit_price" numeric(12,2) not null,
    "line_total" numeric(12,2) generated always as (((quantity)::numeric * unit_price)) stored,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."quote_consumables" enable row level security;

CREATE UNIQUE INDEX consumables_name_key ON public.consumables USING btree (name);

CREATE UNIQUE INDEX consumables_pkey ON public.consumables USING btree (id);

CREATE INDEX quote_consumables_consumable_id_idx ON public.quote_consumables USING btree (consumable_id);

CREATE UNIQUE INDEX quote_consumables_pkey ON public.quote_consumables USING btree (id);

CREATE UNIQUE INDEX quote_consumables_quote_id_consumable_id_key ON public.quote_consumables USING btree (quote_id, consumable_id);

alter table "public"."consumables" add constraint "consumables_pkey" PRIMARY KEY using index "consumables_pkey";

alter table "public"."quote_consumables" add constraint "quote_consumables_pkey" PRIMARY KEY using index "quote_consumables_pkey";

alter table "public"."consumables" add constraint "consumables_name_check" CHECK ((btrim(name) <> ''::text)) not valid;

alter table "public"."consumables" validate constraint "consumables_name_check";

alter table "public"."consumables" add constraint "consumables_name_key" UNIQUE using index "consumables_name_key";

alter table "public"."consumables" add constraint "consumables_stock_check" CHECK ((stock >= 0)) not valid;

alter table "public"."consumables" validate constraint "consumables_stock_check";

alter table "public"."consumables" add constraint "consumables_unit_check" CHECK ((btrim(unit) <> ''::text)) not valid;

alter table "public"."consumables" validate constraint "consumables_unit_check";

alter table "public"."consumables" add constraint "consumables_unit_price_check" CHECK ((unit_price >= (0)::numeric)) not valid;

alter table "public"."consumables" validate constraint "consumables_unit_price_check";

alter table "public"."quote_consumables" add constraint "quote_consumables_consumable_id_fkey" FOREIGN KEY (consumable_id) REFERENCES public.consumables(id) ON DELETE RESTRICT not valid;

alter table "public"."quote_consumables" validate constraint "quote_consumables_consumable_id_fkey";

alter table "public"."quote_consumables" add constraint "quote_consumables_quantity_check" CHECK ((quantity > 0)) not valid;

alter table "public"."quote_consumables" validate constraint "quote_consumables_quantity_check";

alter table "public"."quote_consumables" add constraint "quote_consumables_quote_id_consumable_id_key" UNIQUE using index "quote_consumables_quote_id_consumable_id_key";

alter table "public"."quote_consumables" add constraint "quote_consumables_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE CASCADE not valid;

alter table "public"."quote_consumables" validate constraint "quote_consumables_quote_id_fkey";

alter table "public"."quote_consumables" add constraint "quote_consumables_unit_price_check" CHECK ((unit_price >= (0)::numeric)) not valid;

alter table "public"."quote_consumables" validate constraint "quote_consumables_unit_price_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.add_quote_consumable(p_quote_id bigint, p_consumable_id bigint, p_quantity integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_price numeric;
  v_id bigint;
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);

  select unit_price into v_price from public.consumables where id = p_consumable_id and active;
  if not found then
    raise exception 'consumable_inactive' using errcode = '22023';
  end if;

  insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price)
  values (p_quote_id, p_consumable_id, p_quantity, v_price)
  on conflict (quote_id, consumable_id)
    do update set quantity = public.quote_consumables.quantity + excluded.quantity
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.quote_consumables_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.quotes_return_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.add_quote_consumable(quote_id bigint, consumable_id bigint, quantity integer)
 RETURNS bigint
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.add_quote_consumable($1, $2, $3);
$function$
;

CREATE OR REPLACE FUNCTION private.get_quote_send_blockers(p_quote_id bigint)
 RETURNS TABLE(quote_item_id bigint, code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_quote public.quotes;
begin
  perform private.require_staff();
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  if v_quote.status <> 'draft' then
    return query select null::bigint, 'not_draft'::text;
    return;
  end if;
  if not exists (select 1 from public.quote_items where quote_id = p_quote_id) then
    return query select null::bigint, 'no_items'::text;
  end if;
  if v_quote.valid_until < private.shop_today() then
    return query select null::bigint, 'valid_until_past'::text;
  end if;
  if exists (
    select 1
    from public.quote_consumables qc
    join public.consumables c on c.id = qc.consumable_id
    where qc.quote_id = p_quote_id and qc.quantity > c.stock
  ) then
    return query select null::bigint, 'insufficient_stock'::text;
  end if;

  return query
  select i.id, b.code
  from public.quote_items i
  left join lateral (
    select j.status
    from public.slicing_jobs j
    where j.quote_item_id = i.id
    order by j.id desc
    limit 1
  ) lj on true
  cross join lateral (
    values
      (case when i.printer_id is null or i.material_id is null then 'missing_printer_or_material' end),
      (case when lj.status is distinct from 'succeeded' or i.print_time_s is null or i.filament_g is null
              or i.bbox_x_mm is null then 'not_sliced' end),
      (case when i.item_total is null then 'not_priced' end)
  ) as b (code)
  where i.quote_id = p_quote_id and b.code is not null
  order by i.id, b.code;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.mark_quote_sent(p_quote_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);
  -- Lock the consumables first, in id order, so two sends can't spend the same stock.
  perform c.id
  from public.consumables c
  where c.id in (select consumable_id from public.quote_consumables where quote_id = p_quote_id)
  order by c.id
  for update;
  if exists (select 1 from private.get_quote_send_blockers(p_quote_id)) then
    raise exception 'quote_not_sendable';
  end if;
  update public.consumables c
  set stock = c.stock - qc.quantity
  from public.quote_consumables qc
  where qc.quote_id = p_quote_id and qc.consumable_id = c.id;
  update public.quotes
  set status = 'sent',
      sent_at = now(),
      vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
  where id = p_quote_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.service_copy_quote_items(p_source_id bigint, p_new_id bigint, p_files jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_item_id bigint;
begin
  perform private.require_draft_quote(p_new_id);

  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'invalid_copy' using errcode = '22023';
  end if;
  if (select array_agg((e ->> 'item_id')::bigint order by (e ->> 'item_id')::bigint)
      from jsonb_array_elements(p_files) as e)
     is distinct from
     (select array_agg(i.id order by i.id) from public.quote_items i where i.quote_id = p_source_id) then
    raise exception 'invalid_copy' using errcode = '22023';
  end if;

  for r in
    select i.*, e ->> 'model_path' as new_path
    from jsonb_array_elements(p_files) as e
    join public.quote_items i on i.id = (e ->> 'item_id')::bigint
    order by i.id
  loop
    if r.new_path is null or split_part(r.new_path, '/', 1) <> p_new_id::text then
      raise exception 'invalid_model_path' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'models' and name = r.new_path) then
      raise exception 'model_not_found' using errcode = 'P0002';
    end if;

    insert into public.quote_items (
      quote_id, model_path, original_filename, description, printer_id, material_id, quantity,
      layer_height_mm, infill_percent, supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm,
      override_total, override_reason
    ) values (
      p_new_id, r.new_path, r.original_filename, r.description, r.printer_id, r.material_id, r.quantity,
      r.layer_height_mm, r.infill_percent, r.supports, r.print_time_s, r.filament_g, r.bbox_x_mm, r.bbox_y_mm,
      r.bbox_z_mm, r.override_total, r.override_reason
    )
    returning id into v_item_id;

    if r.print_time_s is not null then
      -- The item's own results, so the copy matches what was priced; the rest from the newest succeeded job.
      insert into public.slicing_jobs (
        quote_item_id, status, attempts, print_time_s, filament_g, filament_mm, layer_count,
        bbox_x_mm, bbox_y_mm, bbox_z_mm, slicer_version, queued_at, started_at, finished_at
      )
      select v_item_id, 'succeeded', coalesce(j.attempts, 0), r.print_time_s, r.filament_g, j.filament_mm,
             j.layer_count, r.bbox_x_mm, r.bbox_y_mm, r.bbox_z_mm, j.slicer_version, now(), now(), now()
      from (select 1) as one
      left join lateral (
        select sj.attempts, sj.filament_mm, sj.layer_count, sj.slicer_version
        from public.slicing_jobs sj
        where sj.quote_item_id = r.id and sj.status = 'succeeded'
        order by sj.id desc
        limit 1
      ) as j on true;
    elsif r.printer_id is not null and r.material_id is not null then
      perform private.enqueue_slicing_job(v_item_id);
    end if;
  end loop;

  -- Consumable lines of active consumables, at today's price.
  insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price)
  select p_new_id, qc.consumable_id, qc.quantity, c.unit_price
  from public.quote_consumables qc
  join public.consumables c on c.id = qc.consumable_id
  where qc.quote_id = p_source_id and c.active;
end;
$function$
;

create or replace view "public"."quotes_list" as  SELECT q.id,
    q.number,
    q.number_year,
    q.number_seq,
    q.status,
    q.client_id,
    c.name AS client_name,
    c.company AS client_company,
    q.valid_until,
    q.sent_at,
    q.created_at,
    ((q.created_at AT TIME ZONE 'Europe/Rome'::text))::date AS created_on,
    q.created_by,
    s.display_name AS created_by_name,
    i.item_count,
        CASE
            WHEN ((i.item_count > 0) AND (i.unpriced_count = 0)) THEN (i.total + k.total)
            ELSE NULL::numeric
        END AS total
   FROM ((((public.quotes q
     JOIN public.clients c ON ((c.id = q.client_id)))
     JOIN public.staff s ON ((s.user_id = q.created_by)))
     CROSS JOIN LATERAL ( SELECT (count(*))::integer AS item_count,
            (count(*) FILTER (WHERE (qi.item_total IS NULL)))::integer AS unpriced_count,
            sum(qi.item_total) AS total
           FROM public.quote_items qi
          WHERE (qi.quote_id = q.id)) i)
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(qc.line_total), (0)::numeric) AS total
           FROM public.quote_consumables qc
          WHERE (qc.quote_id = q.id)) k);


grant delete on table "public"."consumables" to "authenticated";

grant insert on table "public"."consumables" to "authenticated";

grant select on table "public"."consumables" to "authenticated";

grant update on table "public"."consumables" to "authenticated";

grant delete on table "public"."consumables" to "service_role";

grant insert on table "public"."consumables" to "service_role";

grant references on table "public"."consumables" to "service_role";

grant select on table "public"."consumables" to "service_role";

grant trigger on table "public"."consumables" to "service_role";

grant truncate on table "public"."consumables" to "service_role";

grant update on table "public"."consumables" to "service_role";

grant delete on table "public"."quote_consumables" to "authenticated";

grant select on table "public"."quote_consumables" to "authenticated";

grant delete on table "public"."quote_consumables" to "service_role";

grant insert on table "public"."quote_consumables" to "service_role";

grant references on table "public"."quote_consumables" to "service_role";

grant select on table "public"."quote_consumables" to "service_role";

grant trigger on table "public"."quote_consumables" to "service_role";

grant truncate on table "public"."quote_consumables" to "service_role";

grant update on table "public"."quote_consumables" to "service_role";


  create policy "consumables_delete"
  on "public"."consumables"
  as permissive
  for delete
  to authenticated
using (( SELECT private.is_owner() AS is_owner));



  create policy "consumables_insert"
  on "public"."consumables"
  as permissive
  for insert
  to authenticated
with check (( SELECT private.is_owner() AS is_owner));



  create policy "consumables_select"
  on "public"."consumables"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "consumables_update"
  on "public"."consumables"
  as permissive
  for update
  to authenticated
using (( SELECT private.is_owner() AS is_owner))
with check (( SELECT private.is_owner() AS is_owner));



  create policy "quote_consumables_delete"
  on "public"."quote_consumables"
  as permissive
  for delete
  to authenticated
using ((( SELECT private.is_staff() AS is_staff) AND (EXISTS ( SELECT 1
   FROM public.quotes q
  WHERE ((q.id = quote_consumables.quote_id) AND (q.status = 'draft'::text))))));



  create policy "quote_consumables_select"
  on "public"."quote_consumables"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_staff() AS is_staff));



  create policy "quote_consumables_update"
  on "public"."quote_consumables"
  as permissive
  for update
  to authenticated
using ((( SELECT private.is_staff() AS is_staff) AND (EXISTS ( SELECT 1
   FROM public.quotes q
  WHERE ((q.id = quote_consumables.quote_id) AND (q.status = 'draft'::text))))))
with check ((( SELECT private.is_staff() AS is_staff) AND (EXISTS ( SELECT 1
   FROM public.quotes q
  WHERE ((q.id = quote_consumables.quote_id) AND (q.status = 'draft'::text))))));


CREATE TRIGGER consumables_set_updated_at BEFORE UPDATE ON public.consumables FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER quote_consumables_guard BEFORE INSERT OR DELETE OR UPDATE ON public.quote_consumables FOR EACH ROW EXECUTE FUNCTION private.quote_consumables_guard();

CREATE TRIGGER quote_consumables_set_updated_at BEFORE UPDATE ON public.quote_consumables FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER quotes_return_stock AFTER UPDATE OF status ON public.quotes FOR EACH ROW WHEN (((old.status = 'sent'::text) AND (new.status = ANY (ARRAY['rejected'::text, 'expired'::text])))) EXECUTE FUNCTION private.quotes_return_stock();


