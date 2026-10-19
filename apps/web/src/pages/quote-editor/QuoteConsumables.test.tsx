import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  consumableRow,
  plateMaterialRow,
  quoteConsumableRow,
  quotePlateRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

function renderEditor(
  lines: Row[],
  status = 'draft',
  rpc: Record<string, (args: unknown) => unknown> = {},
) {
  return renderApp('/quotes/7', {
    session,
    tables: {
      quotes: [quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status })],
      clients: [clientRow({ id: 1 })],
      quote_plates: [
        quotePlateRow({
          id: 31,
          printer_id: 11,
          print_time_s: 3600,
          materials: [plateMaterialRow({ material_id: 21 })],
          computed_total: 10,
          plate_total: 10,
          priced_at: '2026-10-13T09:00:00Z',
        }),
      ],
      consumables: [
        consumableRow({ id: 1, name: 'Vite M3', unit: 'pz', unit_price: 0.1, stock: 10 }),
        consumableRow({ id: 2, name: 'Inserto M3', unit: 'pz', unit_price: 0.5, stock: 2 }),
        consumableRow({ id: 3, name: 'Dado vecchio', active: false }),
      ],
      quote_consumables: lines,
    },
    rpc: { add_quote_consumable: () => 1, ...rpc },
  })
}

const line = (overrides: Parameters<typeof quoteConsumableRow>[0]) =>
  quoteConsumableRow({ id: 51, consumable_id: 1, ...overrides })

test('lists the lines and adds their total to the quote total', async () => {
  renderEditor([line({ quantity: 3 })])
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  expect(await within(card).findByText('Vite M3')).toBeInTheDocument()
  expect(within(card).getByText('0,30 €')).toBeInTheDocument()
  // 10,00 € of plates + 0,30 € of consumables
  expect(await screen.findByText('10,30 €')).toBeInTheDocument()
})

test('adds a consumable with a quantity; inactive ones are not offered', async () => {
  const { db, user } = renderEditor([])
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  await within(card).findByRole('option', { name: 'Inserto M3' })
  expect(within(card).queryByRole('option', { name: /Dado vecchio/ })).not.toBeInTheDocument()
  await user.selectOptions(within(card).getByLabelText('Aggiungi consumabile'), 'Inserto M3')
  const newQuantity = within(card).getByLabelText('Quantità')
  await user.clear(newQuantity)
  await user.type(newQuantity, '2')
  await user.click(within(card).getByRole('button', { name: 'Aggiungi' }))
  await waitFor(() =>
    expect(db.rpcCalls('add_quote_consumable')).toEqual([
      { quote_id: 7, consumable_id: 2, quantity: 2 },
    ]),
  )
})

test('changing a quantity saves it; zero is refused', async () => {
  const { db, user } = renderEditor([line({ quantity: 3 })])
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  const quantity = await within(card).findByLabelText('Quantità', {
    selector: '#consumable-51-quantity',
  })
  await user.clear(quantity)
  await user.type(quantity, '0')
  await user.tab()
  expect(
    await within(card).findByText('Inserisci un numero intero maggiore di zero.'),
  ).toBeInTheDocument()
  await user.clear(quantity)
  await user.type(quantity, '5')
  await user.tab()
  await waitFor(() =>
    expect(db.calls('quote_consumables')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 51]],
      values: { quantity: 5 },
    }),
  )
})

test('warns when a line asks for more than the stock', async () => {
  renderEditor([
    line({
      id: 52,
      consumable_id: 2,
      quantity: 5,
      consumable: { name: 'Inserto M3', unit: 'pz', stock: 2 },
    }),
  ])
  expect(await screen.findByText('Disponibili solo 2 pz.')).toBeInTheDocument()
})

test('removes a line', async () => {
  const { db, user } = renderEditor([line({ quantity: 3 })])
  await user.click(await screen.findByRole('button', { name: 'Rimuovi Vite M3' }))
  await waitFor(() =>
    expect(db.calls('quote_consumables')).toContainEqual({
      op: 'delete',
      filters: [['eq', 'id', 51]],
    }),
  )
})

test('a sent quote shows the lines read-only, without a warning', async () => {
  renderEditor(
    [line({ quantity: 5, consumable: { name: 'Vite M3', unit: 'pz', stock: 1 } })],
    'sent',
  )
  const card = await screen.findByRole('region', { name: 'Consumabili' })
  expect(await within(card).findByText('Vite M3')).toBeInTheDocument()
  expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  expect(within(card).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(card).queryByText(/Disponibili solo/)).not.toBeInTheDocument()
})

test('a sent quote without lines shows no card', async () => {
  renderEditor([], 'sent')
  await screen.findByText('Q-2026-0007')
  expect(screen.queryByRole('region', { name: 'Consumabili' })).not.toBeInTheDocument()
})

const selects = (db: { calls: (table: string) => { op: string }[] }, table: string) =>
  db.calls(table).filter((call) => call.op === 'select').length

test('sending the quote reloads the consumables, whose stock it consumed', async () => {
  const { db, user } = renderEditor([line({ quantity: 3 })], 'draft', {
    get_quote_send_blockers: () => [],
    mark_quote_sent: () => null,
  })
  await screen.findByRole('region', { name: 'Consumabili' })
  await waitFor(() => expect(selects(db, 'consumables')).toBeGreaterThan(0))
  const before = selects(db, 'consumables')
  await user.click(screen.getByRole('button', { name: 'Segna come inviato' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(await within(dialog).findByRole('button', { name: 'Segna come inviato' }))
  await waitFor(() => expect(db.rpcCalls('mark_quote_sent')).toHaveLength(1))
  await waitFor(() => expect(selects(db, 'consumables')).toBeGreaterThan(before))
})

test('a stock shortage in the send dialog reloads the lines so their warning shows', async () => {
  const { db, user } = renderEditor([line({ quantity: 3 })], 'draft', {
    get_quote_send_blockers: () => [{ quote_plate_id: null, code: 'insufficient_stock' }],
  })
  await screen.findByRole('region', { name: 'Consumabili' })
  await waitFor(() => expect(selects(db, 'quote_consumables')).toBeGreaterThan(0))
  const before = selects(db, 'quote_consumables')
  await user.click(screen.getByRole('button', { name: 'Segna come inviato' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(
    await within(dialog).findByText('Alcuni consumabili superano la quantità disponibile.'),
  ).toBeInTheDocument()
  await waitFor(() => expect(selects(db, 'quote_consumables')).toBeGreaterThan(before))
})
