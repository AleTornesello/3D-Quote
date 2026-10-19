-- Service-role functions behind the duplicate-quote Edge Function: create the copy, then copy its plates.

-- A new draft with the source's client, notes and markup override. The numbering trigger assigns the number and
-- the default validity.
create or replace function private.service_create_quote_copy(p_source_id bigint, p_created_by uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.service_create_quote_copy(source_id bigint, created_by uuid)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.service_create_quote_copy($1, $2);
$$;

-- Copies every source plate and its materials into the new draft. The override is kept, the price breakdown is
-- not (the Edge Function prices the copy). Consumable lines of active consumables are copied at today's price.
create or replace function private.service_copy_quote_plates(p_source_id bigint, p_new_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_plate_id bigint;
begin
  perform private.require_draft_quote(p_new_id);

  for r in select * from public.quote_plates where quote_id = p_source_id order by id loop
    insert into public.quote_plates (
      quote_id, description, printer_id, print_time_s, quantity, override_total, override_reason
    ) values (
      p_new_id, r.description, r.printer_id, r.print_time_s, r.quantity, r.override_total, r.override_reason
    )
    returning id into v_plate_id;

    insert into public.quote_plate_materials (plate_id, material_id, grams)
    select v_plate_id, m.material_id, m.grams
    from public.quote_plate_materials m
    where m.plate_id = r.id
    order by m.id;
  end loop;

  insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price)
  select p_new_id, qc.consumable_id, qc.quantity, c.unit_price
  from public.quote_consumables qc
  join public.consumables c on c.id = qc.consumable_id
  where qc.quote_id = p_source_id and c.active;
end;
$$;

create or replace function public.service_copy_quote_plates(source_id bigint, new_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.service_copy_quote_plates($1, $2);
$$;
