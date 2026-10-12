-- Function grants for the duplicate-quote service functions, mirrored in supabase/schemas/90_grants.sql. New
-- functions are executable by PUBLIC by default, so every grant is revoked before granting the service role.
revoke execute on function
  public.service_create_quote_copy(bigint, uuid),
  private.service_create_quote_copy(bigint, uuid),
  public.service_copy_quote_items(bigint, bigint, jsonb),
  private.service_copy_quote_items(bigint, bigint, jsonb)
from public, anon, authenticated;
grant execute on function
  public.service_create_quote_copy(bigint, uuid),
  private.service_create_quote_copy(bigint, uuid),
  public.service_copy_quote_items(bigint, bigint, jsonb),
  private.service_copy_quote_items(bigint, bigint, jsonb)
to service_role;
