import { act, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, operatorStaff, quoteRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mario = () =>
  clientRow({ id: 1, name: 'Mario Rossi', phone: '+39 333 1234567', notes: 'Paga a 30 giorni' })

test("shows the client's form and quotes", async () => {
  renderApp('/clients/1', {
    session,
    tables: {
      clients: [mario()],
      quotes: [
        quoteRow({
          id: 7,
          client_id: 1,
          number: 'Q-2026-0007',
          status: 'sent',
          created_at: '2026-10-01T09:00:00Z',
          valid_until: '2026-10-31',
        }),
        quoteRow({ id: 8, client_id: 2, number: 'Q-2026-0008' }),
      ],
    },
  })
  expect(await screen.findByRole('heading', { level: 1, name: 'Mario Rossi' })).toBeInTheDocument()
  expect(screen.getByLabelText('Note interne')).toHaveValue('Paga a 30 giorni')
  const row = await screen.findByRole('row', { name: /Q-2026-0007/ })
  expect(within(row).getByText('Inviato')).toBeInTheDocument()
  expect(within(row).getByText('01/10/2026')).toBeInTheDocument()
  expect(within(row).getByText('31/10/2026')).toBeInTheDocument()
  expect(screen.queryByText('Q-2026-0008')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Nuovo preventivo per questo cliente' })).toHaveAttribute(
    'href',
    '/quotes/new?client=1',
  )
})

test('saves changes and confirms', async () => {
  const { db, user } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  const phone = await screen.findByLabelText('Telefono')
  await user.clear(phone)
  await user.type(phone, '+39 02 123456')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('clients')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: {
      name: 'Mario Rossi',
      company: 'Rossi Meccanica',
      email: 'mario@example.com',
      phone: '+39 02 123456',
      notes: 'Paga a 30 giorni',
    },
  })
})

test('leaving with unsaved changes asks first', async () => {
  const { user, router } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  await user.type(await screen.findByLabelText('Telefono'), '9')
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })

  await user.click(within(nav).getByRole('link', { name: 'Stampanti' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Modifiche non salvate' })
  await user.click(within(dialog).getByRole('button', { name: 'Continua a modificare' }))
  expect(router.state.location.pathname).toBe('/clients/1')

  await user.click(within(nav).getByRole('link', { name: 'Stampanti' }))
  await user.click(await screen.findByRole('button', { name: 'Scarta' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/printers'))
})

test('owners delete a client without quotes and go back to the list without a prompt', async () => {
  const { db, user, router } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  await user.type(await screen.findByLabelText('Telefono'), '9')
  await user.click(await screen.findByRole('button', { name: 'Elimina' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Eliminare il cliente Mario Rossi?',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/clients'))
  expect(
    screen.queryByRole('alertdialog', { name: 'Modifiche non salvate' }),
  ).not.toBeInTheDocument()
  expect(db.calls('clients')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 1]] })
})

test('delete is hidden when the client has quotes', async () => {
  renderApp('/clients/1', {
    session,
    tables: { clients: [mario()], quotes: [quoteRow({ client_id: 1 })] },
  })
  await screen.findByRole('row', { name: /Q-2026-0001/ })
  expect(screen.queryByRole('button', { name: 'Elimina' })).not.toBeInTheDocument()
})

test('operators cannot delete clients', async () => {
  renderApp('/clients/1', { session, staff: operatorStaff, tables: { clients: [mario()] } })
  expect(await screen.findByText('Nessun preventivo.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Elimina' })).not.toBeInTheDocument()
})

test.each(['/clients/999', '/clients/abc'])('%s shows not found', async (path) => {
  renderApp(path, { session, tables: { clients: [mario()] } })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
})

test('New quote for this client opens the New quote sheet with the client', async () => {
  const { user, router } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  await user.click(await screen.findByRole('link', { name: 'Nuovo preventivo per questo cliente' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo preventivo' })
  expect(await within(sheet).findByRole('combobox', { name: 'Cliente' })).toHaveTextContent(
    'Mario Rossi',
  )
  expect(router.state.location.search).toBe('?client=1')
})

test('a failed background refetch keeps the unsaved edits and offers Retry', async () => {
  const { db, queryClient, user } = renderApp('/clients/1', {
    session,
    tables: { clients: [mario()] },
  })
  const phone = await screen.findByLabelText('Telefono')
  await user.type(phone, '9')
  db.failNext('clients', NETWORK_FAILURE)
  await act(() => queryClient.refetchQueries({ queryKey: ['clients'] }))
  // Query notifications reach React on a timer; let them render before asserting.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(screen.getByLabelText('Telefono')).toHaveValue('+39 333 12345679')
  expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument()
})
