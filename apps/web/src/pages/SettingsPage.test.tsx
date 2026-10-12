import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { operatorStaff, settingsRow } from '@/test/fixtures'
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

const png = () => new File(['png'], 'logo.png', { type: 'image/png' })
const withLogo = { settings: [{ ...settingsRow, shop_logo_path: 'logo-1.png' }] }

test('uploads a logo and shows it', async () => {
  const { db, user } = renderApp('/settings', { session })
  await user.upload(await screen.findByLabelText('Carica logo'), png())
  expect(await screen.findByRole('img', { name: 'Logo del negozio' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^https:\/\/storage\.test\/branding\/logo-\d+\.png$/),
  )
  expect(db.storageCalls('branding')).toContainEqual({
    op: 'upload',
    paths: [expect.stringMatching(/^logo-\d+\.png$/)],
  })
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { shop_logo_path: expect.stringMatching(/^logo-\d+\.png$/) },
  })
})

test('replacing the logo deletes the old file', async () => {
  const { db, user } = renderApp('/settings', { session, tables: withLogo })
  expect(await screen.findByRole('img', { name: 'Logo del negozio' })).toHaveAttribute(
    'src',
    'https://storage.test/branding/logo-1.png',
  )
  await user.upload(screen.getByLabelText('Carica logo'), png())
  await waitFor(() =>
    expect(db.storageCalls('branding')).toContainEqual({ op: 'remove', paths: ['logo-1.png'] }),
  )
})

test('rejects files of the wrong type or over 1 MB before uploading', async () => {
  // The input's accept attribute would filter the GIF out; the check under test is the page's own.
  const user = userEvent.setup({ applyAccept: false })
  const { db } = renderApp('/settings', { session })
  const input = await screen.findByLabelText('Carica logo')
  await user.upload(input, new File(['gif'], 'logo.gif', { type: 'image/gif' }))
  expect(await screen.findByText('Usa un file PNG, JPG o SVG.')).toBeInTheDocument()
  await user.upload(
    input,
    new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
  )
  expect(await screen.findByText('Il file supera 1 MB.')).toBeInTheDocument()
  expect(db.storageCalls('branding').filter((call) => call.op === 'upload')).toHaveLength(0)
})

test('removes the logo', async () => {
  const { db, user } = renderApp('/settings', { session, tables: withLogo })
  await user.click(await screen.findByRole('button', { name: 'Rimuovi logo' }))
  expect(await screen.findByText('Nessun logo.')).toBeInTheDocument()
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { shop_logo_path: null },
  })
  expect(db.storageCalls('branding')).toContainEqual({ op: 'remove', paths: ['logo-1.png'] })
})

test('operators see the logo without upload controls', async () => {
  renderApp('/settings', { session, staff: operatorStaff, tables: withLogo })
  expect(await screen.findByRole('img', { name: 'Logo del negozio' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Carica logo')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Rimuovi logo' })).not.toBeInTheDocument()
})
