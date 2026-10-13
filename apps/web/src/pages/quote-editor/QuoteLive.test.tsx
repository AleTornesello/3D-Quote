import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { FakeDb, FunctionHandler, Row } from '@/test/fake-db'
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
  opts: { status?: string; functions?: Record<string, FunctionHandler> } = {},
) {
  return renderApp('/quotes/7', {
    session,
    tables: {
      quotes: [
        quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status: opts.status ?? 'draft' }),
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

test('the total sums the item totals', async () => {
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
  expect(await within(total).findByText('49,74 €')).toBeInTheDocument()
  expect(within(total).getByText('Prezzi IVA esclusa.')).toBeInTheDocument()
})

test('the total is — while an item has no price', async () => {
  renderLive([quoteItemRow({ id: 31, ...priced }), quoteItemRow({ id: 32, description: 'Perno' })])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(within(total).getByText('—')).toBeInTheDocument()
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
