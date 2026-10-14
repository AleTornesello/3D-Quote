import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { FakeDb, FunctionHandler, Row } from '@/test/fake-db'
import type { Tables } from '@/lib/database.types'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, jobRow, materialRow, printerRow, quoteItemRow, quoteRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function renderLive(
  items: Row[],
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
      quote_items: items,
      printers: [printerRow({ id: 11 })],
      materials: [materialRow({ id: 21 })],
    },
    functions: opts.functions,
  })
}

const queued = { printer_id: 11, material_id: 21, job: jobRow() }
const results = {
  print_time_s: 19800,
  filament_g: 120,
  bbox_x_mm: 10,
  bbox_y_mm: 10,
  bbox_z_mm: 10,
}
const sliced = {
  printer_id: 11,
  material_id: 21,
  ...results,
  job: jobRow({ status: 'succeeded' }),
}
const priced = {
  ...sliced,
  computed_total: 39.24,
  item_total: 39.24,
  priced_at: '2026-10-13T09:00:00Z',
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const noPricing = { 'price-quote': () => ({ data: { priced: 0, skipped: 0 } }) }

test("subscribes to the quote's items and their jobs", async () => {
  const { realtime } = renderLive([
    quoteItemRow({ id: 31, ...queued }),
    quoteItemRow({ id: 32, description: 'Perno', ...queued }),
  ])
  await screen.findByRole('article', { name: 'Staffa' })
  await waitFor(() =>
    expect(realtime.filters('slicing_jobs')).toEqual(['quote_item_id=in.(31,32)']),
  )
  expect(realtime.filters('quote_items')).toEqual(['quote_id=eq.7'])
})

test('a change refetches the items', async () => {
  const { db, realtime } = renderLive([quoteItemRow({ id: 31, ...queued })], {
    functions: noPricing,
  })
  const item = await screen.findByRole('article', { name: 'Staffa' })
  expect(within(item).getByText('In attesa dello slicing')).toBeInTheDocument()
  Object.assign(db.table('quote_items')[0], { ...results, job: [jobRow({ status: 'succeeded' })] })
  await realtime.emit('slicing_jobs')
  expect(await within(item).findByText('5:30')).toBeInTheDocument()
})

test('refetches after reconnecting, to catch changes missed meanwhile', async () => {
  const { db, realtime } = renderLive([quoteItemRow({ id: 31, ...queued })], {
    functions: noPricing,
  })
  const item = await screen.findByRole('article', { name: 'Staffa' })
  await waitFor(() => expect(realtime.filters('slicing_jobs')).toEqual(['quote_item_id=in.(31)']))
  Object.assign(db.table('quote_items')[0], { ...results, job: [jobRow({ status: 'succeeded' })] })
  await realtime.reconnect()
  expect(await within(item).findByText('5:30')).toBeInTheDocument()
})

test('a channel rebuilt for new items refetches once subscribed, to catch changes made meanwhile', async () => {
  const { db, realtime, queryClient } = renderLive([quoteItemRow({ id: 31, ...queued })], {
    functions: noPricing,
  })
  const item = await screen.findByRole('article', { name: 'Staffa' })
  await waitFor(() => expect(realtime.filters('slicing_jobs')).toEqual(['quote_item_id=in.(31)']))

  // A second item arrives: the channel is rebuilt for both ids, and its subscription takes a while.
  realtime.hold()
  db.table('quote_items').push(quoteItemRow({ id: 32, description: 'Perno', ...queued }))
  await act(() => queryClient.invalidateQueries({ queryKey: ['quotes', 'items', 7] }))
  await waitFor(() =>
    expect(realtime.filters('slicing_jobs')).toEqual(['quote_item_id=in.(31,32)']),
  )
  // The first item finishes in the gap: nobody is subscribed to hear it.
  Object.assign(db.table('quote_items')[0], { ...results, job: [jobRow({ status: 'succeeded' })] })
  await realtime.emit('slicing_jobs')
  await pause(300)
  expect(within(item).getByText('In attesa dello slicing')).toBeInTheDocument()

  await realtime.release()
  expect(await within(item).findByText('5:30')).toBeInTheDocument()
})

test('leaving the page closes the channel', async () => {
  const { user, realtime } = renderLive([quoteItemRow({ id: 31, ...queued })])
  await screen.findByRole('article', { name: 'Staffa' })
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })
  await user.click(within(nav).getByRole('link', { name: 'Clienti' }))
  await waitFor(() => expect(realtime.channels).toHaveLength(0))
})

test('prices sliced items once and shows the price', async () => {
  const held: { db?: FakeDb } = {}
  const rendered = renderLive([quoteItemRow({ id: 31, ...sliced })], {
    functions: {
      'price-quote': () => {
        Object.assign(held.db!.table('quote_items')[0], {
          computed_total: 39.24,
          item_total: 39.24,
          priced_at: '2026-10-13T10:00:00Z',
          updated_at: '2026-10-13T10:00:00Z',
        })
        return { data: { priced: 1, skipped: 0 } }
      },
    },
  })
  const db = rendered.db
  held.db = db
  const item = await screen.findByRole('article', { name: 'Staffa' })
  expect((await within(item).findAllByText('39,24 €')).length).toBeGreaterThan(0)
  expect(db.functionCalls('price-quote')).toEqual([{ quote_id: 7 }])
})

