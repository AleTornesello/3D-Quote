-- Hand-written companion to the generated initial_schema migration. It holds what `supabase db diff` does not
-- capture from supabase/schemas/: default privileges, function and column privileges, data rows (the settings row
-- and the storage buckets), the pgmq queue and the cron job. Keep docs/supabase/data-model.md in step with it.

-- New objects in public are not exposed to the Data API until granted.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated;

-- Table and function grants. A copy of supabase/schemas/90_grants.sql, which mirrors them so `supabase db diff`
-- stays empty: migra diffs table grants but not function grants, and the tables above were created with the
-- default privileges, so the effective grants are applied here. Change both files together.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- staff
grant insert on public.staff to authenticated;
grant execute on function private.is_staff(), private.is_owner() to authenticated;

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

-- Column-level write grants: authenticated may update only these columns.
grant update (display_name, language, role, active) on public.staff to authenticated;

grant update (
  currency, energy_price_kwh, failure_allowance_pct, setup_fee, default_markup_pct, minimum_item_price,
  quote_prefix, default_validity_days, pdf_terms_it, pdf_terms_en, shop_name, shop_address, shop_vat_number,
  shop_email, shop_phone, shop_logo_path
) on public.settings to authenticated;

grant insert (client_id, valid_until, notes), update (client_id, valid_until, notes)
  on public.quotes to authenticated;

grant update (description, quantity) on public.quote_items to authenticated;

-- The single settings row.
insert into public.settings (id) values (1);

-- Slicing queue (Supabase Queues / pgmq).
select pgmq.create('slicing_jobs');

-- Storage buckets. models: STL/3MF types vary between browsers, so only the size is limited.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('models', 'models', false, 104857600, null),
  ('branding', 'branding', false, 1048576, array['image/png', 'image/jpeg', 'image/svg+xml']);

-- Daily at 00:15 UTC: sent quotes past their validity (Europe/Rome date) become expired.
select cron.schedule('expire-quotes', '15 0 * * *', 'select private.expire_quotes()');
