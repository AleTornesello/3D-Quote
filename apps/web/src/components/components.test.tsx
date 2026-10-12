import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { createQueryClient } from '@/lib/query-client'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { DataTable } from './DataTable'
import { FormSheet } from './FormSheet'

type Item = { id: number; name: string }

function List({ load }: { load: () => Promise<Item[]> }) {
  const query = useQuery({ queryKey: ['items'], queryFn: load })
  return (
    <DataTable
      query={query}
      caption="Items"
      empty="Nothing here"
      rowKey={(item) => item.id}
      columns={[{ key: 'name', header: 'Name', cell: (item) => item.name }]}
    />
  )
}

function renderList(load: () => Promise<Item[]>) {
  render(
    <QueryClientProvider client={createQueryClient({ retry: false })}>
      <List load={load} />
    </QueryClientProvider>,
  )
}

test('DataTable shows a loading state, then the rows', async () => {
  renderList(async () => [{ id: 1, name: 'MK4' }])
  expect(screen.getByRole('status', { name: 'Caricamento…' })).toBeInTheDocument()
  expect(await screen.findByRole('cell', { name: 'MK4' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
})

test('DataTable shows the empty state', async () => {
  renderList(async () => [])
  expect(await screen.findByText('Nothing here')).toBeInTheDocument()
})

test('DataTable shows a failed load with Retry', async () => {
  const load = vi
    .fn<() => Promise<Item[]>>()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce([{ id: 1, name: 'MK4' }])
  renderList(load)
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  await userEvent.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(await screen.findByRole('cell', { name: 'MK4' })).toBeInTheDocument()
})

function SheetHarness({ dirty }: { dirty: boolean }) {
  const [open, setOpen] = useState(true)
  if (!open) return <p>Closed</p>
  return (
    <FormSheet title="Edit" dirty={dirty} onClose={() => setOpen(false)}>
      <p>Body</p>
    </FormSheet>
  )
}

test('FormSheet closes at once when nothing changed', async () => {
  render(<SheetHarness dirty={false} />)
  await userEvent.click(screen.getByRole('button', { name: 'Chiudi' }))
  expect(await screen.findByText('Closed')).toBeInTheDocument()
})

test('FormSheet asks before discarding changes', async () => {
  render(<SheetHarness dirty />)
  await userEvent.keyboard('{Escape}')
  const confirm = await screen.findByRole('alertdialog', { name: 'Modifiche non salvate' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Continua a modificare' }))
  expect(screen.getByRole('dialog', { name: 'Edit' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Chiudi' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Scarta' }))
  expect(await screen.findByText('Closed')).toBeInTheDocument()
})

test('ConfirmDeleteDialog names the item, shows errors and offers an alternative', async () => {
  const onConfirm = vi.fn()
  const onAlternative = vi.fn()
  const { rerender } = render(
    <ConfirmDeleteDialog
      title="Eliminare MK4?"
      pending={false}
      onConfirm={onConfirm}
      onCancel={() => {}}
    />,
  )
  const dialog = screen.getByRole('alertdialog', { name: 'Eliminare MK4?' })
  expect(within(dialog).getByText("L'operazione non si può annullare.")).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(onConfirm).toHaveBeenCalled()

  rerender(
    <ConfirmDeleteDialog
      title="Eliminare MK4?"
      pending={false}
      error="In uso"
      alternative={{ label: 'Disattiva invece', onClick: onAlternative }}
      onConfirm={onConfirm}
      onCancel={() => {}}
    />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent('In uso')
  await userEvent.click(screen.getByRole('button', { name: 'Disattiva invece' }))
  expect(onAlternative).toHaveBeenCalled()
})

test('native selects are 44px tall on touch screens', () => {
  render(
    <NativeSelect aria-label="Tipo">
      <NativeSelectOption value="a">A</NativeSelectOption>
    </NativeSelect>,
  )
  expect(screen.getByLabelText('Tipo')).toHaveClass('pointer-coarse:h-11')
})