test('gives up after one retry and says so', async () => {
  const { db } = renderLive([quoteItemRow({ id: 31, ...sliced })], {
    functions: { 'price-quote': () => ({ data: { priced: 0, skipped: 1 } }) },
  })
  const item = await screen.findByRole('article', { name: 'Staffa' })
  expect(await within(item).findByText('Prezzo non calcolato')).toBeInTheDocument()
  expect(db.functionCalls('price-quote')).toHaveLength(2)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(db.functionCalls('price-quote')).toHaveLength(2)
})

test('Recalculate prices calls price-quote even when everything is priced', async () => {
  const { db, user } = renderLive([quoteItemRow({ id: 31, ...priced })], {
    functions: { 'price-quote': () => ({ data: { priced: 1, skipped: 0 } }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Ricalcola prezzi' }))
  await waitFor(() => expect(db.functionCalls('price-quote')).toHaveLength(1))
})

test('the total shows net, VAT and gross', async () => {
  renderLive([
    quoteItemRow({ id: 31, ...priced }),
    quoteItemRow({
      id: 32,
      description: 'Perno',
      ...priced,
      computed_total: 10.5,
      item_total: 10.5,
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

test('the total lines are — while an item has no price', async () => {
  renderLive([quoteItemRow({ id: 31, ...priced }), quoteItemRow({ id: 32, description: 'Perno' })])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(within(total).getAllByText('—')).toHaveLength(3)
})

test('a sent quote shows its frozen VAT rate, not the shop’s', async () => {
  renderLive([quoteItemRow({ id: 31, ...priced, item_total: 100, computed_total: 100 })], {
    quote: { status: 'sent', sent_at: '2026-10-12T08:00:00Z', vat_rate_pct: 10 },
  })
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(await within(total).findByText('IVA (10 %)')).toBeInTheDocument()
  expect(within(total).getByText(/110,00/)).toBeInTheDocument()
})

test('a failed pricing call offers Retry', async () => {
  const { db, user } = renderLive([quoteItemRow({ id: 31, ...sliced })], {
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
  const { db } = renderLive([quoteItemRow({ id: 31, ...sliced })], {
    status: 'sent',
    functions: noPricing,
  })
  await screen.findByRole('article', { name: 'Staffa' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(db.functionCalls('price-quote')).toEqual([])
  expect(screen.queryByRole('button', { name: 'Ricalcola prezzi' })).not.toBeInTheDocument()
})

const pricedFields = {
  computed_total: 39.24,
  item_total: 39.24,
  priced_at: '2026-10-13T10:00:00Z',
  updated_at: '2026-10-13T10:00:00Z',
}

test('a partial result retries once and stops, even when the answer is slow', async () => {
  const held: { db?: FakeDb } = {}
  let calls = 0
  const { db } = renderLive(
    [
      quoteItemRow({ id: 31, ...sliced }),
      quoteItemRow({ id: 32, description: 'Perno', ...sliced }),
    ],
    {
      functions: {
        'price-quote': async () => {
          calls += 1
          await pause(50)
          if (calls === 1) {
            Object.assign(held.db!.table('quote_items')[0], pricedFields)
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
    (await within(await screen.findByRole('article', { name: 'Staffa' })).findAllByText('39,24 €'))
      .length,
  ).toBeGreaterThan(0)
  await pause(400)
  expect(db.functionCalls('price-quote')).toHaveLength(2)
})

test('a trigger during a call queues exactly one more', async () => {
  const held: { db?: FakeDb } = {}
  const { db, realtime } = renderLive(
    [
      quoteItemRow({ id: 31, ...sliced }),
      quoteItemRow({ id: 32, description: 'Perno', ...queued }),
    ],
    {
      functions: {
        'price-quote': async () => {
          // Prices what is unpriced when the call starts, like the real function's snapshot.
          const todo = held
            .db!.table('quote_items')
            .filter((row) => row.print_time_s !== null && row.priced_at === null)
          await pause(500)
          for (const row of todo) Object.assign(row, pricedFields)
          return { data: { priced: todo.length, skipped: 0 } }
        },
      },
    },
  )
  held.db = db
  await screen.findByRole('article', { name: 'Staffa' })
  await waitFor(() => expect(db.functionCalls('price-quote')).toHaveLength(1))
  Object.assign(db.table('quote_items')[1], { ...results, job: [jobRow({ status: 'succeeded' })] })
  await realtime.emit('slicing_jobs')
  const bolt = await screen.findByRole('article', { name: 'Perno' })
  expect((await within(bolt).findAllByText('39,24 €')).length).toBeGreaterThan(0)
  await pause(400)
  expect(db.functionCalls('price-quote')).toHaveLength(2)
})
