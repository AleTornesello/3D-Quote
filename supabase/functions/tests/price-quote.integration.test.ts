import { assert, assertEquals } from './deps.ts'
import { Fraction } from '../_shared/pricing.ts'
import { loadPricingSnapshot, writePrices } from '../_shared/price-quote.ts'
import {
  adminClient,
  callFunction,
  createCatalog,
  createItem,
  createQuote,
  expectedPrice,
  markSent,
  must,
  OPERATOR_EMAIL,
  preflight,
  signIn,
} from './helpers.ts'

const COLUMNS =
  'id, material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct, computed_total, override_total, item_total, priced_at'

type Row = Record<string, string | number | null>

/** The stored breakdown as the decimal strings priceItem returns. */
function breakdown(row: Row) {
  const fixed = (value: string | number | null, places: number) =>
    value === null ? null : Fraction.fromDecimal(value).toFixed(places)
  return {
    material_cost: fixed(row.material_cost, 4),
    machine_cost: fixed(row.machine_cost, 4),
    energy_cost: fixed(row.energy_cost, 4),
    failure_cost: fixed(row.failure_cost, 4),
    setup_fee: fixed(row.setup_fee, 4),
    markup_amount: fixed(row.markup_amount, 4),
    markup_pct: fixed(row.markup_pct, 2),
    computed_total: fixed(row.computed_total, 2),
  }
}

Deno.test('prices sliced items, skips unsliced ones and keeps overrides', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  const sliced = await createItem(admin, quoteId, {
    printerId,
    materialId,
    quantity: 2,
    sliced: true,
  })
  const waiting = await createItem(admin, quoteId, { printerId, materialId })
  const overridden = await createItem(admin, quoteId, {
    printerId,
    materialId,
    sliced: true,
    override: { total: 50, reason: 'Agreed price' },
  })

  const response = await callFunction(
    'price-quote',
    { quote_id: quoteId },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 200)
  assertEquals(response.body, { priced: 2, skipped: 1 })
  const rows = await must<Row[]>(
    admin.from('quote_items').select(COLUMNS).eq('quote_id', quoteId).order('id'),
  )
  assertEquals(breakdown(rows[0]), await expectedPrice(admin, sliced))
  assert(rows[0].priced_at !== null)
  assertEquals(rows[1].computed_total, null)
  assertEquals(rows[1].priced_at, null)
  assertEquals(breakdown(rows[2]), await expectedPrice(admin, overridden))
  assertEquals(Number(rows[2].override_total), 50)
  assertEquals(Number(rows[2].item_total), 50)
  assertEquals(waiting.id, rows[1].id)
})

Deno.test('uses the quote markup override', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId, { markup_override_pct: 12.5 })
  const item = await createItem(admin, quoteId, { printerId, materialId, sliced: true })

  const response = await callFunction(
    'price-quote',
    { quote_id: quoteId },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 200)
  const row = await must<Row>(admin.from('quote_items').select(COLUMNS).eq('id', item.id).single())
  assertEquals(breakdown(row), await expectedPrice(admin, item, 12.5))
  assertEquals(breakdown(row).markup_pct, '12.50')
})

Deno.test('prices an item whose printer was deactivated', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  const item = await createItem(admin, quoteId, { printerId, materialId, sliced: true })
  await must(admin.from('printers').update({ active: false }).eq('id', printerId))

  const response = await callFunction(
    'price-quote',
    { quote_id: quoteId },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.body, { priced: 1, skipped: 0 })
  const row = await must<Row>(admin.from('quote_items').select(COLUMNS).eq('id', item.id).single())
  assertEquals(breakdown(row), await expectedPrice(admin, item))
})

Deno.test('answers an empty draft with nothing priced', async () => {
  const admin = await adminClient()
  const { clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)

  const response = await callFunction(
    'price-quote',
    { quote_id: quoteId },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 200)
  assertEquals(response.body, { priced: 0, skipped: 0 })
})

Deno.test('skips an item that changed after it was read', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  const item = await createItem(admin, quoteId, { printerId, materialId, sliced: true })

  const snapshot = await loadPricingSnapshot(admin, quoteId)
  await must(admin.from('quote_items').update({ quantity: 5 }).eq('id', item.id))
  const result = await writePrices(admin, snapshot)

  assertEquals(result, { priced: 0, skipped: 1 })
  const row = await must<Row>(admin.from('quote_items').select(COLUMNS).eq('id', item.id).single())
  assertEquals(row.computed_total, null)
})

Deno.test('a markup change while the quote is being read is not priced with the old markup', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  const item = await createItem(admin, quoteId, { printerId, materialId, sliced: true })
  let changed = false
  // Lands the owner's markup change right after the first read of the quote.
  const racing = await adminClient(async (input, init) => {
    const response = await fetch(input, init)
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!changed && url.pathname.endsWith('/rest/v1/quotes') && (init?.method ?? 'GET') === 'GET') {
      changed = true
      await must(admin.from('quotes').update({ markup_override_pct: 10 }).eq('id', quoteId))
      // As set_markup_override does: clearing every item's breakdown changes its updated_at.
      await must(admin.from('quote_items').update({ markup_pct: null }).eq('quote_id', quoteId))
    }
    return response
  })

  const result = await writePrices(racing, await loadPricingSnapshot(racing, quoteId))

  assert(changed)
  assertEquals(result, { priced: 0, skipped: 1 })
  const row = await must<Row>(admin.from('quote_items').select(COLUMNS).eq('id', item.id).single())
  assertEquals(row.computed_total, null)
})

Deno.test('refuses a quote that is not a draft', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  await createItem(admin, quoteId, { printerId, materialId, sliced: true })
  await markSent(admin, quoteId)

  const response = await callFunction(
    'price-quote',
    { quote_id: quoteId },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 409)
  assertEquals(response.body, { code: 'quote_not_draft' })
})

Deno.test('answers 404 for an unknown quote', async () => {
  const response = await callFunction(
    'price-quote',
    { quote_id: 2147480000 },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 404)
  assertEquals(response.body, { code: 'quote_not_found' })
})

Deno.test('rejects bad requests', async () => {
  const token = await signIn(OPERATOR_EMAIL)
  for (const body of ['not json', '{"quote_id":"7"}', '{"quote_id":0}', '{"quote_id":1.5}', '{}']) {
    const response = await callFunction('price-quote', body, token)
    assertEquals(response.status, 400, body)
    assertEquals(response.body, { code: 'invalid_request' }, body)
  }
})

Deno.test('rejects callers without a valid session', async () => {
  for (const token of [undefined, 'not-a-jwt']) {
    const response = await callFunction('price-quote', { quote_id: 1 }, token)
    assertEquals(response.status, 401)
    assertEquals(response.body, { code: 'not_authenticated' })
    assertEquals(response.headers.get('access-control-allow-origin'), '*')
  }
})

Deno.test('rejects signed-in users without an active staff row', async () => {
  const admin = await adminClient()
  const email = `nostaff-${crypto.randomUUID().slice(0, 8)}@test.local`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
  })
  if (error) throw error
  try {
    const response = await callFunction('price-quote', { quote_id: 1 }, await signIn(email))
    assertEquals(response.status, 403)
    assertEquals(response.body, { code: 'not_staff' })
  } finally {
    await admin.auth.admin.deleteUser(data.user.id)
  }
})

Deno.test('answers the CORS preflight', async () => {
  const response = await preflight('price-quote')

  assertEquals(response.status, 200)
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
  assert(response.headers.get('access-control-allow-headers')?.includes('authorization'))
  assert(response.headers.get('access-control-allow-methods')?.includes('POST'))
})
