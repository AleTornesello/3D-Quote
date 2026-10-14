import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import type { FunctionHandler, Row } from '@/test/fake-db'
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
afterEach(() => vi.useRealTimers())

function renderEditor(
  opts: {
    quote?: Partial<Tables<'quotes'>>
    items?: Row[]
    staff?: Tables<'staff'>
    rpc?: Record<string, (args: unknown) => unknown>
    functions?: Record<string, FunctionHandler>
  } = {},
) {
  return renderApp('/quotes/7', {
    session,
    staff: opts.staff,
    tables: {
      quotes: [quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, ...opts.quote })],
      clients: [clientRow({ id: 1, name: 'Mario Rossi', company: 'Rossi Meccanica' })],
      quote_items: opts.items ?? [],
      printers: [printerRow({ id: 11, name: 'MK4 #1' })],
      materials: [materialRow({ id: 21 })],
    },
    rpc: opts.rpc,
    functions: opts.functions,
  })
}

async function heading() {
  return screen.findByRole('heading', { level: 1, name: 'Q-2026-0007' })
}

test('shows the header with the markup in effect', async () => {
  renderEditor()
  await heading()
  expect(screen.getByText('Bozza')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Mario Rossi (Rossi Meccanica)' })).toHaveAttribute(
    'href',
    '/clients/1',
  )
  expect(screen.getByText('Creato da Anna Rossi il 12/10/2026')).toBeInTheDocument()
  expect(screen.getByText('11/11/2026')).toBeInTheDocument()
  expect(await screen.findByText('40 % (predefinito)')).toBeInTheDocument()
})

test('a markup override is labelled as such', async () => {
  renderEditor({ quote: { markup_override_pct: 35 } })
  expect(await screen.findByText('35 % (personalizzato)')).toBeInTheDocument()
})

