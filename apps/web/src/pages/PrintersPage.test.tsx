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
  expect(within(row).getByText('FDM')).toBeInTheDocument()
  expect(within(row).getByText('1,50 €/h')).toBeInTheDocument()
  expect(within(row).getByText('120 W')).toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/printers', { session })
  expect(await screen.findByText('Nessuna stampante.')).toBeInTheDocument()
})

test('filters the list by printer type', async () => {
  const { user } = renderApp('/printers', {
    session,
    tables: { printers: [mk4(), printerRow({ id: 2, name: 'Form 4', type: 'SLA' })] },
  })
  await screen.findByRole('row', { name: /Form 4/ })
  const filter = screen.getByRole('combobox', { name: 'Filtra per tipo' })
  expect(filter).toHaveValue('')

  await user.selectOptions(filter, 'SLA')
  expect(screen.getByRole('row', { name: /Form 4/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /MK4 #1/ })).not.toBeInTheDocument()

  await user.selectOptions(filter, 'FDM')
  expect(screen.getByRole('row', { name: /MK4 #1/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Form 4/ })).not.toBeInTheDocument()

  await user.selectOptions(filter, 'Tutti i tipi')
  expect(screen.getByRole('row', { name: /MK4 #1/ })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Form 4/ })).toBeInTheDocument()
})

test('says when no printer has the chosen type', async () => {
  const { user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  await screen.findByRole('row', { name: /MK4 #1/ })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filtra per tipo' }), 'SLA')
  expect(screen.getByText('Nessuna stampante di questo tipo.')).toBeInTheDocument()
})

const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)

test('sorts by name by default, numbers in names in numeric order', async () => {
  renderApp('/printers', {
    session,
    tables: {
      printers: [
        printerRow({ id: 1, name: 'MK4 #10' }),
        printerRow({ id: 2, name: 'mk4 #2' }),
        printerRow({ id: 3, name: 'Form 4' }),
      ],
    },
  })
  await screen.findByRole('row', { name: /Form 4/ })
  expect(names()).toEqual(['Form 4', 'mk4 #2', 'MK4 #10'])
  expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
})

test('a header click sorts by that column, numbers from the highest; a second click reverses it', async () => {
  const { user } = renderApp('/printers', {
    session,
    tables: {
      printers: [
        printerRow({ id: 1, name: 'A', hourly_rate: 2, type: 'SLA' }),
        printerRow({ id: 2, name: 'B', hourly_rate: 3, type: 'FDM' }),
        printerRow({ id: 3, name: 'C', hourly_rate: 2, type: 'FDM' }),
      ],
    },
  })
  await screen.findByRole('row', { name: /^A/ })

  await user.click(screen.getByRole('button', { name: 'Costo orario' }))
  // Equal rates keep the name order.
  expect(names()).toEqual(['B', 'A', 'C'])
  expect(screen.getByRole('columnheader', { name: 'Costo orario' })).toHaveAttribute(
    'aria-sort',
    'descending',
  )
  await user.click(screen.getByRole('button', { name: 'Costo orario' }))
  expect(names()).toEqual(['A', 'C', 'B'])

  await user.click(screen.getByRole('button', { name: 'Tipo' }))
  expect(names()).toEqual(['B', 'C', 'A'])
  expect(screen.getByRole('columnheader', { name: 'Tipo' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
})

test('the sort applies to the filtered list too', async () => {
  const { user } = renderApp('/printers', {
    session,
    tables: {
      printers: [
        printerRow({ id: 1, name: 'A', power_w: 100 }),
        printerRow({ id: 2, name: 'B', power_w: 300 }),
        printerRow({ id: 3, name: 'C', power_w: 200, type: 'SLA' }),
      ],
    },
  })
  await screen.findByRole('row', { name: /^A/ })
  await user.click(screen.getByRole('button', { name: 'Potenza' }))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filtra per tipo' }), 'FDM')
  expect(names()).toEqual(['B', 'A'])
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
  await user.type(within(sheet).getByLabelText('Costo orario'), '2,5')
  await user.type(within(sheet).getByLabelText('Potenza (W)'), '180')
  await user.type(within(sheet).getByLabelText('Tasso di fallimento (%)'), '5')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'insert',
    filters: [],
    values: {
      name: 'X1C #1',
      model: 'Bambu Lab X1C',
      type: 'FDM',
      hourly_rate: 2.5,
      purchase_cost: null,
      lifetime_hours: null,
      power_w: 180,
      failure_rate: 5,
      active: true,
    },
  })
  expect(await screen.findByRole('row', { name: /X1C #1/ })).toBeInTheDocument()
})

async function fillBasics(user: ReturnType<typeof renderApp>['user'], sheet: HTMLElement) {
  await user.type(within(sheet).getByLabelText('Nome'), 'X1C #1')
  await user.type(within(sheet).getByLabelText('Modello'), 'Bambu Lab X1C')
  await user.type(within(sheet).getByLabelText('Potenza (W)'), '180')
}

test('the failure rate must be a whole number from 0 to 100', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  await fillBasics(user, sheet)
  await user.type(within(sheet).getByLabelText('Costo orario'), '2')
  const rate = within(sheet).getByLabelText('Tasso di fallimento (%)')
  await user.clear(rate)
  await user.type(rate, '101')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(await within(sheet).findByText(/tra 0 e 100/i)).toBeInTheDocument()
  expect(db.calls('printers').filter((c) => c.op === 'insert')).toHaveLength(0)
})

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

test('a new printer is FDM by default and can be made SLA', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  const type = within(sheet).getByLabelText('Tipo')
  expect(type).toHaveValue('FDM')
  await fillBasics(user, sheet)
  await user.selectOptions(type, 'SLA')
  await user.type(within(sheet).getByLabelText('Costo orario'), '3')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() =>
    expect(db.calls('printers')).toContainEqual({
      op: 'insert',
      filters: [],
      values: expect.objectContaining({ type: 'SLA' }),
    }),
  )
})

test('the type of an existing printer can be changed', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  await user.selectOptions(within(sheet).getByLabelText('Tipo'), 'SLA')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() =>
    expect(db.calls('printers')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: expect.objectContaining({ type: 'SLA' }),
    }),
  )
})

test('shows field errors and does not save invalid values', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  await user.type(within(sheet).getByLabelText('Potenza (W)'), '0')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  expect((await within(sheet).findAllByText('Campo obbligatorio.')).length).toBeGreaterThan(0)
  expect(within(sheet).getByText('Deve essere maggiore di zero.')).toBeInTheDocument()
  expect(db.calls('printers').filter((call) => call.op === 'insert')).toHaveLength(0)
})

test('edits a printer', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  expect(within(sheet).getByLabelText('Tipo')).toHaveValue('FDM')
  const name = within(sheet).getByLabelText('Nome')
  await user.clear(name)
  await user.type(name, 'MK4 #2')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: expect.objectContaining({ name: 'MK4 #2', hourly_rate: 1.5, type: 'FDM' }),
  })
})

test('a double-click on a row edits the printer, but not on its Active switch', async () => {
  const { user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const row = await screen.findByRole('row', { name: /MK4 #1/ })
  await user.dblClick(within(row).getByRole('switch'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.dblClick(within(row).getByText('Prusa MK4'))
  expect(await screen.findByRole('dialog', { name: 'Modifica stampante' })).toBeInTheDocument()
})

test('operators cannot open a printer by double-clicking', async () => {
  const { user } = renderApp('/printers', {
    session,
    staff: operatorStaff,
    tables: { printers: [mk4()] },
  })
  await user.dblClick(await screen.findByText('Prusa MK4'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
