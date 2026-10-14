import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { operatorStaff, printerRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mk4 = () => printerRow({ id: 1, name: 'MK4 #1' })

async function openEdit(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Modifica MK4 #1' }))
  return screen.findByRole('dialog', { name: 'Modifica stampante' })
}

test('lists printers with formatted values', async () => {
  renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const row = await screen.findByRole('row', { name: /MK4 #1/ })
  expect(within(row).getByText('Prusa MK4')).toBeInTheDocument()
  expect(within(row).getByText('250 × 210 × 220 mm')).toBeInTheDocument()
  expect(within(row).getByText('0,40 mm')).toBeInTheDocument()
  expect(within(row).getByText('1,50 €/h')).toBeInTheDocument()
  expect(within(row).getByText('120 W')).toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/printers', { session })
  expect(await screen.findByText('Nessuna stampante.')).toBeInTheDocument()
})

test('a failed load shows the error and Retry reloads', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  db.failNext('printers', NETWORK_FAILURE)
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(await screen.findByRole('row', { name: /MK4 #1/ })).toBeInTheDocument()
})

test('operators see the list without owner actions', async () => {
  renderApp('/printers', { session, staff: operatorStaff, tables: { printers: [mk4()] } })
  const row = await screen.findByRole('row', { name: /MK4 #1/ })
  expect(within(row).getByText('Sì')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nuova stampante' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Modifica MK4 #1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Elimina MK4 #1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

test('creates a printer, accepting Italian decimals', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  await user.type(within(sheet).getByLabelText('Nome'), 'X1C #1')
  await user.type(within(sheet).getByLabelText('Modello'), 'Bambu Lab X1C')
  await user.type(within(sheet).getByLabelText('Volume X (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Volume Y (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Volume Z (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Costo orario'), '2,5')
  await user.type(within(sheet).getByLabelText('Potenza (W)'), '180')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'insert',
    filters: [],
    values: {
      name: 'X1C #1',
      model: 'Bambu Lab X1C',
      build_x_mm: 256,
      build_y_mm: 256,
      build_z_mm: 256,
      nozzle_diameter_mm: 0.4,
      hourly_rate: 2.5,
      purchase_cost: null,
      lifetime_hours: null,
      power_w: 180,
      active: true,
    },
  })
  expect(await screen.findByRole('row', { name: /X1C #1/ })).toBeInTheDocument()
})

async function fillBasics(user: ReturnType<typeof renderApp>['user'], sheet: HTMLElement) {
  await user.type(within(sheet).getByLabelText('Nome'), 'X1C #1')
  await user.type(within(sheet).getByLabelText('Modello'), 'Bambu Lab X1C')
  await user.type(within(sheet).getByLabelText('Volume X (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Volume Y (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Volume Z (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Potenza (W)'), '180')
}

test('the hourly cost can be calculated from the purchase cost and the life', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  await fillBasics(user, sheet)
  await user.selectOptions(
    within(sheet).getByLabelText('Calcolo del costo orario'),
    "Calcola dal costo d'acquisto",
  )
  expect(within(sheet).queryByLabelText('Costo orario')).not.toBeInTheDocument()
  await user.type(within(sheet).getByLabelText("Costo d'acquisto"), '500')
  expect(within(sheet).getByText('—')).toBeInTheDocument()
  await user.type(within(sheet).getByLabelText('Vita stimata (ore)'), '600')
  expect(within(sheet).getByText(/0,83/)).toBeInTheDocument()
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'insert',
    filters: [],
    values: expect.objectContaining({
      hourly_rate: 0.83,
      purchase_cost: 500,
      lifetime_hours: 600,
    }),
  })
})

test('purchase mode asks for both values and does not save without them', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  await fillBasics(user, sheet)
  await user.selectOptions(
    within(sheet).getByLabelText('Calcolo del costo orario'),
    "Calcola dal costo d'acquisto",
  )
  await user.type(within(sheet).getByLabelText("Costo d'acquisto"), '500')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  expect(await within(sheet).findByText('Campo obbligatorio.')).toBeInTheDocument()
  expect(db.calls('printers').filter((call) => call.op === 'insert')).toHaveLength(0)
})

test('a printer with a purchase cost reopens in purchase mode and can be corrected', async () => {
  const bought = printerRow({
    id: 1,
    name: 'MK4 #1',
    hourly_rate: 0.83,
    purchase_cost: 500,
    lifetime_hours: 600,
  })
  const { db, user } = renderApp('/printers', { session, tables: { printers: [bought] } })
  const sheet = await openEdit(user)
  expect(within(sheet).getByLabelText('Calcolo del costo orario')).toHaveValue('purchase')
  const hours = within(sheet).getByLabelText('Vita stimata (ore)')
  expect(hours).toHaveValue('600')
  await user.clear(hours)
  await user.type(hours, '1000')
  expect(within(sheet).getByText(/0,50/)).toBeInTheDocument()
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() =>
    expect(db.calls('printers')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: expect.objectContaining({ hourly_rate: 0.5, lifetime_hours: 1000 }),
    }),
  )
})

test('switching back to a typed rate keeps the calculated one and clears the purchase figures', async () => {
  const bought = printerRow({
    id: 1,
    name: 'MK4 #1',
    hourly_rate: 0.83,
    purchase_cost: 500,
    lifetime_hours: 600,
  })
  const { db, user } = renderApp('/printers', { session, tables: { printers: [bought] } })
  const sheet = await openEdit(user)
  await user.selectOptions(
    within(sheet).getByLabelText('Calcolo del costo orario'),
    'Inserisci direttamente',
  )
  expect(within(sheet).getByLabelText('Costo orario')).toHaveValue('0,83')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() =>
    expect(db.calls('printers')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: expect.objectContaining({
        hourly_rate: 0.83,
        purchase_cost: null,
        lifetime_hours: null,
      }),
    }),
  )
})

test('shows field errors and does not save invalid values', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  const nozzle = within(sheet).getByLabelText('Ugello (mm)')
  await user.clear(nozzle)
  await user.type(nozzle, '0')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  expect((await within(sheet).findAllByText('Campo obbligatorio.')).length).toBeGreaterThan(0)
  expect(within(sheet).getByText('Deve essere maggiore di zero.')).toBeInTheDocument()
  expect(db.calls('printers').filter((call) => call.op === 'insert')).toHaveLength(0)
})

test('edits a printer', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  expect(within(sheet).getByLabelText('Ugello (mm)')).toHaveValue('0,40')
  const name = within(sheet).getByLabelText('Nome')
  await user.clear(name)
  await user.type(name, 'MK4 #2')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: expect.objectContaining({ name: 'MK4 #2', hourly_rate: 1.5, nozzle_diameter_mm: 0.4 }),
  })
})

