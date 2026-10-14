alter table "public"."printers" drop constraint "printers_build_x_mm_check";

alter table "public"."printers" drop constraint "printers_build_y_mm_check";

alter table "public"."printers" drop constraint "printers_build_z_mm_check";

alter table "public"."printers" drop constraint "printers_nozzle_diameter_mm_check";

alter table "public"."printers" drop column "build_x_mm";

alter table "public"."printers" drop column "build_y_mm";

alter table "public"."printers" drop column "build_z_mm";

alter table "public"."printers" drop column "nozzle_diameter_mm";

alter table "public"."printers" add column "type" text not null default 'FDM'::text;

alter table "public"."printers" add constraint "printers_type_check" CHECK ((type = ANY (ARRAY['FDM'::text, 'SLA'::text]))) not valid;

alter table "public"."printers" validate constraint "printers_type_check";

set check_function_bodies = off;

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
