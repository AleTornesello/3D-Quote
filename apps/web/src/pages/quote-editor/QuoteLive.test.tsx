import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { FakeDb, FunctionHandler, Row } from '@/test/fake-db'
import type { Tables } from '@/lib/database.types'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  materialRow,
  plateMaterialRow,
  printerRow,
  quotePlateRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function renderLive(
  plates: Row[],
  opts: {
    status?: string
    quote?: Partial<Tables<'quotes'>>
    functions?: Record<string, FunctionHandler>
  } = {},
) {
  return renderApp('/quotes/7', {
    session,
    tables: {
      quotes: [
        quoteRow({
          id: 7,
          number: 'Q-2026-0007',
          client_id: 1,
          status: opts.status ?? 'draft',
          ...opts.quote,
        }),
      ],
      clients: [clientRow({ id: 1 })],
      quote_plates: plates,
      printers: [printerRow({ id: 11 })],
      materials: [materialRow({ id: 21, name: 'Prusament PLA', type: 'PLA', color: 'Black' })],
    },
    functions: opts.functions,
  })
}

const material = (id = 51) => [plateMaterialRow({ id, material_id: 21, grams: 120 })]
/** Printer and print time, but no material yet. */
const waiting = { printer_id: 11, print_time_s: 19800 }
const complete = { ...waiting, materials: material() }
const priced = {
  ...complete,
  computed_total: 39.24,
  plate_total: 39.24,
  priced_at: '2026-10-13T09:00:00Z',
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const noPricing = { 'price-quote': () => ({ data: { priced: 0, skipped: 0 } }) }
const gramsLabel = 'Grammi di Prusament PLA (PLA, Black)'

test("subscribes to the quote's plates and their materials", async () => {
  const { realtime } = renderLive([quotePlateRow({ id: 31, ...waiting })])
  await screen.findByRole('article', { name: 'Piatto 1' })
  await waitFor(() => expect(realtime.filters('quote_plates')).toEqual(['quote_id=eq.7']))
  expect(realtime.filters('quote_plate_materials')).toEqual([undefined])
})

test('a material change refetches the plates after 250 ms', async () => {
  const { db, realtime } = renderLive([quotePlateRow({ id: 31, ...waiting })], {
    functions: noPricing,
  })
  const plate = await screen.findByRole('article', { name: 'Piatto 1' })
  expect(within(plate).getByText('Mancano: almeno un materiale.')).toBeInTheDocument()
  db.table('quote_plates')[0].materials = material()
  await realtime.emit('quote_plate_materials')
  await pause(100)
  expect(within(plate).queryByLabelText(gramsLabel)).not.toBeInTheDocument()
  expect(await within(plate).findByLabelText(gramsLabel)).toHaveValue('120')
})

test('refetches after reconnecting, to catch changes missed meanwhile', async () => {
  const { db, realtime } = renderLive([quotePlateRow({ id: 31, ...waiting })], {
    functions: noPricing,
  })
  const plate = await screen.findByRole('article', { name: 'Piatto 1' })
  await waitFor(() => expect(realtime.filters('quote_plates')).toEqual(['quote_id=eq.7']))
  db.table('quote_plates')[0].materials = material()
  await realtime.reconnect()
  expect(await within(plate).findByLabelText(gramsLabel)).toBeInTheDocument()
})

test('leaving the page closes the channel', async () => {
  const { user, realtime } = renderLive([quotePlateRow({ id: 31, ...waiting })])
  await screen.findByRole('article', { name: 'Piatto 1' })
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })
  await user.click(within(nav).getByRole('link', { name: 'Clienti' }))
  await waitFor(() => expect(realtime.channels).toHaveLength(0))
})

test('prices complete plates once and shows the price', async () => {
  const held: { db?: FakeDb } = {}
  const rendered = renderLive([quotePlateRow({ id: 31, ...complete })], {
    functions: {
      'price-quote': () => {
        Object.assign(held.db!.table('quote_plates')[0], {
          computed_total: 39.24,
          plate_total: 39.24,
          priced_at: '2026-10-13T10:00:00Z',
          updated_at: '2026-10-13T10:00:00Z',
        })
        return { data: { priced: 1, skipped: 0 } }
      },
    },
  })
  const db = rendered.db
  held.db = db
  const plate = await screen.findByRole('article', { name: 'Piatto 1' })
  expect((await within(plate).findAllByText('39,24 €')).length).toBeGreaterThan(0)
  expect(db.functionCalls('price-quote')).toEqual([{ quote_id: 7 }])
})

test('an incomplete plate is never sent for pricing', async () => {
  const { db } = renderLive([quotePlateRow({ id: 31, ...waiting })], { functions: noPricing })
  await screen.findByRole('article', { name: 'Piatto 1' })
  await pause(100)
  expect(db.functionCalls('price-quote')).toEqual([])
})

test('gives up after one retry and says so', async () => {
  const { db } = renderLive([quotePlateRow({ id: 31, ...complete })], {
    functions: { 'price-quote': () => ({ data: { priced: 0, skipped: 1 } }) },
  })
  const plate = await screen.findByRole('article', { name: 'Piatto 1' })
  expect(await within(plate).findByText('Prezzo non calcolato')).toBeInTheDocument()
  expect(db.functionCalls('price-quote')).toHaveLength(2)
  await pause(300)
  expect(db.functionCalls('price-quote')).toHaveLength(2)
})

