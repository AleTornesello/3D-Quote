export type SupabaseEnv = { url: string; publishableKey: string }
export type EnvResult = { ok: true; env: SupabaseEnv } | { ok: false; missing: string[] }

function value(source: Record<string, unknown>, name: string): string | null {
  const raw = source[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

/** Reads the Supabase settings from Vite env; empty strings count as missing. */
export function readEnv(source: Record<string, unknown>): EnvResult {
  const url = value(source, 'VITE_SUPABASE_URL')
  const publishableKey = value(source, 'VITE_SUPABASE_PUBLISHABLE_KEY')
  if (url && publishableKey) return { ok: true, env: { url, publishableKey } }
  const missing: string[] = []
  if (!url) missing.push('VITE_SUPABASE_URL')
  if (!publishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  return { ok: false, missing }
}
