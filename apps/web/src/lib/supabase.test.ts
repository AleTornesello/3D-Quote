import { expect, test } from 'vitest'
import { getSupabaseClient } from './supabase'

const env = { url: 'https://x.supabase.co', publishableKey: 'pk' }

test('returns one client per configuration (StrictMode renders twice in dev)', () => {
  expect(getSupabaseClient(env)).toBe(getSupabaseClient({ ...env }))
})

test('creates a new client when the configuration changes', () => {
  expect(getSupabaseClient(env)).not.toBe(getSupabaseClient({ ...env, publishableKey: 'other' }))
})
