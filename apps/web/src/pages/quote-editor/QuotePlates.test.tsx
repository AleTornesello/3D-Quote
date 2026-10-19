import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import type { Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  materialRow,
  operatorStaff,
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
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderPlates(
  plates: Row[],
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
      quote_plates: plates,
      printers: [
        printerRow({ id: 11, name: 'MK4 #1' }),
        printerRow({ id: 12, name: 'MK3 #9', active: false }),
      ],
      materials: [
        materialRow({ id: 21, name: 'Prusament PLA', type: 'PLA', color: 'Black' }),
        materialRow({ id: 22, name: 'Prusament PETG', type: 'PETG', color: 'Galaxy' }),
        materialRow({ id: 23, name: 'Old TPU', type: 'TPU', color: null, active: false }),
      ],
    },
    rpc: {
      create_quote_plate: () => 99,
      set_plate_printer: () => null,
      save_plate_material: () => 1,
      set_price_override: () => null,
      clear_price_override: () => null,
      ...opts.rpc,
    },
  })
}

async function card(name = 'Piatto 1') {
  return screen.findByRole('article', { name })
}

const pla = (grams = 12, id = 51) => plateMaterialRow({ id, material_id: 21, grams })

test('an empty quote offers Add plate, which creates "Piatto 1"', async () => {
  const { db, user } = renderPlates([])
  expect(await screen.findByText('Aggiungi un piatto per iniziare.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Aggiungi piatto' }))
  await waitFor(() =>
    expect(db.rpcCalls('create_quote_plate')).toEqual([{ quote_id: 7, description: 'Piatto 1' }]),
  )
})

test('a new plate takes the printer of the newest plate while it is active', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, printer_id: 11 })])
  await card()
  await user.click(screen.getByRole('button', { name: 'Aggiungi piatto' }))
  await waitFor(() =>
    expect(db.rpcCalls('create_quote_plate')).toEqual([
      { quote_id: 7, description: 'Piatto 2', printer_id: 11 },
    ]),
  )
})

test('a new plate gets no printer when the newest one is inactive', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, printer_id: 12 })])
  await card()
  await user.click(screen.getByRole('button', { name: 'Aggiungi piatto' }))
  await waitFor(() =>
    expect(db.rpcCalls('create_quote_plate')).toEqual([{ quote_id: 7, description: 'Piatto 2' }]),
  )
})

test('an incomplete plate says what is missing and has no total', async () => {
  renderPlates([quotePlateRow({ id: 31 })])
  const plate = await card()
  expect(
    within(plate).getByText('Mancano: la stampante, il tempo di stampa, almeno un materiale.'),
  ).toBeInTheDocument()
  expect(within(plate).getByText('Nessun materiale.')).toBeInTheDocument()
  expect(within(plate).queryByText('Totale piatto')).not.toBeInTheDocument()
  expect(within(plate).queryByText('Calcolo del prezzo…')).not.toBeInTheDocument()
})

test('choosing a printer calls set_plate_printer; an inactive one stays shown', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, printer_id: 12 })])
  const plate = await card()
  await within(plate).findByRole('option', { name: 'MK3 #9 (disattivata)' })
  expect(within(plate).getByLabelText('Stampante')).toHaveValue('12')
  await user.selectOptions(within(plate).getByLabelText('Stampante'), 'MK4 #1')
  await waitFor(() =>
    expect(db.rpcCalls('set_plate_printer')).toEqual([{ plate_id: 31, printer_id: 11 }]),
  )
})

test('print time is typed as h:mm and saved in seconds', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, printer_id: 11 })])
  const plate = await card()
  const time = within(plate).getByLabelText('Tempo di stampa (h:mm)')
  await user.type(time, '2:30{Enter}')
  await waitFor(() =>
    expect(db.calls('quote_plates')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 31]],
      values: { print_time_s: 9000 },
    }),
  )
})

test.each(['0:00', '90', '1:75'])('print time %s is refused and not saved', async (text) => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, printer_id: 11 })])
  const plate = await card()
  await user.type(within(plate).getByLabelText('Tempo di stampa (h:mm)'), text)
  await user.tab()
  expect(
    await within(plate).findByText('Inserisci il tempo come ore:minuti, ad es. 2:30.'),
  ).toBeInTheDocument()
  expect(db.calls('quote_plates').filter((call) => call.op === 'update')).toEqual([])
})

