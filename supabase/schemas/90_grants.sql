-- Data API exposure is explicit (Supabase Data API change, 2026). anon gets nothing; authenticated reads every
-- public table (RLS decides which rows) and writes only what is granted here or, column by column, in the
-- grants_and_setup migration. Functions run only where granted below. Keep this file last.

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- staff
grant insert on public.staff to authenticated;
grant execute on function private.is_staff(), private.is_owner() to authenticated;
grant execute on function public.list_staff(), private.list_staff() to authenticated;

-- printers, materials, clients
grant insert, update, delete on public.printers, public.materials, public.clients to authenticated;

-- quotes (insert and update are column grants in the grants_and_setup migration). The quotes_list view gets the
-- select above like every relation in public; its grants are repeated in the quotes_list_setup migration.
grant delete on public.quotes to authenticated;

-- overrides, send check and outcomes
grant execute on function
  public.set_markup_override(bigint, numeric),
  private.set_markup_override(bigint, numeric),
  public.set_price_override(bigint, numeric, text),
  private.set_price_override(bigint, numeric, text),
  public.clear_price_override(bigint),
  private.clear_price_override(bigint),
  public.get_quote_send_blockers(bigint),
  private.get_quote_send_blockers(bigint),
  public.mark_quote_sent(bigint),
  private.mark_quote_sent(bigint),
  public.mark_quote_accepted(bigint),
  private.mark_quote_accepted(bigint),
  public.mark_quote_rejected(bigint),
  private.mark_quote_rejected(bigint)
to authenticated;

-- duplicate-quote service functions: service role only
grant execute on function
  public.service_create_quote_copy(bigint, uuid),
  private.service_create_quote_copy(bigint, uuid),
  public.service_copy_quote_plates(bigint, bigint),
  private.service_copy_quote_plates(bigint, bigint)
to service_role;

-- storage policy helper
grant execute on function private.can_upload_model(text), private.can_change_model(text) to authenticated;


-- consumables (the quote_consumables update is a column grant in the consumables_setup migration)
grant insert, update, delete on public.consumables to authenticated;
grant delete on public.quote_consumables to authenticated;

grant execute on function
  public.add_quote_consumable(bigint, bigint, integer),
  private.add_quote_consumable(bigint, bigint, integer)
to authenticated;

-- plates (the column updates are column grants in the quote_plates migration)
grant delete on public.quote_plates, public.quote_plate_materials to authenticated;

grant execute on function
  public.create_quote_plate(bigint, text, bigint),
  private.create_quote_plate(bigint, text, bigint),
  public.set_plate_printer(bigint, bigint),
  private.set_plate_printer(bigint, bigint),
  public.save_plate_material(bigint, bigint, numeric),
  private.save_plate_material(bigint, bigint, numeric)
to authenticated;
