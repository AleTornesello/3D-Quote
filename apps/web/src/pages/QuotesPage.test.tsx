import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, quoteListRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function dataRows() {
  return screen.getAllByRole('row').slice(1)
}

test('shows quotes with client, status, total and creator', async () => {
  renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [
        quoteListRow({ id: 42, total: 39.24 }),
        quoteListRow({ id: 43, client_company: null, status: 'sent', total: null }),
      ],
    },
  })
  const first = await screen.findByRole('row', { name: /Q-2026-0042/ })
  expect(within(first).getByRole('link', { name: 'Q-2026-0042' })).toHaveAttribute(
    'href',
    '/quotes/42',
  )
  expect(within(first).getByText('Rossi Meccanica')).toBeInTheDocument()
  expect(within(first).getByText('Bozza')).toBeInTheDocument()
  expect(within(first).getByText('39,24 €')).toBeInTheDocument()
  expect(within(first).getByText('da Anna Rossi')).toBeInTheDocument()
  const second = screen.getByRole('row', { name: /Q-2026-0043/ })
  expect(within(second).getByText('Inviato')).toBeInTheDocument()
  expect(within(second).getByText('—')).toBeInTheDocument()
})

test('marks sent quotes that expire within a week', async () => {
  renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [
        quoteListRow({ id: 1, status: 'sent', valid_until: '2026-10-18' }),
        quoteListRow({ id: 2, status: 'sent', valid_until: '2026-10-25' }),
        quoteListRow({ id: 3, status: 'draft', valid_until: '2026-10-15' }),
      ],
    },
  })
  const soon = await screen.findByRole('row', { name: /Q-2026-0001/ })
  expect(within(soon).getByText('Scade a breve')).toBeInTheDocument()
  expect(screen.getAllByText('Scade a breve')).toHaveLength(1)
})

test('search and filters reach the query and the URL', async () => {
  const { db, user, router } = renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [quoteListRow({ id: 1 })],
      clients: [clientRow({ id: 1, name: 'Mario Rossi' })],
    },
  })
  await screen.findByRole('row', { name: /Q-2026-0001/ })

  await user.type(screen.getByRole('searchbox', { name: 'Cerca per numero o cliente' }), 'rossi')
  await waitFor(() => expect(router.state.location.search).toContain('q=rossi'))
  await waitFor(() =>
    expect(db.calls('quotes_list').at(-1)?.filters).toContainEqual([
      'or',
      'number.ilike.%rossi%,client_name.ilike.%rossi%,client_company.ilike.%rossi%',
    ]),
  )

  await user.click(screen.getByRole('button', { name: /Stato/ }))
  await user.click(await screen.findByRole('checkbox', { name: 'Inviato' }))
  await waitFor(() => expect(router.state.location.search).toContain('status=sent'))
  await waitFor(() =>
    expect(db.calls('quotes_list').at(-1)?.filters).toContainEqual(['in', 'status', ['sent']]),
  )
  await user.keyboard('{Escape}')

  await user.selectOptions(await screen.findByLabelText('Cliente'), 'Mario Rossi')
  await waitFor(() => expect(router.state.location.search).toContain('client=1'))
  await waitFor(() =>
    expect(db.calls('quotes_list').at(-1)?.filters).toContainEqual(['eq', 'client_id', 1]),
  )

  fireEvent.change(screen.getByLabelText('Creato dal'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('Creato al'), { target: { value: '2026-10-31' } })
  await waitFor(() => expect(router.state.location.search).toContain('to=2026-10-31'))
  await waitFor(() => {
    const filters = db.calls('quotes_list').at(-1)?.filters
    expect(filters).toContainEqual(['gte', 'created_on', '2026-10-01'])
    expect(filters).toContainEqual(['lte', 'created_on', '2026-10-31'])
  })
})

test('a header click sorts by that column and a second click reverses it', async () => {
  const { user, router } = renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [
        quoteListRow({ id: 1, total: 10 }),
        quoteListRow({ id: 2, total: null }),
        quoteListRow({ id: 3, total: 30 }),
      ],
    },
  })
  await screen.findByRole('row', { name: /Q-2026-0001/ })
  await user.click(screen.getByRole('button', { name: 'Totale' }))
  await waitFor(() => expect(router.state.location.search).toBe('?sort=total'))
  await waitFor(() =>
    expect(dataRows().map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Q-2026-0003',
      'Q-2026-0001',
      'Q-2026-0002',
    ]),
  )
  expect(screen.getByRole('columnheader', { name: 'Totale' })).toHaveAttribute(
    'aria-sort',
    'descending',
  )

  await user.click(screen.getByRole('button', { name: 'Totale' }))
  await waitFor(() =>
    expect(dataRows().map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Q-2026-0001',
      'Q-2026-0003',
      'Q-2026-0002',
    ]),
  )
  expect(router.state.location.search).toBe('?sort=total&dir=asc')
})