test('quantity and description save to the plate; a blank description comes back', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, description: 'Staffe' })])
  const plate = await card('Staffe')
  const quantity = within(plate).getByLabelText('Copie')
  await user.clear(quantity)
  await user.type(quantity, '3')
  await user.tab()
  await waitFor(() =>
    expect(db.calls('quote_plates')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 31]],
      values: { quantity: 3 },
    }),
  )
  const description = within(plate).getByLabelText('Descrizione')
  await user.clear(description)
  await user.tab()
  expect(await within(plate).findByText('Campo obbligatorio.')).toBeInTheDocument()
  expect(description).toHaveValue('Staffe')
})

test('adding a material saves its grams, typed with a comma', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31 })])
  const plate = await card()
  await within(plate).findByRole('option', { name: 'Prusament PETG (PETG, Galaxy)' })
  await user.selectOptions(
    within(plate).getByLabelText('Aggiungi materiale'),
    'Prusament PETG (PETG, Galaxy)',
  )
  await user.type(within(plate).getByLabelText('Grammi'), '12,5')
  await user.click(within(plate).getByRole('button', { name: 'Aggiungi' }))
  await waitFor(() =>
    expect(db.rpcCalls('save_plate_material')).toEqual([
      { plate_id: 31, material_id: 22, grams: 12.5 },
    ]),
  )
})

test.each([
  ['0', 'Inserisci un peso in grammi maggiore di zero.'],
  ['', 'Campo obbligatorio.'],
  ['abc', 'Inserisci un numero.'],
])('grams "%s" show an error and save nothing', async (grams, message) => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31 })])
  const plate = await card()
  await within(plate).findByRole('option', { name: 'Prusament PETG (PETG, Galaxy)' })
  await user.selectOptions(
    within(plate).getByLabelText('Aggiungi materiale'),
    'Prusament PETG (PETG, Galaxy)',
  )
  if (grams) await user.type(within(plate).getByLabelText('Grammi'), grams)
  await user.click(within(plate).getByRole('button', { name: 'Aggiungi' }))
  expect(await within(plate).findByText(message)).toBeInTheDocument()
  expect(db.rpcCalls('save_plate_material')).toEqual([])
})

test('Add without a material asks for one', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31 })])
  const plate = await card()
  await user.type(within(plate).getByLabelText('Grammi'), '10')
  await user.click(within(plate).getByRole('button', { name: 'Aggiungi' }))
  expect(await within(plate).findByText('Scegli un materiale.')).toBeInTheDocument()
  expect(db.rpcCalls('save_plate_material')).toEqual([])
})

test('a material row edits its grams and can be removed; the picker skips used and inactive materials', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, materials: [pla(12, 51)] })])
  const plate = await card()
  const picker = within(plate).getByLabelText('Aggiungi materiale')
  await within(plate).findByRole('option', { name: 'Prusament PETG (PETG, Galaxy)' })
  expect(within(picker).queryByRole('option', { name: 'Prusament PLA (PLA, Black)' })).toBeNull()
  expect(within(picker).queryByRole('option', { name: /Old TPU/ })).toBeNull()

  const grams = within(plate).getByLabelText('Grammi di Prusament PLA (PLA, Black)')
  expect(grams).toHaveValue('12')
  await user.clear(grams)
  await user.type(grams, '20,25{Enter}')
  await waitFor(() =>
    expect(db.rpcCalls('save_plate_material')).toEqual([
      { plate_id: 31, material_id: 21, grams: 20.25 },
    ]),
  )

  await user.click(
    within(plate).getByRole('button', { name: 'Rimuovi Prusament PLA (PLA, Black)' }),
  )
  await waitFor(() =>
    expect(db.calls('quote_plate_materials')).toContainEqual({
      op: 'delete',
      filters: [['eq', 'id', 51]],
    }),
  )
})

const priced = {
  printer_id: 11,
  print_time_s: 19800,
  quantity: 2,
  material_cost: 3,
  machine_cost: 8.25,
  energy_cost: 0.198,
  failure_cost: 1.1448,
  setup_fee: 5,
  markup_amount: 9.0557,
  markup_pct: 30,
  computed_total: 39.24,
  plate_total: 39.24,
  priced_at: '2026-10-13T09:00:00Z',
  materials: [pla(120)],
}

