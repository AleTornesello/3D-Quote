-- Function grants for list_staff, mirrored in supabase/schemas/90_grants.sql. New functions in private are executable
-- by PUBLIC by default, so every grant is revoked before granting authenticated.
revoke execute on function public.list_staff(), private.list_staff() from public, anon, authenticated;
grant execute on function public.list_staff(), private.list_staff() to authenticated;