test('Recalculate prices calls price-quote even when everything is priced', async () => {
  const { db, user } = renderLive([quotePlateRow({ id: 31, ...priced })], {
    functions: { 'price-quote': () => ({ data: { priced: 1, skipped: 0 } }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Ricalcola prezzi' }))
  await waitFor(() => expect(db.functionCalls('price-quote')).toHaveLength(1))
})

test('the total shows net, VAT and gross', async () => {
  renderLive([
    quotePlateRow({ id: 31, ...priced }),
    quotePlateRow({
      id: 32,
      description: 'Perno',
      ...priced,
      materials: material(52),
      computed_total: 10.5,
      plate_total: 10.5,
    }),
  ])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(await within(total).findByText(/49,74/)).toBeInTheDocument()
  expect(within(total).getByText('Imponibile')).toBeInTheDocument()
  expect(within(total).getByText('IVA (22 %)')).toBeInTheDocument()
  expect(within(total).getByText(/10,94/)).toBeInTheDocument()
  expect(within(total).getByText('Totale IVA inclusa')).toBeInTheDocument()
  expect(within(total).getByText(/60,68/)).toBeInTheDocument()
})

test('the total lines are — while a plate is incomplete, even with an override', async () => {
  renderLive([
    quotePlateRow({ id: 31, ...priced }),
    quotePlateRow({
      id: 32,
      description: 'Perno',
      override_total: 5,
      override_reason: 'Accordo',
      plate_total: 5,
    }),
  ])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(within(total).getAllByText('—')).toHaveLength(3)
})

test('a sent quote shows its frozen VAT rate, not the shop’s', async () => {
  renderLive([quotePlateRow({ id: 31, ...priced, plate_total: 100, computed_total: 100 })], {
    quote: { status: 'sent', sent_at: '2026-10-12T08:00:00Z', vat_rate_pct: 10 },
  })
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(await within(total).findByText('IVA (10 %)')).toBeInTheDocument()
  expect(within(total).getByText(/110,00/)).toBeInTheDocument()
})

test('a failed pricing call offers Retry', async () => {
  const { db, user } = renderLive([quotePlateRow({ id: 31, ...complete })], {
    functions: { 'price-quote': () => ({ network: true }) },
  })
  expect(
    await screen.findByText(
      'Impossibile contattare il server. Controlla la connessione e riprova.',
    ),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  await waitFor(() => expect(db.functionCalls('price-quote')).toHaveLength(2))
})

test('a sent quote is never priced automatically', async () => {
  const { db } = renderLive([quotePlateRow({ id: 31, ...complete })], {
    status: 'sent',
    functions: noPricing,
  })
  await screen.findByRole('article', { name: 'Piatto 1' })
  await pause(100)
  expect(db.functionCalls('price-quote')).toEqual([])
  expect(screen.queryByRole('button', { name: 'Ricalcola prezzi' })).not.toBeInTheDocument()
})

const pricedFields = {
  computed_total: 39.24,
  plate_total: 39.24,
  priced_at: '2026-10-13T10:00:00Z',
  updated_at: '2026-10-13T10:00:00Z',
}

test('a partial result retries once and stops, even when the answer is slow', async () => {
  const held: { db?: FakeDb } = {}
  let calls = 0
  const { db } = renderLive(
    [
      quotePlateRow({ id: 31, ...complete }),
      quotePlateRow({ id: 32, description: 'Perno', ...complete, materials: material(52) }),
    ],
    {
      functions: {
        'price-quote': async () => {
          calls += 1
          await pause(50)
          if (calls === 1) {
            Object.assign(held.db!.table('quote_plates')[0], pricedFields)
            return { data: { priced: 1, skipped: 1 } }
          }
          return { data: { priced: 0, skipped: 1 } }
        },
      },
    },
  )
  held.db = db
  const bolt = await screen.findByRole('article', { name: 'Perno' })
  expect(await within(bolt).findByText('Prezzo non calcolato')).toBeInTheDocument()
  expect(
    (
      await within(await screen.findByRole('article', { name: 'Piatto 1' })).findAllByText(
        '39,24 €',
      )
    ).length,
  ).toBeGreaterThan(0)
  await pause(400)
  expect(db.functionCalls('price-quote')).toHaveLength(2)
})

test('a trigger during a call queues exactly one more', async () => {
  const held: { db?: FakeDb } = {}
  const { db, realtime } = renderLive(
    [
      quotePlateRow({ id: 31, ...complete }),
      quotePlateRow({ id: 32, description: 'Perno', ...waiting }),
    ],
    {
      functions: {
        'price-quote': async () => {
          // Prices what is complete and unpriced when the call starts, like the real function's snapshot.
          const todo = held
            .db!.table('quote_plates')
            .filter((row) => (row.materials as unknown[]).length > 0 && row.priced_at === null)
          await pause(500)
          for (const row of todo) Object.assign(row, pricedFields)
          return { data: { priced: todo.length, skipped: 0 } }
        },
      },
    },
  )
  held.db = db
  await screen.findByRole('article', { name: 'Piatto 1' })
  await waitFor(() => expect(db.functionCalls('price-quote')).toHaveLength(1))
  // The second plate gets its material while the first call is running.
  Object.assign(db.table('quote_plates')[1], {
    materials: material(52),
    updated_at: '2026-10-13T10:00:01Z',
  })
  await realtime.emit('quote_plate_materials')
  const bolt = await screen.findByRole('article', { name: 'Perno' })
  expect((await within(bolt).findAllByText('39,24 €')).length).toBeGreaterThan(0)
  await pause(400)
  expect(db.functionCalls('price-quote')).toHaveLength(2)
})
