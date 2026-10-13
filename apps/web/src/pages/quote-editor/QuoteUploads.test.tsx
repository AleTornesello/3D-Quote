import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fromUploadResponse } from '@/data/errors'
import type { Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, materialRow, printerRow, quoteItemRow, quoteRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function renderUploads(opts: { items?: Row[]; status?: string; printers?: Row[] } = {}) {
  return renderApp('/quotes/7', {
    session,
    tables: {
      quotes: [
        quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status: opts.status ?? 'draft' }),
      ],
      clients: [clientRow({ id: 1 })],
      quote_items: opts.items ?? [],
      printers: opts.printers ?? [printerRow({ id: 11, name: 'MK4 #1' })],
      materials: [materialRow({ id: 21 })],
    },
    rpc: { create_quote_item: () => 99 },
  })
}

function stl(name = 'Staffa.stl', size?: number) {
  const file = new File(['solid part'], name, { type: 'model/stl' })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}

async function dropFiles(files: File[]) {
  const zone = await screen.findByRole('group', { name: 'Trascina qui i file STL o 3MF' })
  fireEvent.drop(zone, { dataTransfer: { files } })
}

test('rejects files that are not STL or 3MF, empty or over 100 MB', async () => {
  const { user, uploader } = renderUploads()
  expect(await screen.findByText('Aggiungi i file dei modelli per iniziare.')).toBeInTheDocument()
  await dropFiles([stl('part.obj'), stl('empty.stl', 0), stl('huge.stl', 100 * 1024 * 1024 + 1)])
  expect(
    await screen.findByText('part.obj: sono accettati solo file STL e 3MF.'),
  ).toBeInTheDocument()
  expect(screen.getByText('empty.stl: il file è vuoto.')).toBeInTheDocument()
  expect(screen.getByText('huge.stl: supera i 100 MB.')).toBeInTheDocument()
  expect(uploader.uploads).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Ignora part.obj' }))
  expect(
    screen.queryByText('part.obj: sono accettati solo file STL e 3MF.'),
  ).not.toBeInTheDocument()
})

test("uploads with progress, then creates the item with the previous item's printer and material", async () => {
  const { db, uploader } = renderUploads({
    items: [quoteItemRow({ id: 31, printer_id: 11, material_id: 21 })],
  })
  await screen.findByRole('article', { name: 'Staffa' })
  await dropFiles([stl('Staffa nuova.stl')])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  const upload = uploader.uploads[0]
  expect(upload.path).toMatch(/^7\/[0-9a-f-]{36}\/Staffa nuova\.stl$/)

  await upload.progress(0.5)
  expect(
    screen.getByRole('progressbar', { name: 'Caricamento di Staffa nuova.stl' }),
  ).toHaveAttribute('aria-valuenow', '50')

  await upload.succeed()
  await waitFor(() =>
    expect(db.rpcCalls('create_quote_item')).toEqual([
      {
        quote_id: 7,
        model_path: upload.path,
        original_filename: 'Staffa nuova.stl',
        description: 'Staffa nuova',
        printer_id: 11,
        material_id: 21,
      },
    ]),
  )
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
})

test('leaves printer and material empty when the previous ones are no longer active', async () => {
  const { db, uploader } = renderUploads({
    items: [quoteItemRow({ id: 31, printer_id: 12, material_id: 21 })],
    printers: [printerRow({ id: 12, name: 'MK3 #9', active: false })],
  })
  await screen.findByRole('article', { name: 'Staffa' })
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  await uploader.uploads[0].succeed()
  await waitFor(() => expect(db.rpcCalls('create_quote_item')).toHaveLength(1))
  expect(db.rpcCalls('create_quote_item')[0]).not.toHaveProperty('printer_id')
  expect(db.rpcCalls('create_quote_item')[0]).not.toHaveProperty('material_id')
})

test('a failed upload can be retried without choosing the file again', async () => {
  const { user, uploader } = renderUploads()
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  await uploader.uploads[0].fail(fromUploadResponse(null, ''))
  expect(
    await screen.findByText(
      'Impossibile contattare il server. Controlla la connessione e riprova.',
    ),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Riprova Staffa.stl' }))
  await waitFor(() => expect(uploader.uploads).toHaveLength(2))
  expect(uploader.uploads[1].file).toBe(uploader.uploads[0].file)
  expect(uploader.uploads[1].path).not.toBe(uploader.uploads[0].path)
})

test('runs at most three uploads at once', async () => {
  const { uploader } = renderUploads()
  await dropFiles([stl('a.stl'), stl('b.stl'), stl('c.stl'), stl('d.stl')])
  await waitFor(() => expect(uploader.uploads).toHaveLength(3))
  expect(screen.getByText('In attesa')).toBeInTheDocument()
  await uploader.uploads[0].succeed()
  await waitFor(() => expect(uploader.uploads).toHaveLength(4))
  expect(uploader.uploads[3].file.name).toBe('d.stl')
})

test('Cancel stops an upload', async () => {
  const { user, uploader } = renderUploads()
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: 'Annulla Staffa.stl' }))
  expect(uploader.uploads[0].aborted).toBe(true)
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
})

test("an item that can't be created removes its file and refreshes the quote", async () => {
  const { db, uploader } = renderUploads()
  db.failNext('create_quote_item', { code: 'P0001', message: 'quote_not_draft' })
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  const quoteReads = db.calls('quotes').length
  await uploader.uploads[0].succeed()
  expect(
    await screen.findByText('Il preventivo non è più una bozza e non si può modificare.'),
  ).toBeInTheDocument()
  expect(db.storageCalls('models')).toContainEqual({
    op: 'remove',
    paths: [uploader.uploads[0].path],
  })
  await waitFor(() => expect(db.calls('quotes').length).toBeGreaterThan(quoteReads))
})

test('leaving during an upload asks first, and cancels it', async () => {
  const { user, router, uploader } = renderUploads()
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })
  await user.click(within(nav).getByRole('link', { name: 'Clienti' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Caricamenti in corso' })
  expect(within(dialog).getByText('I caricamenti in corso verranno annullati.')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Scarta' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/clients'))
  expect(uploader.uploads[0].aborted).toBe(true)
})

test('Choose files uploads through the file input', async () => {
  const { user, uploader } = renderUploads()
  await user.upload(await screen.findByLabelText('Scegli file'), stl())
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
})

test('a sent quote has no upload zone', async () => {
  renderUploads({ status: 'sent' })
  await screen.findByRole('heading', { level: 1, name: 'Q-2026-0007' })
  expect(
    screen.queryByRole('group', { name: 'Trascina qui i file STL o 3MF' }),
  ).not.toBeInTheDocument()
})
