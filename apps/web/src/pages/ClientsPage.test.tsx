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
  expect(within(row).getByRole('link', { name: 'Mario Rossi' })).toHaveAttribute(
    'href',
    '/clients/1',
  )
  const other = screen.getByRole('row', { name: /Lucia Verdi/ })
  expect(within(other).getByText('0')).toBeInTheDocument()
  expect(within(other).getAllByText('—').length).toBeGreaterThan(0)
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
