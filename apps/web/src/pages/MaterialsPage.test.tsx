import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { materialRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const pla = () => materialRow({ id: 1, name: 'Prusament PLA' })

test('lists materials with formatted values', async () => {
  renderApp('/materials', {
    session,
    tables: {
      materials: [pla(), materialRow({ id: 2, name: 'Generic', type: 'other', color: null })],
    },
  })
  const row = await screen.findByRole('row', { name: /Prusament PLA/ })
  expect(within(row).getByText('PLA')).toBeInTheDocument()
  expect(within(row).getByText('Black')).toBeInTheDocument()
  expect(within(row).getByText('25,00 €/kg')).toBeInTheDocument()
  expect(within(row).getByText('1,24 g/cm³')).toBeInTheDocument()
  const other = screen.getByRole('row', { name: /Generic/ })
  expect(within(other).getByText('Altro')).toBeInTheDocument()
  expect(within(other).getByText('—')).toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/materials', { session })
  expect(await screen.findByText('Nessun materiale.')).toBeInTheDocument()
})

test('filters the list by material type', async () => {
  const { user } = renderApp('/materials', {
    session,
    tables: {
      materials: [pla(), materialRow({ id: 2, name: 'Generic', type: 'other', color: null })],
    },
  })
  await screen.findByRole('row', { name: /Generic/ })
  const filter = screen.getByRole('combobox', { name: 'Filtra per tipo' })
  expect(filter).toHaveValue('')

  await user.selectOptions(filter, 'Altro')
  expect(screen.getByRole('row', { name: /Generic/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Prusament PLA/ })).not.toBeInTheDocument()

  await user.selectOptions(filter, 'PLA')
  expect(screen.getByRole('row', { name: /Prusament PLA/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Generic/ })).not.toBeInTheDocument()

  await user.selectOptions(filter, 'Tutti i tipi')
  expect(screen.getByRole('row', { name: /Prusament PLA/ })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Generic/ })).toBeInTheDocument()
})

test('says when no material has the chosen type', async () => {
  const { user } = renderApp('/materials', { session, tables: { materials: [pla()] } })
  await screen.findByRole('row', { name: /Prusament PLA/ })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filtra per tipo' }), 'PETG')
  expect(screen.getByText('Nessun materiale corrisponde ai filtri.')).toBeInTheDocument()
})

test('searches the list by name', async () => {
  const { user } = renderApp('/materials', {
    session,
    tables: {
      materials: [pla(), materialRow({ id: 2, name: 'Generic', type: 'other', color: null })],
    },
  })
  await screen.findByRole('row', { name: /Generic/ })
  const search = screen.getByRole('searchbox', { name: 'Cerca per nome' })

  await user.type(search, 'gener')
  expect(screen.getByRole('row', { name: /Generic/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Prusament PLA/ })).not.toBeInTheDocument()

  await user.clear(search)
  await user.type(search, '  PRUSAMENT ')
  expect(screen.getByRole('row', { name: /Prusament PLA/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Generic/ })).not.toBeInTheDocument()

  await user.clear(search)
  expect(screen.getByRole('row', { name: /Prusament PLA/ })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Generic/ })).toBeInTheDocument()
})

test('the search combines with the type filter', async () => {
  const { user } = renderApp('/materials', {
    session,
    tables: { materials: [pla(), materialRow({ id: 2, name: 'Prusament PETG', type: 'PETG' })] },
  })
  await screen.findByRole('row', { name: /Prusament PETG/ })
  await user.type(screen.getByRole('searchbox', { name: 'Cerca per nome' }), 'prusament')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filtra per tipo' }), 'PETG')
  expect(screen.getByRole('row', { name: /Prusament PETG/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Prusament PLA/ })).not.toBeInTheDocument()
})

test('says when no material matches the search', async () => {
  const { user } = renderApp('/materials', { session, tables: { materials: [pla()] } })
  await screen.findByRole('row', { name: /Prusament PLA/ })
  await user.type(screen.getByRole('searchbox', { name: 'Cerca per nome' }), 'nylon')
  expect(screen.getByText('Nessun materiale corrisponde ai filtri.')).toBeInTheDocument()
})

const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)

test('sorts by name by default, numbers in names in numeric order', async () => {
  renderApp('/materials', {
    session,
    tables: {
      materials: [
        materialRow({ id: 1, name: 'PLA #10' }),
        materialRow({ id: 2, name: 'pla #2' }),
        materialRow({ id: 3, name: 'Generic' }),
      ],
    },
  })
  await screen.findByRole('row', { name: /Generic/ })
  expect(names()).toEqual(['Generic', 'pla #2', 'PLA #10'])
  expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
})

