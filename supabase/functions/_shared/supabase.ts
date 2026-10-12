// The one place supabase-js is imported, so its version is pinned once.
export { createClient } from 'npm:@supabase/supabase-js@2.117.3'
export type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
export { corsHeaders as supabaseCorsHeaders } from 'npm:@supabase/supabase-js@2.117.3/cors'
export {
  AuthApiError,
  AuthRetryableFetchError,
  isAuthApiError,
} from 'npm:@supabase/supabase-js@2.117.3'
