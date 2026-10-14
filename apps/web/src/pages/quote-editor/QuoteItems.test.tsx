import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import type { Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  jobRow,
  materialRow,
  operatorStaff,
  printerRow,
  quoteItemRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderItems(
  items: Row[],
  opts: {
    status?: string
    staff?: Tables<'staff'>
    rpc?: Record<string, (args: unknown) => unknown>
  } = {},
) {
  return renderApp('/quotes/7', {
    session,
    staff: opts.staff,
    tables: {
      quotes: [
        quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status: opts.status ?? 'draft' }),
      ],
      clients: [clientRow({ id: 1 })],
      quote_items: items,
      printers: [
        printerRow({ id: 11, name: 'MK4 #1' }),
        printerRow({ id: 12, name: 'MK3 #9', active: false }),
      ],
      materials: [
        materialRow({ id: 21, name: 'Prusament PLA', type: 'PLA', color: 'Black' }),
        materialRow({ id: 22, name: 'Prusament PETG', type: 'PETG', color: 'Galaxy' }),
      ],
    },
    rpc: {
      update_quote_item_settings: () => null,
      retry_slicing: () => 99,
      set_price_override: () => null,
      clear_price_override: () => null,
      ...opts.rpc,
    },
  })
}

const sliced = { printer_id: 11, material_id: 21 }

async function card(name = 'Staffa') {
  return screen.findByRole('article', { name })
}

test('a select change saves all five slicing inputs', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  await within(item).findByRole('option', { name: 'Prusament PETG (PETG, Galaxy)' })
  await user.selectOptions(
    within(item).getByLabelText('Materiale'),
    'Prusament PETG (PETG, Galaxy)',
  )
  await waitFor(() =>
    expect(db.rpcCalls('update_quote_item_settings')).toEqual([
      {
        item_id: 31,
        printer_id: 11,
        material_id: 22,
        layer_height_mm: 0.2,
        infill_percent: 20,
        supports: false,
      },
    ]),
  )
})

test('keeps an inactive printer selected and sends it with other changes', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, printer_id: 12, material_id: 21 })])
  const item = await card()
  await within(item).findByRole('option', { name: 'MK3 #9 (disattivata)' })
  expect(within(item).getByLabelText('Stampante')).toHaveValue('12')
  await user.click(within(item).getByRole('switch', { name: 'Supporti' }))
  await waitFor(() =>
    expect(db.rpcCalls('update_quote_item_settings')).toEqual([
      {
        item_id: 31,
        printer_id: 12,
        material_id: 21,
        layer_height_mm: 0.2,
        infill_percent: 20,
        supports: true,
      },
    ]),
  )
})

test('Enter then blur saves the layer height once', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  const input = within(item).getByLabelText('Altezza layer (mm)')
  expect(input).toHaveValue('0,20')
  await user.clear(input)
  await user.type(input, '0,15{Enter}')
  await user.tab()
  await waitFor(() => expect(db.rpcCalls('update_quote_item_settings')).toHaveLength(1))
  expect(db.rpcCalls('update_quote_item_settings')[0]).toMatchObject({ layer_height_mm: 0.15 })
})

test('an invalid number shows its error and is not saved', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  const infill = within(item).getByLabelText('Riempimento (%)')
  await user.clear(infill)
  await user.type(infill, '150')
  await user.tab()
  expect(await within(item).findByText('Deve essere tra 0 e 100.')).toBeInTheDocument()
  expect(db.rpcCalls('update_quote_item_settings')).toEqual([])
})

test('quantity and description save to the item; a blank description comes back', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  const quantity = within(item).getByLabelText('Quantità')
  await user.clear(quantity)
  await user.type(quantity, '3')
  await user.tab()
  await waitFor(() =>
    expect(db.calls('quote_items')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 31]],
      values: { quantity: 3 },
    }),
  )

  const description = within(item).getByLabelText('Descrizione')
  await user.clear(description)
  await user.tab()
  expect(await within(item).findByText('Campo obbligatorio.')).toBeInTheDocument()
  expect(description).toHaveValue('Staffa')

  await user.clear(description)
  await user.type(description, 'Staffa grande{Enter}')
  await waitFor(() =>
    expect(db.calls('quote_items')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 31]],
      values: { description: 'Staffa grande' },
    }),
  )
})

