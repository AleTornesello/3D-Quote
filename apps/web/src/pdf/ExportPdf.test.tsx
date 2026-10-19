import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  materialRow,
  operatorStaff,
  plateMaterialRow,
  printerRow,
  quotePlateRow,
  quoteRow,
  settingsRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'
import { downloadBlob } from './download'
import { loadLogoDataUrl } from './logo'

vi.mock('./download', () => ({ downloadBlob: vi.fn() }))
vi.mock('./logo', () => ({ loadLogoDataUrl: vi.fn() }))

const session = fakeSession()

const priced = {
  printer_id: 11,
  print_time_s: 3600,
  materials: [plateMaterialRow({ material_id: 21, grams: 25 })],
  computed_total: 30,
  plate_total: 30,
  priced_at: '2026-10-13T09:00:00Z',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
  vi.mocked(downloadBlob).mockReset()
  vi.mocked(loadLogoDataUrl).mockReset()
})
afterEach(() => vi.useRealTimers())

function renderEditor(
  opts: {
    quote?: Record<string, unknown>
    plates?: Record<string, unknown>[]
    staff?: typeof operatorStaff
    settings?: Record<string, unknown>
  } = {},
) {
  return renderApp('/quotes/7', {
    session,
    staff: opts.staff,
    tables: {
      settings: [{ ...settingsRow, ...opts.settings }],
      quotes: [quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, ...opts.quote })],
      clients: [clientRow({ id: 1, name: 'Mario Rossi' })],
      quote_plates: opts.plates ?? [quotePlateRow({ id: 31, ...priced })],
      printers: [printerRow({ id: 11 })],
      materials: [materialRow({ id: 21 })],
    },
  })
}

const exportButton = () => screen.findByRole('button', { name: 'Esporta PDF' })

test('Export PDF is offered in every status, to operators too', async () => {
  for (const status of ['draft', 'sent', 'accepted', 'rejected', 'expired']) {
    const quote =
      status === 'draft' ? {} : { status, vat_rate_pct: 22, sent_at: '2026-10-12T08:00:00Z' }
    const { unmount } = renderEditor({ quote, staff: operatorStaff })
    // The plates load after the page: the button is disabled until then.
    const button = await exportButton()
    await waitFor(() => expect(button).toBeEnabled())
    unmount()
  }
})

test('Export PDF waits until every plate is complete and priced', async () => {
  renderEditor({ plates: [quotePlateRow({ id: 31, ...priced }), quotePlateRow({ id: 32 })] })
  expect(await exportButton()).toBeDisabled()
  expect(
    await screen.findByText(
      "Ogni piatto deve avere stampante, tempo di stampa, materiale e prezzo prima dell'esportazione.",
    ),
  ).toBeInTheDocument()
})

test('Export PDF waits for the consumable lines, which belong in the document', async () => {
  const { db } = renderEditor()
  // The editor only asks for the lines once the quote has loaded, so this reaches that request.
  db.failNext('quote_consumables', { code: '', message: 'TypeError: Failed to fetch' })
  const button = await exportButton()
  expect(button).toBeDisabled()
  await waitFor(() => expect(db.calls('quote_consumables').length).toBeGreaterThan(0))
  expect(await screen.findByText('Caricamento consumabili…')).toBeInTheDocument()
  expect(button).toBeDisabled()
})

test('Export PDF is disabled for a quote without plates', async () => {
  renderEditor({ plates: [] })
  const button = await exportButton()
  expect(button).toBeDisabled()
  const hint = await screen.findByText('Aggiungi almeno un piatto prima di esportare.')
  expect(button).toHaveAttribute('aria-describedby', hint.id)
})

test('the dialog offers the UI language and builds the PDF in the chosen one', async () => {
  const { user, pdf } = renderEditor({ quote: { notes: 'Colore da confermare' } })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog', { name: 'Esporta Q-2026-0007' })
  expect(within(dialog).getByRole('radio', { name: 'Italiano' })).toBeChecked()
  expect(
    within(dialog).getByText('I PDF delle bozze hanno la filigrana BOZZA.'),
  ).toBeInTheDocument()

  await user.click(within(dialog).getByRole('radio', { name: 'English' }))
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))

  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('Q-2026-0007-Mario-Rossi.pdf')
  expect(pdf.rendered).toHaveLength(1)
  expect(pdf.rendered[0]).toMatchObject({
    language: 'en',
    title: 'Quote',
    number: 'Q-2026-0007',
    watermark: 'DRAFT',
    notes: { text: 'Colore da confermare' },
  })
  expect(pdf.rendered[0].meta[0].value).toBe('14/10/2026')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('a sent quote is exported with its frozen rate and no watermark or draft note', async () => {
  const { user, pdf } = renderEditor({
    quote: { status: 'sent', sent_at: '2026-10-12T08:00:00Z', vat_rate_pct: 10 },
  })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).queryByText(/filigrana/)).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(pdf.rendered).toHaveLength(1))
  expect(pdf.rendered[0].watermark).toBeNull()
  expect(pdf.rendered[0].totals[1].label).toBe('IVA (10 %)')
  expect(pdf.rendered[0].meta[0].value).toBe('12/10/2026')
})

test('a failing renderer keeps the dialog open with an error, and Download can be retried', async () => {
  const { user, pdf } = renderEditor()
  pdf.failWith = new Error('boom')
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Impossibile creare il PDF. Riprova.',
  )
  expect(downloadBlob).not.toHaveBeenCalled()

  pdf.failWith = null
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
})

test('the logo goes into the PDF when it loads', async () => {
  vi.mocked(loadLogoDataUrl).mockResolvedValue('data:image/png;base64,AAAA')
  const { user, pdf } = renderEditor({ settings: { shop_logo_path: 'logo-1.png' } })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Scarica' })).toBeEnabled())
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(pdf.rendered).toHaveLength(1))
  expect(loadLogoDataUrl).toHaveBeenCalledWith('https://storage.test/branding/logo-1.png')
  expect(pdf.rendered[0].logo).toBe('data:image/png;base64,AAAA')
})

test('a logo that cannot be loaded gives a warning, and the PDF is still created', async () => {
  vi.mocked(loadLogoDataUrl).mockRejectedValue(new Error('404'))
  const { user, pdf } = renderEditor({ settings: { shop_logo_path: 'logo-1.png' } })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Scarica' })).toBeEnabled())
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(pdf.rendered).toHaveLength(1))
  expect(pdf.rendered[0].logo).toBeNull()
  expect(
    await screen.findByText('Impossibile caricare il logo: il PDF è stato creato senza.'),
  ).toBeInTheDocument()
  expect(downloadBlob).toHaveBeenCalledTimes(1)
})
