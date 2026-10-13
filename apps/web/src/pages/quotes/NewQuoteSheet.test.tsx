import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { clientRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mario = () => clientRow({ id: 1, name: 'Mario Rossi', company: 'Rossi Meccanica' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

async function openSheet() {
  return screen.findByRole('dialog', { name: 'Nuovo preventivo' })
}

test('opens with the client from the URL and the default validity', async () => {
  renderApp('/quotes/new?client=1', { session, tables: { clients: [mario()] } })
  const sheet = await openSheet()
  expect(await within(sheet).findByRole('combobox', { name: 'Cliente' })).toHaveTextContent(
    'Mario Rossi (Rossi Meccanica)',
  )
  // Settings fixture: 30 days of validity.
  expect(within(sheet).getByLabelText('Valido fino al')).toHaveValue('2026-11-12')
})

test('creates the quote and opens it', async () => {
  const { db, user, router } = renderApp('/quotes/new?client=1', {
    session,
    tables: { clients: [mario()] },
  })
  const sheet = await openSheet()
  await within(sheet).findByText('Mario Rossi (Rossi Meccanica)')
  await user.type(within(sheet).getByLabelText('Note'), 'Consegna urgente')
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes/1'))
  expect(db.calls('quotes')).toContainEqual({
    op: 'insert',
    filters: [],
    values: { client_id: 1, valid_until: '2026-11-12', notes: 'Consegna urgente' },
  })
  expect(db.rpcCalls('set_markup_override')).toEqual([])
})

test('requires a client and a date that is not in the past', async () => {
  const { db, user } = renderApp('/quotes/new', { session })
  const sheet = await openSheet()
  const validUntil = await within(sheet).findByLabelText('Valido fino al')
  fireEvent.change(validUntil, { target: { value: '' } })
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  expect(await within(sheet).findAllByText('Campo obbligatorio.')).toHaveLength(2)

  fireEvent.change(validUntil, { target: { value: '2026-10-12' } })
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  expect(await within(sheet).findByText('Deve essere oggi o una data futura.')).toBeInTheDocument()
  expect(db.calls('quotes').filter((call) => call.op === 'insert')).toEqual([])
})

test('owners can set a markup override', async () => {
  const { db, user, router } = renderApp('/quotes/new?client=1', {
    session,
    tables: { clients: [mario()] },
    rpc: { set_markup_override: () => null },
  })
  const sheet = await openSheet()
  await within(sheet).findByText('Mario Rossi (Rossi Meccanica)')
  await user.type(within(sheet).getByLabelText('Ricarico personalizzato (%)'), '35,5')
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes/1'))
  expect(db.rpcCalls('set_markup_override')).toEqual([{ quote_id: 1, pct: 35.5 }])
})

test('a markup over 9999,99 is refused before anything is created', async () => {
  const { db, user } = renderApp('/quotes/new?client=1', {
    session,
    tables: { clients: [mario()] },
    rpc: { set_markup_override: () => null },
  })
  const sheet = await openSheet()
  await within(sheet).findByText('Mario Rossi (Rossi Meccanica)')
  await user.type(within(sheet).getByLabelText('Ricarico personalizzato (%)'), '10000')
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  expect(await within(sheet).findByText('Tra 0 e 9999,99.')).toBeInTheDocument()
  expect(db.calls('quotes').filter((call) => call.op === 'insert')).toEqual([])
  expect(db.rpcCalls('set_markup_override')).toEqual([])
})

test('operators do not see the markup field', async () => {
  renderApp('/quotes/new', { session, staff: operatorStaff })
  const sheet = await openSheet()
  expect(within(sheet).queryByLabelText('Ricarico personalizzato (%)')).not.toBeInTheDocument()
})

test('a markup that fails to save still opens the quote and says so', async () => {
  const { db, user, router } = renderApp('/quotes/new?client=1', {
    session,
    tables: { clients: [mario()] },
    rpc: { set_markup_override: () => null },
  })
  db.failNext('set_markup_override', { code: 'XX000', message: 'boom' })
  const sheet = await openSheet()
  await within(sheet).findByText('Mario Rossi (Rossi Meccanica)')
  await user.type(within(sheet).getByLabelText('Ricarico personalizzato (%)'), '35')
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  expect(
    await screen.findByText('Preventivo creato, ma il ricarico non è stato salvato.'),
  ).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes/1')
})

test('picks a client by searching', async () => {
  const { user } = renderApp('/quotes/new', {
    session,
    tables: { clients: [mario(), clientRow({ id: 2, name: 'Luca Verdi', company: null })] },
  })
  const sheet = await openSheet()
  await user.click(await within(sheet).findByRole('combobox', { name: 'Cliente' }))
  await user.type(await screen.findByRole('combobox', { name: 'Cerca cliente' }), 'verdi')
  await user.click(await screen.findByRole('option', { name: 'Luca Verdi' }))
  expect(within(sheet).getByRole('combobox', { name: 'Cliente' })).toHaveTextContent('Luca Verdi')
})

test('creates a client inline and selects it', async () => {
  const { user } = renderApp('/quotes/new', { session })
  const sheet = await openSheet()
  await user.click(await within(sheet).findByRole('combobox', { name: 'Cliente' }))
  await user.click(await screen.findByRole('option', { name: 'Nuovo cliente' }))
  const clientSheet = await screen.findByRole('dialog', { name: 'Nuovo cliente' })
  await user.type(within(clientSheet).getByLabelText('Nome'), 'Giulia Neri')
  await user.click(within(clientSheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Nuovo cliente' })).not.toBeInTheDocument(),
  )
  expect(within(await openSheet()).getByRole('combobox', { name: 'Cliente' })).toHaveTextContent(
    'Giulia Neri',
  )
})

test('closing the sheet goes back to the list', async () => {
  const { user, router } = renderApp('/quotes/new', { session })
  const sheet = await openSheet()
  await user.click(within(sheet).getByRole('button', { name: 'Chiudi' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes'))
})

test('shows a loading state inside the sheet while its data loads', async () => {
  renderApp('/quotes/new?client=1', { session, tables: { clients: [mario()] } })
  const sheet = await openSheet()
  expect(within(sheet).getByRole('status')).toHaveTextContent('Caricamento…')
  expect(await screen.findByRole('combobox', { name: 'Cliente' })).toBeInTheDocument()
  // One sheet throughout: the dialog found while loading is the one holding the form.
  expect(sheet).toBeInTheDocument()
})

test('a settings error shows Retry inside the sheet, and Retry recovers to the form', async () => {
  const { db, user } = renderApp('/quotes/new', { session })
  db.failNext('settings', NETWORK_FAILURE)
  const sheet = await openSheet()
  await user.click(await within(sheet).findByRole('button', { name: 'Riprova' }))
  expect(await within(sheet).findByRole('button', { name: 'Crea preventivo' })).toBeInTheDocument()
  expect(sheet).toBeInTheDocument()
})
