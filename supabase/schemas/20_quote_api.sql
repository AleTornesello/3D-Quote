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

-- Owner overrides (draft quotes only). A markup change invalidates every plate's price.

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

create or replace function public.set_markup_override(quote_id bigint, pct numeric)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_markup_override($1, $2);
$$;

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

-- Send check: one row per problem; quote-level problems have a null plate id. Empty means the quote can be sent.
-- A plate is complete with a printer, a print time and at least one material; a complete plate needs a price.

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

create or replace function private.mark_quote_sent(p_quote_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.mark_quote_sent(quote_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_quote_sent($1);
$$;

-- add_quote_consumable: adds a line at the consumable's current price, or raises the quantity of the existing one.

create or replace function private.add_quote_consumable(p_quote_id bigint, p_consumable_id bigint, p_quantity integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.add_quote_consumable(quote_id bigint, consumable_id bigint, quantity integer)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.add_quote_consumable($1, $2, $3);
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

-- Plates: create_quote_plate, set_plate_printer, save_plate_material.

create or replace function private.create_quote_plate(p_quote_id bigint, p_description text, p_printer_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);
  if nullif(btrim(p_description), '') is null then
    raise exception 'invalid_description' using errcode = '22023';
  end if;
  perform private.require_active_catalog(p_printer_id, null);

  insert into public.quote_plates (quote_id, description, printer_id)
  values (p_quote_id, btrim(p_description), p_printer_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_quote_plate(
  quote_id bigint,
  description text,
  printer_id bigint default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_quote_plate($1, $2, $3);
$$;

create or replace function private.set_plate_printer(p_plate_id bigint, p_printer_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate public.quote_plates;
begin
  perform private.require_staff();
  select * into v_plate from public.quote_plates where id = p_plate_id;
  if not found then
    raise exception 'plate_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_plate.quote_id);

  if v_plate.printer_id is not distinct from p_printer_id then
    return;
  end if;
  perform private.require_active_catalog(p_printer_id, null);
  update public.quote_plates set printer_id = p_printer_id where id = p_plate_id;
end;
$$;

create or replace function public.set_plate_printer(plate_id bigint, printer_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_plate_printer($1, $2);
$$;

-- Adds the material to the plate, or sets the grams of the row it already has.
create or replace function private.save_plate_material(p_plate_id bigint, p_material_id bigint, p_grams numeric)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id bigint;
  v_id bigint;
begin
  perform private.require_staff();
  select quote_id into v_quote_id from public.quote_plates where id = p_plate_id;
  if not found then
    raise exception 'plate_not_found' using errcode = 'P0002';
  end if;
  perform private.require_draft_quote(v_quote_id);

  if p_grams is null or round(p_grams, 2) <= 0 then
    raise exception 'invalid_grams' using errcode = '22023';
  end if;

  select id into v_id from public.quote_plate_materials where plate_id = p_plate_id and material_id = p_material_id;
  if found then
    update public.quote_plate_materials set grams = p_grams where id = v_id;
  else
    perform private.require_active_catalog(null, p_material_id);
    insert into public.quote_plate_materials (plate_id, material_id, grams)
    values (p_plate_id, p_material_id, p_grams)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_plate_material(plate_id bigint, material_id bigint, grams numeric)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.save_plate_material($1, $2, $3);
$$;
