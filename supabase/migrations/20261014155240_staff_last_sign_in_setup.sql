-- Function privileges are not captured by the generated migration; list_staff was dropped and recreated.
revoke execute on function public.list_staff(), private.list_staff() from public, anon;
grant execute on function public.list_staff(), private.list_staff() to authenticated;