test('a complete priced plate shows its total and breakdown', async () => {
  const { user } = renderPlates([quotePlateRow({ id: 31, ...priced })])
  const plate = await card()
  expect(within(plate).getAllByText('39,24 €').length).toBeGreaterThan(0)
  expect(within(plate).getByText('19,62 €')).toBeInTheDocument()
  await user.click(within(plate).getByText('Dettaglio prezzo'))
  expect(within(plate).getByText('Ricarico (30 %)')).toBeInTheDocument()
  expect(within(plate).queryByText(/Mancano/)).not.toBeInTheDocument()
})

test('owners override a plate price with a reason', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31, ...priced })])
  await user.click(within(await card()).getByRole('button', { name: 'Modifica prezzo' }))
  const dialog = await screen.findByRole('dialog', { name: 'Modifica il prezzo di Piatto 1' })
  const total = within(dialog).getByLabelText('Totale piatto')
  await user.clear(total)
  await user.type(total, '45')
  await user.type(within(dialog).getByLabelText('Motivo'), 'Accordo con il cliente')
  await user.click(within(dialog).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(db.rpcCalls('set_price_override')).toEqual([
      { plate_id: 31, total: 45, reason: 'Accordo con il cliente' },
    ]),
  )
})

test('operators see the price but cannot override it', async () => {
  renderPlates([quotePlateRow({ id: 31, ...priced })], { staff: operatorStaff })
  const plate = await card()
  expect(within(plate).getAllByText('39,24 €').length).toBeGreaterThan(0)
  expect(within(plate).queryByRole('button', { name: 'Modifica prezzo' })).not.toBeInTheDocument()
})

test('removing a plate deletes it', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31 })])
  await user.click(within(await card()).getByRole('button', { name: 'Rimuovi' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Rimuovere Piatto 1?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  await waitFor(() =>
    expect(db.calls('quote_plates')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 31]] }),
  )
})

test('a material added after the quote was sent elsewhere turns the page read-only', async () => {
  const { db, user } = renderPlates([quotePlateRow({ id: 31 })])
  const plate = await card()
  await within(plate).findByRole('option', { name: 'Prusament PETG (PETG, Galaxy)' })
  // Someone else sent the quote meanwhile.
  db.table('quotes')[0].status = 'sent'
  db.failNext('save_plate_material', { code: 'P0001', message: 'quote_not_draft' })
  await user.selectOptions(
    within(plate).getByLabelText('Aggiungi materiale'),
    'Prusament PETG (PETG, Galaxy)',
  )
  await user.type(within(plate).getByLabelText('Grammi'), '5')
  await user.click(within(plate).getByRole('button', { name: 'Aggiungi' }))
  await waitFor(() =>
    expect(within(plate).queryByLabelText('Aggiungi materiale')).not.toBeInTheDocument(),
  )
  expect(screen.getByText('Inviato')).toBeInTheDocument()
})

test('a sent quote shows its plates read-only', async () => {
  renderPlates([quotePlateRow({ id: 31, ...priced })], { status: 'sent' })
  const plate = await card()
  expect(await within(plate).findByText('MK4 #1')).toBeInTheDocument()
  expect(within(plate).getByText('5:30')).toBeInTheDocument()
  expect(await within(plate).findByText('Prusament PLA (PLA, Black)')).toBeInTheDocument()
  expect(within(plate).getByText('120 g')).toBeInTheDocument()
  expect(within(plate).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(plate).queryByRole('combobox')).not.toBeInTheDocument()
  expect(within(plate).queryByRole('button', { name: 'Rimuovi' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aggiungi piatto' })).not.toBeInTheDocument()
})

test('every control on a card is disabled while one of its saves is pending', async () => {
  let release: () => void = () => {}
  const held = new Promise<null>((resolve) => {
    release = () => resolve(null)
  })
  const { user } = renderPlates([quotePlateRow({ id: 31 })], {
    rpc: { set_plate_printer: () => held },
  })
  const plate = await card()
  await within(plate).findByRole('option', { name: 'MK4 #1' })
  await user.selectOptions(within(plate).getByLabelText('Stampante'), 'MK4 #1')
  await waitFor(() => expect(within(plate).getByLabelText('Descrizione')).toBeDisabled())
  expect(within(plate).getByLabelText('Copie')).toBeDisabled()
  expect(within(plate).getByRole('button', { name: 'Rimuovi' })).toBeDisabled()
  release()
  await waitFor(() => expect(within(plate).getByLabelText('Descrizione')).toBeEnabled())
})
