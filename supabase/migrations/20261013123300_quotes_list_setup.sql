-- The generated migration does not carry the view's security_invoker option: the caller's RLS must apply.
alter view public.quotes_list set (security_invoker = true);

-- Grants for the quotes_list view, mirrored in supabase/schemas/90_grants.sql (generated migrations carry none).
revoke all on public.quotes_list from public, anon, authenticated;
grant select on public.quotes_list to authenticated;
grant all on public.quotes_list to service_role;

-- Live slicing status in the quote editor. Realtime applies each table's select RLS to its subscribers. Publication
-- changes are not captured by the declarative schema, so they live only in migrations.
alter publication supabase_realtime add table public.quote_items, public.slicing_jobs;