test('a header click sorts by that column, numbers from the highest; a second click reverses it', async () => {
  const { user } = renderApp('/materials', {
    session,
    tables: {
      materials: [
        materialRow({ id: 1, name: 'A', cost_per_kg: 20, type: 'PLA' }),
        materialRow({ id: 2, name: 'B', cost_per_kg: 30, type: 'other' }),
        materialRow({ id: 3, name: 'C', cost_per_kg: 20, type: 'ABS' }),
      ],
    },
  })
  await screen.findByRole('row', { name: /^A/ })

  await user.click(screen.getByRole('button', { name: 'Costo al kg' }))
  // Equal costs keep the name order.
  expect(names()).toEqual(['B', 'A', 'C'])
  expect(screen.getByRole('columnheader', { name: 'Costo al kg' })).toHaveAttribute(
    'aria-sort',
    'descending',
  )
  await user.click(screen.getByRole('button', { name: 'Costo al kg' }))
  expect(names()).toEqual(['A', 'C', 'B'])

  // Types sort by the label shown: "Altro", not "other".
  await user.click(screen.getByRole('button', { name: 'Tipo' }))
  expect(names()).toEqual(['C', 'B', 'A'])
  expect(screen.getByRole('columnheader', { name: 'Tipo' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
})

test('materials without a colour stay last either way', async () => {
  const { user } = renderApp('/materials', {
    session,
    tables: {
      materials: [
        materialRow({ id: 1, name: 'A', color: null }),
        materialRow({ id: 2, name: 'B', color: 'White' }),
        materialRow({ id: 3, name: 'C', color: 'Black' }),
      ],
    },
  })
  await screen.findByRole('row', { name: /^A/ })
  await user.click(screen.getByRole('button', { name: 'Colore' }))
  expect(names()).toEqual(['C', 'B', 'A'])
  await user.click(screen.getByRole('button', { name: 'Colore' }))
  expect(names()).toEqual(['B', 'C', 'A'])
})

test('the sort applies to the filtered list too', async () => {
  const { user } = renderApp('/materials', {
    session,
    tables: {
      materials: [
        materialRow({ id: 1, name: 'A', density_g_cm3: 1.1 }),
        materialRow({ id: 2, name: 'B', density_g_cm3: 1.3 }),
        materialRow({ id: 3, name: 'C', density_g_cm3: 1.2, type: 'PETG' }),
      ],
    },
  })
  await screen.findByRole('row', { name: /^A/ })
  await user.click(screen.getByRole('button', { name: 'Densità' }))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filtra per tipo' }), 'PLA')
  expect(names()).toEqual(['B', 'A'])
})

test('operators see the list without owner actions', async () => {
  renderApp('/materials', { session, staff: operatorStaff, tables: { materials: [pla()] } })
  await screen.findByRole('row', { name: /Prusament PLA/ })
  expect(screen.queryByRole('button', { name: 'Nuovo materiale' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Modifica Prusament PLA' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

test('a double-click on a row edits the material, but only for owners', async () => {
  const { user } = renderApp('/materials', { session, tables: { materials: [pla()] } })
  await user.dblClick(await screen.findByText('1,24 g/cm³'))
  expect(await screen.findByRole('dialog', { name: 'Modifica materiale' })).toBeInTheDocument()
})

test('operators cannot open a material by double-clicking', async () => {
  const { user } = renderApp('/materials', {
    session,
    staff: operatorStaff,
    tables: { materials: [pla()] },
  })
  await user.dblClick(await screen.findByText('1,24 g/cm³'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('choosing a type pre-fills density until density is edited by hand', async () => {
  const { db, user } = renderApp('/materials', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo materiale' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo materiale' })
  const type = within(sheet).getByLabelText('Tipo')
  const density = within(sheet).getByLabelText('Densità (g/cm³)')
  expect(density).toHaveValue('1,24')

  await user.selectOptions(type, 'PETG')
  expect(density).toHaveValue('1,27')

  await user.clear(density)
  await user.type(density, '1,30')
  await user.selectOptions(type, 'ABS')
  expect(density).toHaveValue('1,30')

  await user.type(within(sheet).getByLabelText('Nome'), 'Custom ABS')
  await user.type(within(sheet).getByLabelText('Costo al kg'), '30')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('materials')).toContainEqual({
    op: 'insert',
    filters: [],
    values: {
      name: 'Custom ABS',
      type: 'ABS',
      color: null,
      cost_per_kg: 30,
      density_g_cm3: 1.3,
      active: true,
    },
  })
})

test('Other leaves density as it is', async () => {
  const { user } = renderApp('/materials', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo materiale' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo materiale' })
  await user.selectOptions(within(sheet).getByLabelText('Tipo'), 'other')
  expect(within(sheet).getByLabelText('Densità (g/cm³)')).toHaveValue('1,24')
})

test('a material in use can be deactivated instead', async () => {
  const { db, user } = renderApp('/materials', { session, tables: { materials: [pla()] } })
  await user.click(await screen.findByRole('button', { name: 'Elimina Prusament PLA' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Eliminare il materiale Prusament PLA?',
  })
  db.failNext('materials', { code: '23503', message: 'violates foreign key constraint' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Il materiale è usato in alcuni preventivi: puoi disattivarlo invece di eliminarlo.',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva invece' }))
  await waitFor(() =>
    expect(db.calls('materials')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
})

test('owners switch a material off from the list', async () => {
  const { db, user } = renderApp('/materials', { session, tables: { materials: [pla()] } })
  await user.click(await screen.findByRole('switch', { name: 'Attiva/disattiva Prusament PLA' }))
  await waitFor(() =>
    expect(db.calls('materials')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
})