test('pages through 25 at a time', async () => {
  const rows = Array.from({ length: 26 }, (_, i) =>
    quoteListRow({ id: i + 1, created_at: `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00Z` }),
  )
  const { user, router } = renderApp('/quotes', { session, tables: { quotes_list: rows } })
  expect(await screen.findByText('1–25 di 26')).toBeInTheDocument()
  expect(dataRows()).toHaveLength(25)
  // Default sort is newest first.
  expect(within(dataRows()[0]).getAllByRole('cell')[0]).toHaveTextContent('Q-2026-0026')
  expect(screen.getByRole('button', { name: 'Precedente' })).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Successiva' }))
  expect(await screen.findByText('26–26 di 26')).toBeInTheDocument()
  expect(dataRows()).toHaveLength(1)
  expect(within(dataRows()[0]).getAllByRole('cell')[0]).toHaveTextContent('Q-2026-0001')
  expect(router.state.location.search).toBe('?page=2')
  expect(screen.getByRole('button', { name: 'Successiva' })).toBeDisabled()
})

test('changing a filter or the sort goes back to page 1', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => quoteListRow({ id: i + 1 }))
  const { user, router } = renderApp('/quotes?page=2', { session, tables: { quotes_list: rows } })
  expect(await screen.findByText('26–30 di 30')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /Stato/ }))
  await user.click(await screen.findByRole('checkbox', { name: 'Bozza' }))
  await waitFor(() => expect(router.state.location.search).toBe('?status=draft'))
  await user.keyboard('{Escape}')
  expect(await screen.findByText('1–25 di 30')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Successiva' }))
  await waitFor(() => expect(router.state.location.search).toContain('page=2'))
  await user.click(screen.getByRole('button', { name: 'Totale' }))
  await waitFor(() => expect(router.state.location.search).not.toContain('page'))
  expect(router.state.location.search).toContain('sort=total')
})

test('a page past the end goes back to page 1', async () => {
  const { db, router } = renderApp('/quotes?page=4', {
    session,
    tables: { quotes_list: [quoteListRow({ id: 1 })] },
  })
  db.failNext('quotes_list', {
    code: 'PGRST103',
    message: 'Requested range not satisfiable',
  })
  expect(await screen.findByRole('row', { name: /Q-2026-0001/ })).toBeInTheDocument()
  expect(router.state.location.search).toBe('')
})

test('empty states, with and without filters', async () => {
  const { user, router } = renderApp('/quotes?status=sent', { session })
  expect(await screen.findByText('Nessun preventivo corrisponde ai filtri.')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'Cancella filtri' })[0])
  expect(await screen.findByText('Nessun preventivo.')).toBeInTheDocument()
  expect(router.state.location.search).toBe('')
})

/** Longer than the search box's 300 ms debounce. */
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 400))

test('the empty-state Clear filters also empties the search box for good', async () => {
  const { user, router } = renderApp('/quotes?q=zzz', { session })
  const search = await screen.findByRole('searchbox', { name: 'Cerca per numero o cliente' })
  expect(search).toHaveValue('zzz')
  expect(await screen.findByText('Nessun preventivo corrisponde ai filtri.')).toBeInTheDocument()
  const clearButtons = screen.getAllByRole('button', { name: 'Cancella filtri' })
  // The last one is the empty state's, after the filter bar's.
  await user.click(clearButtons[clearButtons.length - 1])
  expect(await screen.findByText('Nessun preventivo.')).toBeInTheDocument()
  expect(router.state.location.search).toBe('')
  expect(search).toHaveValue('')
  await pastDebounce()
  expect(router.state.location.search).toBe('')
  expect(search).toHaveValue('')
})

test('the sidebar link to the list drops the search, box included', async () => {
  const { user, router } = renderApp('/quotes?q=x', {
    session,
    tables: { quotes_list: [quoteListRow({ id: 1 })] },
  })
  const search = await screen.findByRole('searchbox', { name: 'Cerca per numero o cliente' })
  expect(search).toHaveValue('x')
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  await user.click(within(nav).getByRole('link', { name: 'Preventivi' }))
  await waitFor(() => expect(search).toHaveValue(''))
  expect(router.state.location.search).toBe('')
  await pastDebounce()
  expect(router.state.location.search).toBe('')
  expect(search).toHaveValue('')
})

test('New quote opens /quotes/new', async () => {
  const { user, router } = renderApp('/quotes', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo preventivo' }))
  expect(router.state.location.pathname).toBe('/quotes/new')
})
