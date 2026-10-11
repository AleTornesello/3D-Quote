import { expect, test } from 'vitest'
import { readEnv } from './env'

test('reads both variables', () => {
  expect(
    readEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'pk' }),
  ).toEqual({ ok: true, env: { url: 'https://x.supabase.co', publishableKey: 'pk' } })
})

test('treats a malformed URL as invalid instead of crashing later', () => {
  expect(
    readEnv({ VITE_SUPABASE_URL: 'your-project-url', VITE_SUPABASE_PUBLISHABLE_KEY: 'pk' }),
  ).toEqual({ ok: false, missing: ['VITE_SUPABASE_URL'] })
  expect(
    readEnv({ VITE_SUPABASE_URL: 'ftp://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'pk' }),
  ).toEqual({ ok: false, missing: ['VITE_SUPABASE_URL'] })
})

test('reports missing and empty variables', () => {
  expect(readEnv({ VITE_SUPABASE_URL: '  ' })).toEqual({
    ok: false,
    missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
  })
})