test('shows each slicing state', async () => {
  const { db, user } = renderItems([
    quoteItemRow({ id: 41, description: 'Attesa' }),
    quoteItemRow({ id: 42, description: 'Coda', ...sliced, job: jobRow() }),
    quoteItemRow({
      id: 43,
      description: 'Lento',
      ...sliced,
      job: jobRow({ queued_at: '2026-10-13T09:45:00Z' }),
    }),
    quoteItemRow({
      id: 44,
      description: 'In corso',
      ...sliced,
      job: jobRow({ status: 'running', started_at: '2026-10-13T09:58:55Z' }),
    }),
    quoteItemRow({
      id: 45,
      description: 'Fatto',
      ...sliced,
      print_time_s: 19800,
      filament_g: 120,
      bbox_x_mm: 100,
      bbox_y_mm: 80,
      bbox_z_mm: 40,
      job: jobRow({ status: 'succeeded' }),
    }),
    quoteItemRow({
      id: 46,
      description: 'Fallito',
      ...sliced,
      job: jobRow({ status: 'failed', error: 'Model is not manifold' }),
    }),
  ])
  expect(within(await card('Attesa')).getByText('Scegli stampante e materiale')).toBeInTheDocument()
  expect(within(await card('Coda')).getByText('In attesa dello slicing')).toBeInTheDocument()
  expect(
    within(await card('Lento')).getByText('Lo slicing sta richiedendo più del solito'),
  ).toBeInTheDocument()
  expect(within(await card('In corso')).getByText('Slicing in corso… 1:05')).toBeInTheDocument()
  const done = await card('Fatto')
  expect(within(done).getByText('5:30')).toBeInTheDocument()
  expect(within(done).getByText('120 g')).toBeInTheDocument()
  expect(within(done).getByText('100 × 80 × 40 mm')).toBeInTheDocument()
  const failed = await card('Fallito')
  expect(within(failed).getByText('Slicing non riuscito')).toBeInTheDocument()
  expect(within(failed).getByText('Model is not manifold')).toBeInTheDocument()
  await user.click(within(failed).getByRole('button', { name: 'Riprova lo slicing' }))
  await waitFor(() => expect(db.rpcCalls('retry_slicing')).toEqual([{ item_id: 46 }]))
})

const priced = {
  ...sliced,
  quantity: 2,
  print_time_s: 19800,
  filament_g: 120,
  material_cost: 3,
  machine_cost: 8.25,
  energy_cost: 0.198,
  failure_cost: 1.1448,
  setup_fee: 5,
  markup_amount: 9.0557,
  markup_pct: 30,
  computed_total: 39.24,
  item_total: 39.24,
  priced_at: '2026-10-13T09:00:00Z',
  job: jobRow({ status: 'succeeded' }),
}

test('shows the price and its breakdown', async () => {
  const { user } = renderItems([quoteItemRow({ id: 31, ...priced })])
  const item = await card()
  expect(within(item).getAllByText('39,24 €').length).toBeGreaterThan(0)
  expect(within(item).getByText('19,62 €')).toBeInTheDocument()
  await user.click(within(item).getByText('Dettaglio prezzo'))
  expect(within(item).getByText('Ricarico (30 %)')).toBeInTheDocument()
  expect(within(item).getByText('9,06 €')).toBeInTheDocument()
  expect(within(item).getByText('Margine per stampe fallite')).toBeInTheDocument()
  expect(within(item).getByText('1,14 €')).toBeInTheDocument()
})

test('owners override a price with a reason', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...priced })])
  await user.click(within(await card()).getByRole('button', { name: 'Modifica prezzo' }))
  const dialog = await screen.findByRole('dialog', { name: 'Modifica il prezzo di Staffa' })
  const total = within(dialog).getByLabelText('Totale articolo')
  expect(total).toHaveValue('39,24')
  await user.clear(total)
  await user.type(total, '45')
  await user.type(within(dialog).getByLabelText('Motivo'), 'Accordo con il cliente')
  await user.click(within(dialog).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(db.rpcCalls('set_price_override')).toEqual([
      { item_id: 31, total: 45, reason: 'Accordo con il cliente' },
    ]),
  )
})

const overridden = {
  ...priced,
  override_total: 45,
  override_reason: 'Accordo',
  item_total: 45,
}

