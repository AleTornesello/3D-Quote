export type SupabaseEnv = { url: string; publishableKey: string }
export type EnvResult = { ok: true; env: SupabaseEnv } | { ok: false; missing: string[] }

function value(source: Record<string, unknown>, name: string): string | null {
  const raw = source[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

function isHttpUrl(text: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol)
  } catch {
    return false
  }
}

/** Reads the Supabase settings from Vite env; empty values and non-http(s) URLs count as missing. */
export function readEnv(source: Record<string, unknown>): EnvResult {
  const rawUrl = value(source, 'VITE_SUPABASE_URL')
  const url = rawUrl && isHttpUrl(rawUrl) ? rawUrl : null
  const publishableKey = value(source, 'VITE_SUPABASE_PUBLISHABLE_KEY')
  if (url && publishableKey) return { ok: true, env: { url, publishableKey } }
  const missing: string[] = []
  if (!url) missing.push('VITE_SUPABASE_URL')
  if (!publishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  return { ok: false, missing }
}
