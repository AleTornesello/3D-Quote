-- The generated migration recreates quotes_list without its security_invoker option: the caller's RLS must apply.
alter view public.quotes_list set (security_invoker = true);
revoke all on public.quotes_list from public, anon, authenticated;
grant select on public.quotes_list to authenticated;
grant all on public.quotes_list to service_role;

-- Grants for the consumables tables and functions, mirrored in supabase/schemas/90_grants.sql (generated
-- migrations carry none). New tables get no privileges by default, so every grant is explicit.
revoke all on public.consumables, public.quote_consumables from public, anon, authenticated;
grant select on public.consumables, public.quote_consumables to authenticated;
grant insert, update, delete on public.consumables to authenticated;
grant delete on public.quote_consumables to authenticated;
-- Only the quantity of a line can be edited; the price is frozen.
grant update (quantity) on public.quote_consumables to authenticated;
grant all on public.consumables, public.quote_consumables to service_role;

revoke execute on function
  public.add_quote_consumable(bigint, bigint, integer),
  private.add_quote_consumable(bigint, bigint, integer)
from public, anon, authenticated;
grant execute on function
  public.add_quote_consumable(bigint, bigint, integer),
  private.add_quote_consumable(bigint, bigint, integer)
to authenticated;

-- Trigger functions in private get no default privileges revoke: take PUBLIC's execute away explicitly.
revoke execute on function
  private.quote_consumables_guard(),
  private.quotes_return_stock()
from public, anon, authenticated;
