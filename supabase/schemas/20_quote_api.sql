-- Functions behind the web app's actions. Each public function is a thin security-invoker wrapper around a
-- security-definer function in the non-exposed private schema, which checks the caller first. Errors use the
-- stable messages listed in docs/supabase/data-model.md.

-- Internal helpers: security invoker, called only from the security-definer functions below.

create or replace function private.require_staff()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'not_staff' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_owner()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'owner_required' using errcode = '42501';
  end if;
end;
$$;

-- Locks the quote for the rest of the transaction, so a concurrent send waits for this change and vice versa.
create or replace function private.require_draft_quote(p_quote_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'quote_not_draft';
  end if;
end;
$$;

-- Null ids are skipped, so callers pass only the printer/material they are changing.
create or replace function private.require_active_catalog(p_printer_id bigint, p_material_id bigint)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_printer_id is not null
     and not exists (select 1 from public.printers where id = p_printer_id and active) then
    raise exception 'printer_inactive' using errcode = '22023';
  end if;
  if p_material_id is not null
     and not exists (select 1 from public.materials where id = p_material_id and active) then
    raise exception 'material_inactive' using errcode = '22023';
  end if;
end;
$$;

-- Inserts a queued job and sends its message in the caller's transaction. Message format:
-- docs/services/slicer-worker.md#job-message-proposed.
create or replace function private.enqueue_slicing_job(p_item_id bigint)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_item public.quote_items;
  v_job_id bigint;
begin
  select * into strict v_item from public.quote_items where id = p_item_id;

  insert into public.slicing_jobs (quote_item_id) values (p_item_id) returning id into v_job_id;

  perform pgmq.send(
    'slicing_jobs',
    jsonb_build_object(
      'job_id', v_job_id,
      'quote_item_id', v_item.id,
      'model_path', v_item.model_path,
      'printer_id', v_item.printer_id,
      'material_id', v_item.material_id,
      'settings', jsonb_build_object(
        'layer_height_mm', v_item.layer_height_mm,
        'infill_percent', v_item.infill_percent,
        'supports', v_item.supports
      )
    )
  );
  return v_job_id;
end;
$$;

-- create_quote_item: the model must already be uploaded to models/<quote_id>/…

create or replace function private.create_quote_item(
  p_quote_id bigint,
  p_model_path text,
  p_original_filename text,
  p_description text,
  p_printer_id bigint,
  p_material_id bigint,
  p_quantity integer,
  p_layer_height_mm numeric,
  p_infill_percent integer,
  p_supports boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id bigint;
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);

  if p_model_path is null or split_part(p_model_path, '/', 1) <> p_quote_id::text then
    raise exception 'invalid_model_path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'models' and name = p_model_path) then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;
  perform private.require_active_catalog(p_printer_id, p_material_id);

  insert into public.quote_items (
    quote_id, model_path, original_filename, description, printer_id, material_id,
    quantity, layer_height_mm, infill_percent, supports
  ) values (
    p_quote_id, p_model_path, p_original_filename, p_description, p_printer_id, p_material_id,
    coalesce(p_quantity, 1), coalesce(p_layer_height_mm, 0.20), coalesce(p_infill_percent, 20),
    coalesce(p_supports, false)
  )
  returning id into v_item_id;

  if p_printer_id is not null and p_material_id is not null then
    perform private.enqueue_slicing_job(v_item_id);
  end if;
  return v_item_id;
end;
$$;

create or replace function public.create_quote_item(
  quote_id bigint,
  model_path text,
  original_filename text,
  description text,
  printer_id bigint default null,
  material_id bigint default null,
  quantity integer default 1,
  layer_height_mm numeric default 0.20,
  infill_percent integer default 20,
  supports boolean default false
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_quote_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
$$;

-- update_quote_item_settings: replaces all slicing inputs; any change discards results and price (the override
-- stays) and slices again when printer and material are set.

create or replace function private.update_quote_item_settings(
  p_item_id bigint,
  p_printer_id bigint,
  p_material_id bigint,
  p_layer_height_mm numeric,
  p_infill_percent integer,
  p_supports boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.quote_items;
begin
  perform private.require_staff();
  select * into v_item from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_item.quote_id);
  select * into v_item from public.quote_items where id = p_item_id for update;

  if v_item.printer_id is not distinct from p_printer_id
     and v_item.material_id is not distinct from p_material_id
     and v_item.layer_height_mm is not distinct from p_layer_height_mm
     and v_item.infill_percent is not distinct from p_infill_percent
     and v_item.supports is not distinct from p_supports then
    return;
  end if;

  perform private.require_active_catalog(
    case when p_printer_id is distinct from v_item.printer_id then p_printer_id end,
    case when p_material_id is distinct from v_item.material_id then p_material_id end
  );

  update public.quote_items set
    printer_id = p_printer_id,
    material_id = p_material_id,
    layer_height_mm = p_layer_height_mm,
    infill_percent = p_infill_percent,
    supports = p_supports,
    print_time_s = null,
    filament_g = null,
    bbox_x_mm = null,
    bbox_y_mm = null,
    bbox_z_mm = null,
    material_cost = null,
    machine_cost = null,
    energy_cost = null,
    failure_cost = null,
    setup_fee = null,
    markup_amount = null,
    markup_pct = null,
    computed_total = null,
    priced_at = null
  where id = p_item_id;

  if p_printer_id is not null and p_material_id is not null then
    perform private.enqueue_slicing_job(p_item_id);
  end if;
end;
$$;

create or replace function public.update_quote_item_settings(
  item_id bigint,
  printer_id bigint,
  material_id bigint,
  layer_height_mm numeric,
  infill_percent integer,
  supports boolean
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_quote_item_settings($1, $2, $3, $4, $5, $6);
$$;

-- retry_slicing: only after the item's latest job failed.

create or replace function private.retry_slicing(p_item_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.quote_items;
  v_last_status text;
begin
  perform private.require_staff();
  select * into v_item from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_item.quote_id);

  select status into v_last_status
  from public.slicing_jobs
  where quote_item_id = p_item_id
  order by id desc
  limit 1;

  if v_last_status is distinct from 'failed' or v_item.printer_id is null or v_item.material_id is null then
    raise exception 'retry_not_allowed';
  end if;
  return private.enqueue_slicing_job(p_item_id);
end;
$$;

create or replace function public.retry_slicing(item_id bigint)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.retry_slicing($1);
$$;

-- Owner overrides (draft quotes only). A markup change invalidates every item's price.

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
  update public.quote_items set
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

create or replace function public.set_markup_override(quote_id bigint, pct numeric)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_markup_override($1, $2);
$$;

create or replace function private.set_price_override(p_item_id bigint, p_total numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
begin
  perform private.require_owner();
  select quote_id into v_quote_id from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);
  if p_total is null or p_total < 0 or nullif(btrim(p_reason), '') is null then
    raise exception 'invalid_override' using errcode = '22023';
  end if;

  update public.quote_items
  set override_total = p_total, override_reason = btrim(p_reason)
  where id = p_item_id;
end;
$$;

create or replace function public.set_price_override(item_id bigint, total numeric, reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_price_override($1, $2, $3);
$$;

create or replace function private.clear_price_override(p_item_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
begin
  perform private.require_owner();
  select quote_id into v_quote_id from public.quote_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);

  update public.quote_items set override_total = null, override_reason = null where id = p_item_id;
end;
$$;

create or replace function public.clear_price_override(item_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.clear_price_override($1);
$$;

-- Send check: one row per problem; quote-level problems have a null item id. Empty means the quote can be sent.

create or replace function private.get_quote_send_blockers(p_quote_id bigint)
returns table (quote_item_id bigint, code text)
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
$$;

create or replace function public.get_quote_send_blockers(quote_id bigint)
returns table (quote_item_id bigint, code text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_quote_send_blockers($1);
$$;

create or replace function private.mark_quote_sent(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);
  if exists (select 1 from private.get_quote_send_blockers(p_quote_id)) then
    raise exception 'quote_not_sendable';
  end if;
  update public.quotes
  set status = 'sent',
      sent_at = now(),
      vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
  where id = p_quote_id;
end;
$$;

create or replace function public.mark_quote_sent(quote_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_quote_sent($1);
$$;

-- Accepted / rejected: only from sent. Internal helper shared by the two functions below.
create or replace function private.mark_quote_outcome(p_quote_id bigint, p_status text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.require_staff();
  select status into v_status from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'sent' then
    raise exception 'quote_not_sent';
  end if;
  update public.quotes set status = p_status where id = p_quote_id;
end;
$$;

create or replace function private.mark_quote_accepted(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_quote_outcome(p_quote_id, 'accepted');
end;
$$;

create or replace function public.mark_quote_accepted(quote_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_quote_accepted($1);
$$;

create or replace function private.mark_quote_rejected(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_quote_outcome(p_quote_id, 'rejected');
end;
$$;

create or replace function public.mark_quote_rejected(quote_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_quote_rejected($1);
$$;

-- Daily job (pg_cron, see the grants_and_setup migration): sent quotes past their validity become expired.
create or replace function private.expire_quotes()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.quotes set status = 'expired'
  where status = 'sent' and valid_until < private.shop_today();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Storage upload rule for the models bucket: the first folder must be the id of a draft quote.
create or replace function private.can_upload_model(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if not private.is_staff() or v_folder !~ '^[0-9]{1,18}$' then
    return false;
  end if;
  return exists (select 1 from public.quotes where id = v_folder::bigint and status = 'draft');
end;
$$;

-- Storage rule for changing or removing a models object: staff, and the object is not in the folder of a quote that
-- has left draft (those files back a sent quote). Folders of deleted quotes stay removable.
create or replace function private.can_change_model(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if not private.is_staff() then
    return false;
  end if;
  if v_folder !~ '^[0-9]{1,18}$' then
    return true;
  end if;
  return not exists (select 1 from public.quotes where id = v_folder::bigint and status <> 'draft');
end;
$$;