test('draft actions for owners and operators', async () => {
  renderEditor()
  await heading()
  for (const name of ['Segna come inviato', 'Duplica', 'Elimina', 'Modifica dati']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
})

test('operators cannot delete a draft', async () => {
  renderEditor({ staff: operatorStaff })
  await heading()
  expect(screen.getByRole('button', { name: 'Duplica' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Elimina' })).not.toBeInTheDocument()
})

test('sent quotes can be accepted, rejected or duplicated, not edited', async () => {
  renderEditor({ quote: { status: 'sent' } })
  await heading()
  for (const name of ['Segna come accettato', 'Segna come rifiutato', 'Duplica']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  for (const name of ['Segna come inviato', 'Modifica dati', 'Elimina']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

test('expired quotes can only be duplicated', async () => {
  renderEditor({ quote: { status: 'expired' } })
  await heading()
  expect(screen.getByRole('button', { name: 'Duplica' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Segna come accettato' })).not.toBeInTheDocument()
})

test('Mark as sent lists what is missing', async () => {
  const { user } = renderEditor({
    items: [
      quoteItemRow({
        id: 31,
        description: 'Staffa',
        printer_id: 11,
        material_id: 21,
        print_time_s: 100,
        job: jobRow({ status: 'succeeded' }),
      }),
    ],
    rpc: {
      get_quote_send_blockers: () => [
        { quote_item_id: null, code: 'valid_until_past' },
        { quote_item_id: 31, code: 'not_priced' },
      ],
    },
  })
  await user.click(await screen.findByRole('button', { name: 'Segna come inviato' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Q-2026-0007 non può ancora essere inviato',
  })
  expect(within(dialog).getByText('La data di validità è passata.')).toBeInTheDocument()
  expect(await within(dialog).findByText('Staffa: il prezzo non è calcolato.')).toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', { name: 'Segna come inviato' }),
  ).not.toBeInTheDocument()
})

test('Mark as sent confirms when nothing is missing', async () => {
  const { db, user } = renderEditor({
    rpc: { get_quote_send_blockers: () => [], mark_quote_sent: () => null },
  })
  await user.click(await screen.findByRole('button', { name: 'Segna come inviato' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Segnare Q-2026-0007 come inviato?',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Segna come inviato' }))
  await waitFor(() => expect(db.rpcCalls('mark_quote_sent')).toEqual([{ quote_id: 7 }]))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

test('Mark as sent waits while an item is slicing', async () => {
  renderEditor({
    items: [quoteItemRow({ printer_id: 11, material_id: 21, job: jobRow({ status: 'running' }) })],
  })
  await heading()
  expect(await screen.findByRole('button', { name: 'Segna come inviato' })).toBeDisabled()
  expect(screen.getByText('Attendi la fine dello slicing.')).toBeInTheDocument()
})

test('Mark accepted asks first', async () => {
  const { db, user } = renderEditor({
    quote: { status: 'sent' },
    rpc: { mark_quote_accepted: () => null },
  })
  await user.click(await screen.findByRole('button', { name: 'Segna come accettato' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Segnare Q-2026-0007 come accettato?',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Segna come accettato' }))
  await waitFor(() => expect(db.rpcCalls('mark_quote_accepted')).toEqual([{ quote_id: 7 }]))
})

test('Duplicate opens the copy', async () => {
  const { db, user, router } = renderEditor({
    functions: { 'duplicate-quote': () => ({ data: { quote_id: 57 } }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Duplica' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes/57'))
  expect(db.functionCalls('duplicate-quote')).toEqual([{ quote_id: 7 }])
  expect(await screen.findByText('Copia creata.')).toBeInTheDocument()
})

test('a failed duplicate says nothing was created', async () => {
  const { user, router } = renderEditor({
    functions: { 'duplicate-quote': () => ({ status: 500, code: 'duplicate_failed' }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Duplica' }))
  expect(
    await screen.findByText(
      'Non è stato possibile copiare il preventivo. Non è stato creato nulla.',
    ),
  ).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes/7')
})

test('owners delete a draft and its files', async () => {
  const { db, user, router } = renderEditor({
    items: [quoteItemRow({ id: 31, model_path: '7/u31/staffa.stl' })],
  })
  await user.click(await screen.findByRole('button', { name: 'Elimina' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare Q-2026-0007?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes'))
  expect(db.calls('quotes')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 7]] })
  expect(db.storageCalls('models')).toContainEqual({ op: 'remove', paths: ['7/u31/staffa.stl'] })
})

test('Edit details saves only what changed', async () => {
  const { db, user } = renderEditor({ rpc: { set_markup_override: () => null } })
  await user.click(await screen.findByRole('button', { name: 'Modifica dati' }))
  const sheet = await screen.findByRole('dialog', { name: 'Dati del preventivo' })
  await user.type(within(sheet).getByLabelText('Note'), 'Nuove note')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Dati del preventivo' })).not.toBeInTheDocument(),
  )
  expect(db.calls('quotes')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 7]],
    values: { notes: 'Nuove note' },
  })
  expect(db.rpcCalls('set_markup_override')).toEqual([])
})

test('owners change the markup from Edit details', async () => {
  const { db, user } = renderEditor({ rpc: { set_markup_override: () => null } })
  await user.click(await screen.findByRole('button', { name: 'Modifica dati' }))
  const sheet = await screen.findByRole('dialog', { name: 'Dati del preventivo' })
  await user.type(within(sheet).getByLabelText('Ricarico personalizzato (%)'), '30')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(db.rpcCalls('set_markup_override')).toEqual([{ quote_id: 7, pct: 30 }]),
  )
  expect(db.calls('quotes').filter((call) => call.op === 'update')).toEqual([])
})

const NOT_DRAFT = 'Il preventivo non è più una bozza e non si può modificare.'

test('Edit details on a quote that has meanwhile been sent explains why and turns read-only', async () => {
  const { db, user } = renderEditor()
  await user.click(await screen.findByRole('button', { name: 'Modifica dati' }))
  const sheet = await screen.findByRole('dialog', { name: 'Dati del preventivo' })
  await user.type(within(sheet).getByLabelText('Note'), 'Nuove note')
  db.table('quotes')[0].status = 'sent'
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(await within(sheet).findByText(NOT_DRAFT)).toBeInTheDocument()
  // The sheet is modal, so the page behind it only shows up with hidden elements included.
  await waitFor(() => expect(screen.getByText('Inviato')).toBeInTheDocument())
  expect(
    screen.queryByRole('button', { name: 'Modifica dati', hidden: true }),
  ).not.toBeInTheDocument()
})

test('Mark accepted on a quote someone else already closed shows its new status', async () => {
  const { db, user } = renderEditor({ quote: { status: 'sent' } })
  await user.click(await screen.findByRole('button', { name: 'Segna come accettato' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Segnare Q-2026-0007 come accettato?',
  })
  db.table('quotes')[0].status = 'accepted'
  db.failNext('mark_quote_accepted', { code: 'P0001', message: 'quote_not_sent' })
  await user.click(within(dialog).getByRole('button', { name: 'Segna come accettato' }))
  expect(
    await within(dialog).findByText('Solo un preventivo inviato può essere accettato o rifiutato.'),
  ).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('Accettato')).toBeInTheDocument())
})

test('deleting a draft that has meanwhile been sent explains why and keeps its files', async () => {
  const { db, user, router } = renderEditor({
    items: [quoteItemRow({ id: 31, model_path: '7/u31/staffa.stl' })],
  })
  await user.click(await screen.findByRole('button', { name: 'Elimina' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare Q-2026-0007?' })
  db.table('quotes')[0].status = 'sent'
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(await within(dialog).findByText(NOT_DRAFT)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('Inviato')).toBeInTheDocument())
  expect(router.state.location.pathname).toBe('/quotes/7')
  expect(db.storageCalls('models')).toEqual([])
})

test('a delete still succeeds when removing its files throws', async () => {
  const { db, user, router } = renderEditor({
    items: [quoteItemRow({ id: 31, model_path: '7/u31/staffa.stl' })],
  })
  const bucket = db.storage.from
  vi.spyOn(db.storage, 'from').mockImplementation((name) => ({
    ...bucket(name),
    remove: () => Promise.reject(new TypeError('Failed to fetch')),
  }))
  await user.click(await screen.findByRole('button', { name: 'Elimina' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare Q-2026-0007?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes'))
})

test('an unknown or malformed id shows not found', async () => {
  renderApp('/quotes/999', { session })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
})

test('a malformed id shows not found', async () => {
  renderApp('/quotes/abc', { session })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
})
