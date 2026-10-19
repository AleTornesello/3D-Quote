-- Cutover to quote plates: the send check, the quotes list, the owner overrides and the duplicate copy now read
-- quote_plates; quote_items goes, and with it the slicing layer that hangs off it (queue, jobs, worker and item
-- functions). Mirrors supabase/schemas/08_quotes_list.sql, 20_quote_api.sql, 22_service_api.sql and 90_grants.sql.

-- Slicing layer and items
select pgmq.drop_queue('slicing_jobs');
alter publication supabase_realtime drop table public.slicing_jobs, public.quote_items;
drop function
  public.worker_claim_job(integer, integer), private.worker_claim_job(integer, integer),
  public.worker_complete_job(bigint, bigint, jsonb), private.worker_complete_job(bigint, bigint, jsonb),
  public.worker_fail_job(bigint, bigint, text, boolean), private.worker_fail_job(bigint, bigint, text, boolean),
  private.require_job_message(bigint, bigint),
  public.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  private.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  public.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  private.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  public.retry_slicing(bigint), private.retry_slicing(bigint),
  private.enqueue_slicing_job(bigint),
  public.service_copy_quote_items(bigint, bigint, jsonb), private.service_copy_quote_items(bigint, bigint, jsonb),
  public.set_price_override(bigint, numeric, text), private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint), private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint), private.get_quote_send_blockers(bigint);
drop view public.quotes_list;
drop table public.slicing_jobs;
drop table public.quote_items;
drop function private.quote_items_guard(), private.quote_items_reprice_on_quantity();

-- A markup change clears every plate's price
create or replace function private.set_markup_override(p_quote_id bigint, p_pct numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_owner();
  perform private.require_draft_quote(p_quote_id);
  if p_pct < 0 then
    raise exception 'invalid_markup' using errcode = '22023';
  end if;

  update public.quotes set markup_override_pct = p_pct where id = p_quote_id;
  update public.quote_plates set
    material_cost = null,
    machine_cost = null,
    energy_cost = null,
    failure_cost = null,
    setup_fee = null,
    markup_amount = null,
    markup_pct = null,
    computed_total = null,
    priced_at = null
  where quote_id = p_quote_id;
end;
$$;

-- Plate overrides (the parameter is now plate_id)
create or replace function private.set_price_override(p_plate_id bigint, p_total numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
begin
  perform private.require_owner();
  select quote_id into v_quote_id from public.quote_plates where id = p_plate_id;
  if not found then
    raise exception 'plate_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);
  if p_total is null or p_total < 0 or nullif(btrim(p_reason), '') is null then
    raise exception 'invalid_override' using errcode = '22023';
  end if;

  update public.quote_plates
  set override_total = p_total, override_reason = btrim(p_reason)
  where id = p_plate_id;
end;
$$;

create or replace function public.set_price_override(plate_id bigint, total numeric, reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_price_override($1, $2, $3);
$$;

create or replace function private.clear_price_override(p_plate_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
begin
  perform private.require_owner();
  select quote_id into v_quote_id from public.quote_plates where id = p_plate_id;
  if not found then
    raise exception 'plate_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);

  update public.quote_plates set override_total = null, override_reason = null where id = p_plate_id;
end;
$$;

create or replace function public.clear_price_override(plate_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.clear_price_override($1);
$$;

-- Send check
create or replace function private.get_quote_send_blockers(p_quote_id bigint)
returns table (quote_plate_id bigint, code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  if not exists (select 1 from public.quote_plates where quote_id = p_quote_id) then
    return query select null::bigint, 'no_plates'::text;
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
  select p.id, b.code
  from public.quote_plates p
  cross join lateral (
    select (p.printer_id is not null
            and p.print_time_s is not null
            and exists (select 1 from public.quote_plate_materials m where m.plate_id = p.id)) as complete
  ) c
  cross join lateral (
    values
      (case when not c.complete then 'plate_incomplete' end),
      (case when c.complete and p.plate_total is null then 'not_priced' end)
  ) as b (code)
  where p.quote_id = p_quote_id and b.code is not null
  order by p.id, b.code;
end;
$$;

create or replace function public.get_quote_send_blockers(quote_id bigint)
returns table (quote_plate_id bigint, code text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_quote_send_blockers($1);
$$;

-- Duplicate copy
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

-- Quotes list
create view public.quotes_list
with (security_invoker = true) as
select
  q.id, q.number, q.number_year, q.number_seq, q.status, q.client_id,
  c.name as client_name, c.company as client_company,
  q.valid_until, q.sent_at, q.created_at,
  (q.created_at at time zone 'Europe/Rome')::date as created_on,
  q.created_by, s.display_name as created_by_name,
  p.plate_count,
  case when p.plate_count > 0 and p.open_count = 0 then p.total + k.total end as total
from public.quotes q
join public.clients c on c.id = q.client_id
join public.staff s on s.user_id = q.created_by
cross join lateral (
  select
    count(*)::integer as plate_count,
    count(*) filter (
      where qp.plate_total is null
         or qp.printer_id is null
         or qp.print_time_s is null
         or not exists (select 1 from public.quote_plate_materials m where m.plate_id = qp.id)
    )::integer as open_count,
    sum(qp.plate_total) as total
  from public.quote_plates qp
  where qp.quote_id = q.id
) p
cross join lateral (
  select coalesce(sum(qc.line_total), 0) as total
  from public.quote_consumables qc
  where qc.quote_id = q.id
) k;

alter view public.quotes_list set (security_invoker = true);
revoke all on public.quotes_list from public, anon, authenticated;
grant select on public.quotes_list to authenticated;
grant all on public.quotes_list to service_role;

-- Grants, mirrored in supabase/schemas/90_grants.sql
revoke execute on function
  public.set_price_override(bigint, numeric, text), private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint), private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint), private.get_quote_send_blockers(bigint),
  public.service_copy_quote_plates(bigint, bigint), private.service_copy_quote_plates(bigint, bigint)
from public, anon, authenticated;
grant execute on function
  public.set_price_override(bigint, numeric, text), private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint), private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint), private.get_quote_send_blockers(bigint)
to authenticated;
grant execute on function
  public.service_copy_quote_plates(bigint, bigint), private.service_copy_quote_plates(bigint, bigint)
to service_role;
