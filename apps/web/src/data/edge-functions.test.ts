import { expect, test } from 'vitest'
import { FakeDb } from '@/test/fake-db'
import { createFakeSupabase } from '@/test/fake-supabase'
import { invokeFunction } from './edge-functions'
import { AppError } from './errors'

function client(handlers: ConstructorParameters<typeof FakeDb>[2]) {
  return createFakeSupabase({ db: new FakeDb({}, {}, handlers) })
}

test('returns the data and records the call', async () => {
  const { client: supabase, db } = client({
    'price-quote': () => ({ data: { priced: 2, skipped: 0 } }),
  })
  await expect(invokeFunction(supabase, 'price-quote', { quote_id: 7 })).resolves.toEqual({
    priced: 2,
    skipped: 0,
  })
  expect(db.functionCalls('price-quote')).toEqual([{ quote_id: 7 }])
})

test('an error response becomes the AppError for its code', async () => {
  const { client: supabase } = client({
    'duplicate-quote': () => ({ status: 409, code: 'quote_not_draft' }),
  })
  const error = await invokeFunction(supabase, 'duplicate-quote', { quote_id: 7 }).catch((e) => e)
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({ kind: 'notDraft' })
})

test('a response without a code is unknown', async () => {
  const { client: supabase } = client({ 'price-quote': () => ({ status: 502, code: '' }) })
  await expect(invokeFunction(supabase, 'price-quote', { quote_id: 7 })).rejects.toMatchObject({
    kind: 'unknown',
  })
})

test('a request that never arrives is a network error', async () => {
  const { client: supabase } = client({ 'price-quote': () => ({ network: true }) })
  await expect(invokeFunction(supabase, 'price-quote', { quote_id: 7 })).rejects.toMatchObject({
    kind: 'network',
  })
})
