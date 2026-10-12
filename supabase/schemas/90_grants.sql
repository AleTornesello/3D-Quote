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

-- quotes (insert and update are column grants in the grants_and_setup migration)
grant delete on public.quotes to authenticated;

-- quote_items (update is a column grant in the grants_and_setup migration)
grant delete on public.quote_items to authenticated;

-- item functions
grant execute on function
  public.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  private.create_quote_item(bigint, text, text, text, bigint, bigint, integer, numeric, integer, boolean),
  public.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  private.update_quote_item_settings(bigint, bigint, bigint, numeric, integer, boolean),
  public.retry_slicing(bigint),
  private.retry_slicing(bigint)
to authenticated;

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

-- worker functions: service role only
grant execute on function
  public.worker_claim_job(integer, integer),
  private.worker_claim_job(integer, integer),
  public.worker_complete_job(bigint, bigint, jsonb),
  private.worker_complete_job(bigint, bigint, jsonb),
  public.worker_fail_job(bigint, bigint, text, boolean),
  private.worker_fail_job(bigint, bigint, text, boolean)
to service_role;

-- storage policy helper
grant execute on function private.can_upload_model(text), private.can_change_model(text) to authenticated;
