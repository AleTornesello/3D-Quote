import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const member = (userId: string, name: string, email: string, role: string, active = true) => ({
  user_id: userId,
  display_name: name,
  email,
  role,
  language: 'it',
  active,
  created_at: '2026-01-01T09:00:00Z',
})
const members = [
  member('user-1', 'Anna Rossi', 'anna@example.com', 'owner'),
  member('user-2', 'Bruno Verdi', 'bruno@example.com', 'owner'),
  member('user-3', 'Otto Bianchi', 'otto@example.com', 'operator', false),
]
const rpc = { list_staff: () => members }

test('lists staff with emails, roles and whether they are active', async () => {
  const { db } = renderApp('/staff', { session, rpc })
  const row = await screen.findByRole('row', { name: /Otto Bianchi/ })
  expect(within(row).getByText('otto@example.com')).toBeInTheDocument()
  expect(within(row).getByRole('combobox', { name: 'Ruolo di Otto Bianchi' })).toHaveValue(
    'operator',
  )
  expect(within(row).getByText('No')).toBeInTheDocument()
  expect(db.rpcCalls('list_staff')).toHaveLength(1)
})

test('changing a role updates the staff record', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Ruolo di Otto Bianchi' }),
    'owner',
  )
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { role: 'owner' },
      filters: [['eq', 'user_id', 'user-3']],
    }),
  )
})

test('demoting the last owner is refused and the role goes back', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  const select = await screen.findByRole('combobox', { name: 'Ruolo di Bruno Verdi' })
  db.failNext('staff', { code: 'P0001', message: 'last_owner' })
  await user.selectOptions(select, 'operator')
  expect(await screen.findByRole('alert')).toHaveTextContent('Deve esserci almeno un titolare.')
  expect(select).toHaveValue('owner')
})

test('owners cannot change their own role here', async () => {
  renderApp('/staff', { session, rpc })
  expect(await screen.findByRole('combobox', { name: 'Ruolo di Anna Rossi' })).toBeDisabled()
})

test('a failed load shows Retry', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  db.failNext('list_staff', NETWORK_FAILURE)
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(await screen.findByRole('row', { name: /Otto Bianchi/ })).toBeInTheDocument()
})