test('an override shows beside the computed price and owners can remove it', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...overridden })])
  const item = await card()
  expect(
    within(item).getByText('Prezzo modificato: 45,00 € (calcolato 39,24 €)'),
  ).toBeInTheDocument()
  expect(within(item).getByText('Motivo: Accordo')).toBeInTheDocument()
  await user.click(within(item).getByRole('button', { name: 'Ripristina prezzo calcolato' }))
  await waitFor(() => expect(db.rpcCalls('clear_price_override')).toEqual([{ item_id: 31 }]))
})

test('operators see an override but cannot change prices', async () => {
  renderItems([quoteItemRow({ id: 31, ...overridden })], { staff: operatorStaff })
  const item = await card()
  expect(within(item).getByText('Motivo: Accordo')).toBeInTheDocument()
  expect(within(item).queryByRole('button', { name: 'Modifica prezzo' })).not.toBeInTheDocument()
  expect(
    within(item).queryByRole('button', { name: 'Ripristina prezzo calcolato' }),
  ).not.toBeInTheDocument()
})

test('removing an item deletes it and its file', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  await user.click(within(await card()).getByRole('button', { name: 'Rimuovi' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Rimuovere Staffa?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  await waitFor(() =>
    expect(db.calls('quote_items')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 31]] }),
  )
  await waitFor(() =>
    expect(db.storageCalls('models')).toContainEqual({ op: 'remove', paths: ['7/u31/staffa.stl'] }),
  )
})

test('an edit on a quote that has left draft turns the page read-only', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  // Someone else sent the quote meanwhile.
  db.table('quotes')[0].status = 'sent'
  db.failNext('update_quote_item_settings', { code: 'P0001', message: 'quote_not_draft' })
  await user.click(within(item).getByRole('switch', { name: 'Supporti' }))
  expect(
    await screen.findByText('Il preventivo non è più una bozza e non si può modificare.'),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(within(item).queryByRole('switch', { name: 'Supporti' })).not.toBeInTheDocument(),
  )
  expect(screen.getByText('Inviato')).toBeInTheDocument()
})

test('a sent quote shows its items read-only', async () => {
  renderItems([quoteItemRow({ id: 31, ...priced })], { status: 'sent' })
  const item = await card()
  expect(await within(item).findByText('MK4 #1')).toBeInTheDocument()
  expect(within(item).getByText('Prusament PLA (PLA, Black)')).toBeInTheDocument()
  expect(within(item).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(item).queryByRole('combobox')).not.toBeInTheDocument()
  expect(within(item).queryByRole('switch')).not.toBeInTheDocument()
  expect(within(item).queryByRole('button', { name: 'Rimuovi' })).not.toBeInTheDocument()
})

function fakeTab() {
  return { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
}

test('Download opens a signed link in a tab opened within the click', async () => {
  const tab = fakeTab()
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  const { user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  await user.click(within(await card()).getByRole('button', { name: 'Scarica staffa.stl' }))
  await waitFor(() =>
    expect(tab.location.href).toBe('https://storage.test/models/7/u31/staffa.stl'),
  )
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(tab.opener).toBeNull()
})

test('a failed download link closes the tab and shows the error', async () => {
  const tab = fakeTab()
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  db.failNext('storage:models', { code: '', message: 'boom' })
  await user.click(within(item).getByRole('button', { name: 'Scarica staffa.stl' }))
  await waitFor(() => expect(tab.close).toHaveBeenCalled())
  expect(tab.location.href).toBe('')
  expect(await screen.findByText('Qualcosa è andato storto. Riprova.')).toBeInTheDocument()
})

test('every control on a card is disabled while one of its saves is pending', async () => {
  let release: () => void = () => {}
  const held = new Promise<null>((resolve) => {
    release = () => resolve(null)
  })
  const { user } = renderItems([quoteItemRow({ id: 31, ...sliced })], {
    rpc: { update_quote_item_settings: () => held },
  })
  const item = await card()
  await user.click(within(item).getByRole('switch', { name: 'Supporti' }))
  await waitFor(() => expect(within(item).getByLabelText('Descrizione')).toBeDisabled())
  expect(within(item).getByLabelText('Quantità')).toBeDisabled()
  expect(within(item).getByRole('button', { name: 'Rimuovi' })).toBeDisabled()
  release()
  await waitFor(() => expect(within(item).getByLabelText('Descrizione')).toBeEnabled())
  expect(within(item).getByLabelText('Quantità')).toBeEnabled()
  expect(within(item).getByRole('button', { name: 'Rimuovi' })).toBeEnabled()
})
