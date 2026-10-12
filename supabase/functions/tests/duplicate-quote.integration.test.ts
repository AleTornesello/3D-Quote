import { assert, assertEquals, assertMatch, assertNotEquals } from './deps.ts'
import {
  adminClient,
  callFunction,
  createCatalog,
  createItem,
  createQuote,
  markSent,
  must,
  OPERATOR_EMAIL,
  OPERATOR_ID,
  preflight,
  signIn,
} from './helpers.ts'
import type { SupabaseClient } from '../_shared/supabase.ts'

interface QuoteRow {
  id: number
  number: string
  status: string
  client_id: number
  notes: string | null
  markup_override_pct: number | null
  created_by: string
}

interface CopiedItem {
  id: number
  model_path: string
  original_filename: string
  computed_total: number | null
  override_total: number | null
  override_reason: string | null
  print_time_s: number | null
  slicing_jobs: { status: string }[]
}

async function topLevelFolders(admin: SupabaseClient): Promise<string[]> {
  const entries = await must<{ name: string }[]>(
    admin.storage.from('models').list('', { limit: 10000 }),
  )
  return entries.map((entry) => entry.name).sort()
}

Deno.test('duplicates a sent quote into a new priced draft', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const sourceId = await createQuote(admin, clientId, {
    notes: 'Rush job',
    markup_override_pct: 12.5,
  })
  const sliced = await createItem(admin, sourceId, {
    printerId,
    materialId,
    sliced: true,
    override: { total: 50, reason: 'Agreed price' },
  })
  const waiting = await createItem(admin, sourceId, { printerId, materialId })
  const bare = await createItem(admin, sourceId)
  await markSent(admin, sourceId)

  const response = await callFunction(
    'duplicate-quote',
    { quote_id: sourceId },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 201)
  const newId = response.body.quote_id!
  const [source, copy] = await Promise.all(
    [sourceId, newId].map((id) =>
      must<QuoteRow>(admin.from('quotes').select('*').eq('id', id).single())
    ),
  )
  assertEquals(copy.status, 'draft')
  assertEquals(copy.client_id, clientId)
  assertEquals(copy.notes, 'Rush job')
  assertEquals(Number(copy.markup_override_pct), 12.5)
  assertEquals(copy.created_by, OPERATOR_ID)
  assertNotEquals(copy.number, source.number)

  const items = await must<CopiedItem[]>(
    admin.from('quote_items')
      .select(
        'id, model_path, original_filename, computed_total, override_total, override_reason, print_time_s, slicing_jobs(status)',
      )
      .eq('quote_id', newId)
      .order('id'),
  )
  assertEquals(items.length, 3)
  for (
    const [item, original] of items.map((item, i) => [item, [sliced, waiting, bare][i]] as const)
  ) {
    assertMatch(item.model_path, new RegExp(`^${newId}/[0-9a-f-]{36}/part\\.stl$`))
    assertNotEquals(item.model_path, original.model_path)
    await must(admin.storage.from('models').download(item.model_path))
  }
  // The sliced item keeps its results, override and a succeeded job, and is priced.
  assertEquals(items[0].print_time_s, 19800)
  assertEquals(Number(items[0].override_total), 50)
  assertEquals(items[0].override_reason, 'Agreed price')
  assertEquals(items[0].slicing_jobs.map((job) => job.status), ['succeeded'])
  assert(items[0].computed_total !== null)
  // The unsliced item is queued again; the bare one waits for printer and material.
  assertEquals(items[1].slicing_jobs.map((job) => job.status), ['queued'])
  assertEquals(items[1].computed_total, null)
  assertEquals(items[2].slicing_jobs, [])
})

Deno.test('cleans up when a file cannot be copied', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const sourceId = await createQuote(admin, clientId)
  await createItem(admin, sourceId, { printerId, materialId, sliced: true })
  const lost = await createItem(admin, sourceId, { printerId, materialId, sliced: true })
  await must(admin.storage.from('models').remove([lost.model_path]))
  const foldersBefore = await topLevelFolders(admin)

  const response = await callFunction(
    'duplicate-quote',
    { quote_id: sourceId },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 500)
  assertEquals(response.body, { code: 'duplicate_failed' })
  const quotes = await must<{ id: number }[]>(
    admin.from('quotes').select('id').eq('client_id', clientId),
  )
  assertEquals(quotes.map((quote) => quote.id), [sourceId])
  assertEquals(await topLevelFolders(admin), foldersBefore)
})

Deno.test('answers 404 for an unknown quote', async () => {
  const response = await callFunction(
    'duplicate-quote',
    { quote_id: 2147480000 },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 404)
  assertEquals(response.body, { code: 'quote_not_found' })
})

Deno.test('rejects callers without a session', async () => {
  const response = await callFunction('duplicate-quote', { quote_id: 1 })

  assertEquals(response.status, 401)
  assertEquals(response.body, { code: 'not_authenticated' })
})

Deno.test('answers the CORS preflight', async () => {
  const response = await preflight('duplicate-quote')

  assertEquals(response.status, 200)
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
})
