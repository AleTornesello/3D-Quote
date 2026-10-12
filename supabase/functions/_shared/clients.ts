import { createClient, type SupabaseClient } from './supabase.ts'

// The new secret key when the runtime provides it, the legacy service_role key otherwise.
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    const key = JSON.parse(keys).default
    if (typeof key === 'string' && key !== '') return key
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  throw new Error('No service key in the environment')
}

/** A client that bypasses RLS. Use it only after requireStaff(). */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('SUPABASE_URL is not set')
  return createClient(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
