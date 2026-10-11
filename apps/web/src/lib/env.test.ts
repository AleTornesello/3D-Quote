import { expect, test } from 'vitest'
import { readEnv } from './env'

test('reads both variables', () => {
  expect(
    readEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'pk' }),
  ).toEqual({ ok: true, env: { url: 'https://x.supabase.co', publishableKey: 'pk' } })
})

test('reports missing and empty variables', () => {
  expect(readEnv({ VITE_SUPABASE_URL: '  ' })).toEqual({
    ok: false,
    missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
  })
})
