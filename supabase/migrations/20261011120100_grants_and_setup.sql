-- Hand-written companion to the generated initial_schema migration. It holds what `supabase db diff` does not
-- capture from supabase/schemas/: default privileges, column privileges, data rows, the pgmq queue, storage
-- policies and the cron job. Keep docs/supabase/data-model.md in step with it.

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

-- Column-level write grants: authenticated may update only these columns.
grant update (display_name, language, role, active) on public.staff to authenticated;

grant update (
  currency, energy_price_kwh, failure_allowance_pct, setup_fee, default_markup_pct, minimum_item_price,
  quote_prefix, default_validity_days, pdf_terms_it, pdf_terms_en, shop_name, shop_address, shop_vat_number,
  shop_email, shop_phone, shop_logo_path
) on public.settings to authenticated;

-- The single settings row.
insert into public.settings (id) values (1);
