import type { QuotePdfData, QuotePdfRow } from './quote-pdf-data'

const row = (n: number): QuotePdfRow => ({
  description: `Staffa ${n}`,
  material: 'PLA · Black 120 g',
  quantity: '3',
  unitPrice: '10,00 €',
  total: '30,00 €',
})

/** A complete, Italian QuotePdfData for the layout tests. */
export function sampleQuotePdfData(
  overrides: Partial<QuotePdfData> = {},
  rowCount = 2,
): QuotePdfData {
  return {
    language: 'it',
    logo: null,
    shop: { name: '3D Lab', lines: ['Via Roma 1', '20100 Milano', 'P.IVA IT01234567890'] },
    title: 'Preventivo',
    number: 'Q-2026-0042',
    meta: [
      { label: 'Data', value: '14/10/2026' },
      { label: 'Valido fino al', value: '11/11/2026' },
    ],
    client: { title: 'Cliente', lines: ['Mario Rossi', 'Rossi Meccanica', 'mario@example.com'] },
    columns: {
      description: 'Descrizione',
      material: 'Materiale',
      quantity: 'Qtà',
      unitPrice: 'Prezzo unitario',
      total: 'Totale',
    },
    rows: Array.from({ length: rowCount }, (_, index) => row(index + 1)),
    consumables: null,
    totals: [
      { label: 'Imponibile', value: '60,00 €', strong: false },
      { label: 'IVA (22 %)', value: '13,20 €', strong: false },
      { label: 'Totale IVA inclusa', value: '73,20 €', strong: true },
    ],
    notes: { title: 'Note', text: 'Colore da confermare' },
    terms: 'Consegna in 10 giorni lavorativi.',
    watermark: null,
    footer: { number: 'Q-2026-0042', page: 'Pagina', of: 'di' },
    ...overrides,
  }
}
