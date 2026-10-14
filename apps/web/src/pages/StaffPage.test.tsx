import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const SIGNED_IN = '2026-10-01T10:00:00Z'
const member = (
  userId: string,
  name: string,
  email: string,
  role: string,
  active = true,
  lastSignInAt: string | null = SIGNED_IN,
) => ({
  user_id: userId,
  display_name: name,
  email,
  role,
  language: 'it',
  active,
  created_at: '2026-01-01T09:00:00Z',
  last_sign_in_at: lastSignInAt,
})
const members = [
  member('user-1', 'Anna Rossi', 'anna@example.com', 'owner'),
  member('user-2', 'Bruno Verdi', 'bruno@example.com', 'owner'),
  member('user-3', 'Otto Bianchi', 'otto@example.com', 'operator', false),
  member('user-4', 'Carla Neri', 'carla@example.com', 'operator', true, null),
]
const rpc = { list_staff: () => members }
// The fake table holds only the signed-in person; updates (.single()) need the other rows to exist.
const tables = { staff: members.filter((m) => m.user_id !== 'user-1') }

test('lists staff with emails, roles and their status', async () => {
  const { db } = renderApp('/staff', { session, rpc })
  const row = await screen.findByRole('row', { name: /Otto Bianchi/ })
  expect(within(row).getByText('otto@example.com')).toBeInTheDocument()
  expect(within(row).getByRole('combobox', { name: 'Ruolo di Otto Bianchi' })).toHaveValue(
    'operator',
  )
  expect(within(row).getByText('Disattivato')).toBeInTheDocument()
  expect(
    within(screen.getByRole('row', { name: /Anna Rossi/ })).getByText('Attivo'),
  ).toBeInTheDocument()
  expect(
    within(screen.getByRole('row', { name: /Carla Neri/ })).getByText('Invitato'),
  ).toBeInTheDocument()
  expect(db.rpcCalls('list_staff')).toHaveLength(1)
})

test('changing a role updates the staff record', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Ruolo di Carla Neri' }),
    'owner',
  )
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { role: 'owner' },
      filters: [['eq', 'user_id', 'user-4']],
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

test('an inactive person’s role cannot be changed until they are reactivated', async () => {
  renderApp('/staff', { session, rpc })
  expect(await screen.findByRole('combobox', { name: 'Ruolo di Otto Bianchi' })).toBeDisabled()
})

test('Deactivate asks first, then marks the person inactive', async () => {
  const { db, user } = renderApp('/staff', { session, rpc, tables })
  await user.click(await screen.findByRole('button', { name: 'Disattiva Bruno Verdi' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Disattivare Bruno Verdi?')).toBeInTheDocument()
  expect(db.calls('staff').filter((call) => call.op === 'update')).toHaveLength(0)
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva' }))
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { active: false },
      filters: [['eq', 'user_id', 'user-2']],
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

test('Reactivate needs no confirmation', async () => {
  const { db, user } = renderApp('/staff', { session, rpc, tables })
  await user.click(await screen.findByRole('button', { name: 'Riattiva Otto Bianchi' }))
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { active: true },
      filters: [['eq', 'user_id', 'user-3']],
    }),
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('deactivating the last owner is refused with a message and the dialog stays open', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  await user.click(await screen.findByRole('button', { name: 'Disattiva Bruno Verdi' }))
  const dialog = await screen.findByRole('alertdialog')
  db.failNext('staff', { code: 'P0001', message: 'last_owner' })
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Deve esserci almeno un titolare.',
  )
})

test('there are no actions on your own row', async () => {
  renderApp('/staff', { session, rpc })
  await screen.findByRole('row', { name: /Anna Rossi/ })
  expect(screen.queryByRole('button', { name: 'Disattiva Anna Rossi' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disattiva Bruno Verdi' })).toBeInTheDocument()
})
