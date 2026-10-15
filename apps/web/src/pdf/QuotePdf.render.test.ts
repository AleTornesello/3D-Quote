// @vitest-environment node
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { expect, test } from 'vitest'
import { QuotePdf } from './QuotePdf'
import { sampleQuotePdfData } from './sample-data'
import type { QuotePdfData } from './quote-pdf-data'

/** The text of each page of the rendered PDF. */
async function pagesOf(data: QuotePdfData): Promise<string[]> {
  const buffer = await renderToBuffer(QuotePdf({ data }))
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const pages: string[] = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent()
    pages.push(content.items.map((entry) => ('str' in entry ? entry.str : '')).join(' '))
  }
  return pages
}

test('prints the header, client, rows, totals, notes, terms and footer', async () => {
  const [page] = await pagesOf(sampleQuotePdfData())
  for (const text of [
    '3D Lab',
    'P.IVA IT01234567890',
    'Preventivo',
    'Q-2026-0042',
    'Valido fino al',
    '11/11/2026',
    'Cliente',
    'Rossi Meccanica',
    'Descrizione',
    'Staffa 1',
    'PLA · Black',
    'Imponibile',
    'IVA (22 %)',
    'Totale IVA inclusa',
    '73,20 €',
    'Note',
    'Colore da confermare',
    'Consegna in 10 giorni lavorativi.',
    'Pagina 1 di 1',
  ]) {
    expect(page).toContain(text)
  }
})

test('prints the consumables table before the totals', async () => {
  const base = sampleQuotePdfData()
  const [page] = await pagesOf(
    sampleQuotePdfData({
      consumables: {
        title: 'Consumabili',
        columns: { ...base.columns, material: 'Unità' },
        rows: [
          {
            description: 'Vite M3',
            material: 'pz',
            quantity: '3',
            unitPrice: '0,10 €',
            total: '0,30 €',
          },
        ],
      },
    }),
  )
  expect(page).toContain('Consumabili')
  expect(page).toContain('Vite M3')
  expect(page.indexOf('Vite M3')).toBeLessThan(page.indexOf('Imponibile'))
})

test('a draft carries the watermark and a sent quote does not', async () => {
  const [draft] = await pagesOf(sampleQuotePdfData({ watermark: 'BOZZA' }))
  const [sent] = await pagesOf(sampleQuotePdfData({ watermark: null }))
  expect(draft).toContain('BOZZA')
  expect(sent).not.toContain('BOZZA')
})

test('empty optional parts leave no trace', async () => {
  const [page] = await pagesOf(
    sampleQuotePdfData({ notes: null, terms: null, shop: { name: null, lines: [] } }),
  )
  expect(page).not.toContain('Note')
  expect(page).not.toContain('Consegna')
  expect(page).not.toContain('undefined')
  expect(page).not.toContain('null')
})

test('a long quote continues on the next pages with the table header repeated', async () => {
  const pages = await pagesOf(sampleQuotePdfData({}, 40))
  expect(pages.length).toBeGreaterThan(1)
  pages.forEach((page, index) => {
    // Every page that holds item rows repeats the header.
    if (page.includes('Staffa')) expect(page).toContain('Descrizione')
    expect(page).toContain(`Pagina ${index + 1} di ${pages.length}`)
  })
  expect(pages.filter((page) => page.includes('Staffa')).length).toBeGreaterThan(1)
  expect(pages.join(' ')).toContain('Staffa 40')
  expect(pages[0]).not.toContain('Staffa 40')
})

test('the table header is not repeated on a page without table rows', async () => {
  // 25 rows fill page 1; the totals spill over to page 2.
  const pages = await pagesOf(sampleQuotePdfData({}, 25))
  expect(pages).toHaveLength(2)
  expect(pages[0]).toContain('Descrizione')
  expect(pages[0]).toContain('Staffa 25')
  expect(pages[1]).toContain('Totale IVA inclusa')
  expect(pages[1]).not.toContain('Staffa')
  expect(pages[1]).not.toContain('Descrizione')
})

test('very long terms on their own page do not get a table header', async () => {
  const terms = Array.from({ length: 120 }, (_, n) => `Condizione numero ${n + 1}.`).join('\n')
  const pages = await pagesOf(sampleQuotePdfData({ terms }, 2))
  expect(pages.length).toBeGreaterThan(1)
  const last = pages[pages.length - 1]
  expect(last).toContain('Condizione numero 120.')
  expect(last).not.toContain('Staffa')
  expect(last).not.toContain('Descrizione')
  expect(pages[0]).toContain('Descrizione')
})
