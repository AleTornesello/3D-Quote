import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { consumableRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const bolt = () => consumableRow({ id: 1, name: 'Vite M3', unit: 'pz', unit_price: 0.1, stock: 10 })

test('lists consumables with price and available quantity', async () => {
  renderApp('/consumables', {
    session,
    tables: { consumables: [bolt(), consumableRow({ id: 2, name: 'Inserto M3', stock: 0 })] },
  })
  const row = await screen.findByRole('row', { name: /Vite M3/ })
  expect(within(row).getByText('0,10 €')).toBeInTheDocument()
  expect(within(row).getByText('10 pz')).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Inserto M3/ })).toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/consumables', { session })
  expect(await screen.findByText('Nessun consumabile.')).toBeInTheDocument()
})

test('operators see the list without owner actions', async () => {
  renderApp('/consumables', { session, staff: operatorStaff, tables: { consumables: [bolt()] } })
  await screen.findByRole('row', { name: /Vite M3/ })
  expect(screen.queryByRole('button', { name: 'Nuovo consumabile' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Modifica Vite M3' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

test('an owner creates a consumable', async () => {
  const { db, user } = renderApp('/consumables', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo consumabile' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo consumabile' })
  await user.type(within(sheet).getByLabelText('Nome'), 'Dado M4')
  await user.clear(within(sheet).getByLabelText('Unità'))
  await user.type(within(sheet).getByLabelText('Unità'), 'pz')
  await user.type(within(sheet).getByLabelText('Prezzo unitario'), '0,05')
  await user.type(within(sheet).getByLabelText('Disponibili'), '200')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('consumables')).toContainEqual({
    op: 'insert',
    filters: [],
    values: { name: 'Dado M4', unit: 'pz', unit_price: 0.05, stock: 200, active: true },
  })
})

test('rejects a negative price and a fractional stock', async () => {
  const { db, user } = renderApp('/consumables', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo consumabile' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo consumabile' })
  await user.type(within(sheet).getByLabelText('Nome'), 'X')
  await user.type(within(sheet).getByLabelText('Prezzo unitario'), '-1')
  await user.type(within(sheet).getByLabelText('Disponibili'), '1,5')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(await within(sheet).findByText('Non può essere negativo.')).toBeInTheDocument()
  expect(within(sheet).getByText('Inserisci un numero intero.')).toBeInTheDocument()
  // Only the list query ran: nothing was written.
  expect(db.calls('consumables').filter((call) => call.op !== 'select')).toEqual([])
})

test('the Active switch updates the consumable', async () => {
  const { db, user } = renderApp('/consumables', { session, tables: { consumables: [bolt()] } })
  await user.click(await screen.findByRole('switch', { name: 'Attiva/disattiva Vite M3' }))
  await waitFor(() =>
    expect(db.calls('consumables')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
})

test('a consumable used by a quote cannot be deleted, only deactivated', async () => {
  const { db, user } = renderApp('/consumables', { session, tables: { consumables: [bolt()] } })
  const remove = await screen.findByRole('button', { name: 'Elimina Vite M3' })
  // Registered after the list loaded, so it hits the delete and not the list query.
  db.failNext('consumables', { code: '23503', message: 'violates foreign key constraint' })
  await user.click(remove)
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(
    await within(dialog).findByText(/Il consumabile è usato in alcuni preventivi/),
  ).toBeInTheDocument()
})
