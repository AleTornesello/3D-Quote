import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

test('owners see the current values in the form', async () => {
  renderApp('/settings', { session })
  expect(await screen.findByLabelText('Costo di avvio')).toHaveValue('3,00')
  expect(screen.getByLabelText('Margine per stampe fallite (%)')).toHaveValue('5')
  expect(screen.getByLabelText('Nome del negozio')).toHaveValue('3D Lab')
  expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled()
})

test('saves only the changed fields', async () => {
  const { db, user } = renderApp('/settings', { session })
  const fee = await screen.findByLabelText('Costo di avvio')
  await user.clear(fee)
  await user.type(fee, '4,5')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { setup_fee: 4.5 },
  })
})

test('currency codes are saved in upper case', async () => {
  const { db, user } = renderApp('/settings', { session })
  const currency = await screen.findByLabelText('Valuta')
  await user.clear(currency)
  await user.type(currency, 'usd')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { currency: 'USD' },
  })
})

test('checks values before saving', async () => {
  const { db, user } = renderApp('/settings', { session })
  const failure = await screen.findByLabelText('Margine per stampe fallite (%)')
  await user.clear(failure)
  await user.type(failure, '150')
  const prefix = screen.getByLabelText('Prefisso numero')
  await user.clear(prefix)
  await user.type(prefix, 'Q-1')
  const currency = screen.getByLabelText('Valuta')
  await user.clear(currency)
  await user.type(currency, 'EURO')
  const validity = screen.getByLabelText('Validità predefinita (giorni)')
  await user.clear(validity)
  await user.type(validity, '0')
  await user.click(screen.getByRole('button', { name: 'Salva' }))

  expect(await screen.findByText('Deve essere tra 0 e 100.')).toBeInTheDocument()
  expect(screen.getByText('Da 1 a 10 lettere o cifre.')).toBeInTheDocument()
  expect(screen.getByText('Usa un codice di 3 lettere, es. EUR.')).toBeInTheDocument()
  expect(screen.getByText('Deve essere tra 1 e 365 giorni.')).toBeInTheDocument()
  expect(db.calls('settings').filter((call) => call.op === 'update')).toHaveLength(0)
})

test('a refused save is explained', async () => {
  const { db, user } = renderApp('/settings', { session })
  const fee = await screen.findByLabelText('Costo di avvio')
  await user.clear(fee)
  await user.type(fee, '4')
  db.failNext('settings', { code: '42501', message: 'permission denied for table settings' })
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Non hai i permessi per questa operazione.')).toBeInTheDocument()
})

test('operators see the settings read-only', async () => {
  renderApp('/settings', { session, staff: operatorStaff })
  expect(await screen.findByText('3D Lab')).toBeInTheDocument()
  expect(screen.getByText('5 %')).toBeInTheDocument()
  expect(screen.getByText('Q')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument()
})
