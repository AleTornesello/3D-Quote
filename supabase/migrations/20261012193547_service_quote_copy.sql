set check_function_bodies = off;

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
end;
$function$
;

CREATE OR REPLACE FUNCTION private.service_create_quote_copy(p_source_id bigint, p_created_by uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source public.quotes;
  v_id bigint;
begin
  select * into v_source from public.quotes where id = p_source_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  insert into public.quotes (client_id, notes, markup_override_pct, created_by)
  values (v_source.client_id, v_source.notes, v_source.markup_override_pct, p_created_by)
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.service_copy_quote_items(source_id bigint, new_id bigint, files jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.service_copy_quote_items($1, $2, $3);
$function$
;

CREATE OR REPLACE FUNCTION public.service_create_quote_copy(source_id bigint, created_by uuid)
 RETURNS bigint
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.service_create_quote_copy($1, $2);
$function$
;