test('a duplicate name is shown under the name field', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  await user.type(within(sheet).getByLabelText('Nome'), 'x')
  db.failNext('printers', {
    code: '23505',
    message: 'duplicate key value violates unique constraint "printers_name_key"',
  })
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(
    await within(sheet).findByText('Esiste già una stampante con questo nome.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Modifica stampante' })).toBeInTheDocument()
})

test('a save that changes no row shows an error instead of closing', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  await user.type(within(sheet).getByLabelText('Nome'), 'x')
  db.failNext('printers', {
    code: 'PGRST116',
    message: 'Cannot coerce the result to a single JSON object',
  })
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(
    await within(sheet).findByText("L'elemento non esiste più o non puoi modificarlo."),
  ).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Modifica stampante' })).toBeInTheDocument()
})

test('owners switch a printer off from the list', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  await user.click(await screen.findByRole('switch', { name: 'Attiva/disattiva MK4 #1' }))
  await waitFor(() =>
    expect(db.calls('printers')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Attiva/disattiva MK4 #1' })).not.toBeChecked(),
  )
})

test('deletes a printer after confirmation', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  await user.click(await screen.findByRole('button', { name: 'Elimina MK4 #1' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare la stampante MK4 #1?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))

  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 1]] })
  expect(await screen.findByText('Nessuna stampante.')).toBeInTheDocument()
})

test('a printer in use can be deactivated instead', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  await user.click(await screen.findByRole('button', { name: 'Elimina MK4 #1' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare la stampante MK4 #1?' })
  db.failNext('printers', { code: '23503', message: 'violates foreign key constraint' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'La stampante è usata in alcuni preventivi: puoi disattivarla invece di eliminarla.',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva invece' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { active: false },
  })
})

test('closing a changed form asks before discarding', async () => {
  const { user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  await user.type(within(sheet).getByLabelText('Nome'), 'x')
  await user.click(within(sheet).getByRole('button', { name: 'Chiudi' }))
  await user.click(await screen.findByRole('button', { name: 'Scarta' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
