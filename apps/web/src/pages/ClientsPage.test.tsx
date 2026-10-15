import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mario = () =>
  clientRow({ id: 1, name: 'Mario Rossi', quoteCount: 2, lastQuoteAt: '2026-10-05T10:00:00Z' })
const lucia = () =>
  clientRow({ id: 2, name: 'Lucia Verdi', company: null, email: 'lucia@example.com' })
const searchBox = () => screen.getByRole('searchbox', { name: 'Cerca per nome, azienda o email' })

test('lists clients with their quote count and last quote date', async () => {
  renderApp('/clients', { session, tables: { clients: [mario(), lucia()] } })
  const row = await screen.findByRole('row', { name: /Mario Rossi/ })
  expect(within(row).getByText('Rossi Meccanica')).toBeInTheDocument()
  expect(within(row).getByText('2')).toBeInTheDocument()
  expect(within(row).getByText('05/10/2026')).toBeInTheDocument()
  expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  const other = screen.getByRole('row', { name: /Lucia Verdi/ })
  expect(within(other).getByText('0')).toBeInTheDocument()
  expect(within(other).getAllByText('—').length).toBeGreaterThan(0)
})

const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)

test('sorts by name by default and by a column when its header is clicked', async () => {
  const { user } = renderApp('/clients', {
    session,
    tables: {
      clients: [
        mario(),
        lucia(),
        clientRow({
          id: 3,
          name: 'anna Bianchi',
          company: 'Bianchi Srl',
          quoteCount: 5,
          lastQuoteAt: '2026-09-01T10:00:00Z',
        }),
      ],
    },
  })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  // Case-insensitive, whatever order the server returned.
  expect(names()).toEqual(['anna Bianchi', 'Lucia Verdi', 'Mario Rossi'])
  expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )

  await user.click(screen.getByRole('button', { name: 'Nome' }))
  expect(names()).toEqual(['Mario Rossi', 'Lucia Verdi', 'anna Bianchi'])
  expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute(
    'aria-sort',
    'descending',
  )

  // Counts and dates start from the highest; clients without one stay last either way.
  await user.click(screen.getByRole('button', { name: 'Preventivi' }))
  expect(names()).toEqual(['anna Bianchi', 'Mario Rossi', 'Lucia Verdi'])
  await user.click(screen.getByRole('button', { name: 'Ultimo preventivo' }))
  expect(names()).toEqual(['Mario Rossi', 'anna Bianchi', 'Lucia Verdi'])
  await user.click(screen.getByRole('button', { name: 'Ultimo preventivo' }))
  expect(names()).toEqual(['anna Bianchi', 'Mario Rossi', 'Lucia Verdi'])

  // Text starts from A; a missing company goes last.
  await user.click(screen.getByRole('button', { name: 'Azienda' }))
  expect(names()).toEqual(['anna Bianchi', 'Mario Rossi', 'Lucia Verdi'])
  expect(screen.getByRole('columnheader', { name: 'Azienda' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
})

test('the Edit button and a double-click on the row open the client; a single click does not', async () => {
  const { router, user } = renderApp('/clients', {
    session,
    tables: { clients: [mario(), lucia()] },
  })
  const row = await screen.findByRole('row', { name: /Mario Rossi/ })
  await user.click(within(row).getByText('Mario Rossi'))
  expect(router.state.location.pathname).toBe('/clients')
  await user.dblClick(within(row).getByText('Rossi Meccanica'))
  await waitFor(() => expect(router.state.location.pathname).toBe('/clients/1'))
  await router.navigate('/clients')
  await user.click(await screen.findByRole('button', { name: 'Modifica Lucia Verdi' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/clients/2'))
})

test('the owner deletes a client without quotes from its row, after confirming', async () => {
  const { db, user } = renderApp('/clients', { session, tables: { clients: [mario(), lucia()] } })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  expect(screen.queryByRole('button', { name: 'Elimina Mario Rossi' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Elimina Lucia Verdi' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Eliminare il cliente Lucia Verdi?',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(db.calls('clients')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 2]] })
})

test('deleting from the list a client that has meanwhile got a quote explains why', async () => {
  const { db, user } = renderApp('/clients', { session, tables: { clients: [lucia()] } })
  await user.click(await screen.findByRole('button', { name: 'Elimina Lucia Verdi' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Eliminare il cliente Lucia Verdi?',
  })
  db.failNext('clients', { code: '23503', message: 'violates foreign key constraint' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(
    await within(dialog).findByText('Il cliente ha dei preventivi e non può essere eliminato.'),
  ).toBeInTheDocument()
})

test('operators get no Delete button', async () => {
  renderApp('/clients', { session, staff: operatorStaff, tables: { clients: [lucia()] } })
  await screen.findByRole('row', { name: /Lucia Verdi/ })
  expect(screen.queryByRole('button', { name: 'Elimina Lucia Verdi' })).not.toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/clients', { session })
  expect(await screen.findByText('Nessun cliente.')).toBeInTheDocument()
})

test('searches by name, company or email on the server', async () => {
  const { db, user } = renderApp('/clients', { session, tables: { clients: [mario(), lucia()] } })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  await user.type(searchBox(), 'lucia')
  await waitFor(() =>
    expect(screen.queryByRole('row', { name: /Mario Rossi/ })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('row', { name: /Lucia Verdi/ })).toBeInTheDocument()
  expect(db.calls('clients')).toContainEqual({
    op: 'select',
    filters: [['or', 'name.ilike.%lucia%,company.ilike.%lucia%,email.ilike.%lucia%']],
  })
})

test('search text that is PostgREST syntax is stripped before it is sent', async () => {
  const { db, user } = renderApp('/clients', { session, tables: { clients: [mario()] } })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  await user.type(searchBox(), 'Rossi, (Meccanica)*')
  await waitFor(() =>
    expect(db.calls('clients')).toContainEqual({
      op: 'select',
      filters: [
        [
          'or',
          'name.ilike.%Rossi Meccanica%,company.ilike.%Rossi Meccanica%,email.ilike.%Rossi Meccanica%',
        ],
      ],
    }),
  )
  expect(screen.getByRole('row', { name: /Mario Rossi/ })).toBeInTheDocument()
})

test('says when nothing matches the search', async () => {
  const { user } = renderApp('/clients', { session, tables: { clients: [mario()] } })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  await user.type(searchBox(), 'zzz')
  expect(await screen.findByText('Nessun cliente corrisponde alla ricerca.')).toBeInTheDocument()
})

test('operators create a client and land on its page', async () => {
  const { db, user, router } = renderApp('/clients', { session, staff: operatorStaff })
  await user.click(await screen.findByRole('button', { name: 'Nuovo cliente' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo cliente' })
  await user.type(within(sheet).getByLabelText('Nome'), 'Giulia Neri')
  await user.type(within(sheet).getByLabelText('Email'), 'giulia@')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(await within(sheet).findByText('Inserisci un indirizzo email valido.')).toBeInTheDocument()

  await user.type(within(sheet).getByLabelText('Email'), 'example.com')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/clients\/\d+$/))
  expect(db.calls('clients')).toContainEqual({
    op: 'insert',
    filters: [],
    values: {
      name: 'Giulia Neri',
      company: null,
      email: 'giulia@example.com',
      phone: null,
      notes: null,
    },
  })
})
