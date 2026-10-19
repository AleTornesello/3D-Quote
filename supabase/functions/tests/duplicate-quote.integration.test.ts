import { assert, assertEquals, assertNotEquals, assertRejects } from './deps.ts'
import { duplicateQuote } from '../duplicate-quote/duplicate.ts'
import { HttpError } from '../_shared/http.ts'
import {
  adminClient,
  callFunction,
  completePlate,
  createCatalog,
  createPlate,
  createQuote,
  markSent,
  must,
  OPERATOR_EMAIL,
  OPERATOR_ID,
  preflight,
  signIn,
} from './helpers.ts'

interface QuoteRow {
  id: number
  number: string
  status: string
  client_id: number
  notes: string | null
  markup_override_pct: number | null
  created_by: string
}

interface CopiedPlate {
  description: string
  printer_id: number | null
  print_time_s: number | null
  quantity: number
  computed_total: number | null
  override_total: number | null
  override_reason: string | null
  materials: { material_id: number; grams: number }[]
}

const COPIED =
  'description, printer_id, print_time_s, quantity, computed_total, override_total, override_reason, materials:quote_plate_materials(material_id, grams)'

Deno.test('duplicates a sent quote into a new priced draft', async () => {
  const admin = await adminClient()
  const catalog = await createCatalog(admin)
  const sourceId = await createQuote(admin, catalog.clientId, {
    notes: 'Rush job',
    markup_override_pct: 12.5,
  })
  await createPlate(
    admin,
    sourceId,
    completePlate(catalog, { quantity: 3, override: { total: 50, reason: 'Agreed price' } }),
  )
  await createPlate(admin, sourceId, completePlate(catalog))
  await createPlate(admin, sourceId, { printerId: catalog.printerId })
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
  assertEquals(copy.client_id, catalog.clientId)
  assertEquals(copy.notes, 'Rush job')
  assertEquals(Number(copy.markup_override_pct), 12.5)
  assertEquals(copy.created_by, OPERATOR_ID)
  assertNotEquals(copy.number, source.number)

  const [sourcePlates, plates] = await Promise.all(
    [sourceId, newId].map((id) =>
      must<CopiedPlate[]>(admin.from('quote_plates').select(COPIED).eq('quote_id', id).order('id'))
    ),
  )
  const inputs = (rows: CopiedPlate[]) =>
    rows.map(({ computed_total: _, ...rest }) => ({
      ...rest,
      override_total: rest.override_total === null ? null : Number(rest.override_total),
      materials: rest.materials.map((m) => ({
        material_id: m.material_id,
        grams: Number(m.grams),
      })),
    }))
  assertEquals(plates.length, 3)
  assertEquals(inputs(plates), inputs(sourcePlates))
  // The complete plates are priced; the incomplete one waits for its print time and materials.
  assert(plates[0].computed_total !== null)
  assert(plates[1].computed_total !== null)
  assertEquals(plates[2].computed_total, null)
})

Deno.test('copies without touching storage', async () => {
  const requests: string[] = []
  const admin = await adminClient()
  const recording = await adminClient((input, init) => {
    requests.push(new URL(input instanceof Request ? input.url : String(input)).pathname)
    return fetch(input, init)
  })
  const catalog = await createCatalog(admin)
  const sourceId = await createQuote(admin, catalog.clientId)
  await createPlate(admin, sourceId, completePlate(catalog))

  await duplicateQuote(recording, sourceId, OPERATOR_ID)

  assert(requests.some((path) => path.endsWith('/rpc/service_copy_quote_plates')))
  assertEquals(requests.filter((path) => path.includes('/storage/')), [])
})

Deno.test('deletes the new draft when the plates cannot be copied', async () => {
  const admin = await adminClient()
  const failing = await adminClient((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/rpc/service_copy_quote_plates')) {
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'XX000', message: 'itest failure' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return fetch(input, init)
  })
  const catalog = await createCatalog(admin)
  const sourceId = await createQuote(admin, catalog.clientId)
  await createPlate(admin, sourceId, completePlate(catalog))

  const error = await assertRejects(() => duplicateQuote(failing, sourceId, OPERATOR_ID), HttpError)
  assertEquals(error.code, 'duplicate_failed')
  const quotes = await must<{ id: number }[]>(
    admin.from('quotes').select('id').eq('client_id', catalog.clientId),
  )
  assertEquals(quotes.map((quote) => quote.id), [sourceId])
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
