import i18n from 'i18next'
import { describe, expect, test } from 'vitest'
import type { QuoteItem } from '@/data/quote-items'
import type { Quote } from '@/data/quotes'
import { materialRow, quoteItemRow, quoteRow, settingsRow } from '@/test/fixtures'
import { toQuotePdfData, type PdfLanguage, type QuotePdfInput } from './quote-pdf-data'

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  ...quoteRow({ id: 7, number: 'Q-2026-0042', valid_until: '2026-11-11' }),
  client: {
    id: 1,
    name: 'Mario Rossi',
    company: 'Rossi Meccanica',
    email: 'mario@example.com',
    phone: '333 1234567',
  },
  creator: { display_name: 'Anna Rossi' },
  ...overrides,
})

const item = (overrides: Record<string, unknown> = {}) =>
  ({
    ...quoteItemRow({
      description: 'Staffa',
      material_id: 21,
      quantity: 3,
      item_total: 30,
      computed_total: 30,
      ...overrides,
    }),
  }) as unknown as QuoteItem

const materials = [materialRow({ id: 21, name: 'Prusament PLA', type: 'PLA', color: 'Black' })]

function build(overrides: Partial<QuotePdfInput> = {}, language: PdfLanguage = 'it') {
  return toQuotePdfData({
    quote: quote(),
    items: [item()],
    materials,
    settings: { ...settingsRow, shop_name: '3D Lab' },
    logo: null,
    language,
    today: '2026-10-14',
    t: i18n.getFixedT(language),
    ...overrides,
  })
}

describe('toQuotePdfData', () => {
  test('formats the quote in Italian', () => {
    const data = build()
    expect(data.title).toBe('Preventivo')
    expect(data.number).toBe('Q-2026-0042')
    expect(data.meta).toEqual([
      { label: 'Data', value: '14/10/2026' },
      { label: 'Valido fino al', value: '11/11/2026' },
    ])
    expect(data.columns.unitPrice).toBe('Prezzo unitario')
    expect(data.rows).toHaveLength(1)
    expect(data.rows[0]).toMatchObject({
      description: 'Staffa',
      material: 'PLA · Black',
      quantity: '3',
    })
    expect(data.rows[0].unitPrice).toMatch(/^10,00/)
    expect(data.totals.map((line) => line.label)).toEqual([
      'Imponibile',
      'IVA (22 %)',
      'Totale IVA inclusa',
    ])
    expect(data.totals[2]).toMatchObject({ strong: true })
    expect(data.totals[2].value).toMatch(/^36,60/)
  })

  test('formats the quote in English', () => {
    const data = build({}, 'en')
    expect(data.title).toBe('Quote')
    expect(data.meta[1]).toEqual({ label: 'Valid until', value: '11/11/2026' })
    expect(data.totals.map((line) => line.label)).toEqual([
      'Net total',
      'VAT (22 %)',
      'Total incl. VAT',
    ])
    expect(data.totals[2].value).toMatch(/36\.60/)
    expect(data.footer).toEqual({ number: 'Q-2026-0042', page: 'Page', of: 'of' })
  })

  test('a sent quote uses the sent date and its frozen rate', () => {
    const data = build({
      quote: quote({ status: 'sent', sent_at: '2026-10-12T08:00:00Z', vat_rate_pct: 10 }),
    })
    expect(data.meta[0]).toEqual({ label: 'Data', value: '12/10/2026' })
    expect(data.totals[1].label).toBe('IVA (10 %)')
    expect(data.totals[2].value).toMatch(/^33,00/)
  })

  test('a 0 % rate still shows the VAT line', () => {
    const data = build({ settings: { ...settingsRow, vat_rate_pct: 0 } })
    expect(data.totals[1].label).toBe('IVA (0 %)')
    expect(data.totals[1].value).toMatch(/^0,00/)
    expect(data.totals[2].value).toBe(data.totals[0].value)
  })

  test('only drafts carry the watermark', () => {
    expect(build().watermark).toBe('BOZZA')
    expect(build({}, 'en').watermark).toBe('DRAFT')
    expect(
      build({ quote: quote({ status: 'sent', vat_rate_pct: 22, sent_at: '2026-10-12T08:00:00Z' }) })
        .watermark,
    ).toBeNull()
  })

  test('skips empty shop and client lines', () => {
    const data = build({
      quote: quote({
        client: { id: 1, name: 'Mario Rossi', company: null, email: '', phone: null },
      }),
      settings: {
        ...settingsRow,
        shop_name: null,
        shop_address: null,
        shop_vat_number: null,
        shop_email: null,
        shop_phone: null,
      },
    })
    expect(data.client.lines).toEqual(['Mario Rossi'])
    expect(data.shop).toEqual({ name: null, lines: [] })
  })

  test('prints a multi-line address line by line, then VAT number, email and phone', () => {
    const data = build({
      settings: {
        ...settingsRow,
        shop_address: 'Via Roma 1\n\n20100 Milano',
        shop_vat_number: 'IT01234567890',
        shop_email: 'info@3dlab.it',
        shop_phone: '02 123456',
      },
    })
    expect(data.shop.lines).toEqual([
      'Via Roma 1',
      '20100 Milano',
      'P.IVA IT01234567890',
      'info@3dlab.it',
      '02 123456',
    ])
  })

  test('shows the material type alone without a colour, and the name for "other"', () => {
    const data = build({
      items: [item({ material_id: 22 }), item({ material_id: 23 })],
      materials: [
        materialRow({ id: 22, name: 'x', type: 'PETG', color: null }),
        materialRow({ id: 23, name: 'Resina speciale', type: 'other', color: 'Clear' }),
      ],
    })
    expect(data.rows.map((row) => row.material)).toEqual(['PETG', 'Resina speciale · Clear'])
  })

  test('notes and terms appear only when present, terms in the chosen language', () => {
    expect(build().notes).toBeNull()
    expect(build().terms).toBeNull()
    const settings = {
      ...settingsRow,
      pdf_terms_it: 'Consegna in 10 giorni.',
      pdf_terms_en: 'Delivery in 10 days.',
    }
    const withNotes = quote({ notes: 'Colore da confermare' })
    expect(build({ quote: withNotes, settings }).notes).toEqual({
      title: 'Note',
      text: 'Colore da confermare',
    })
    expect(build({ settings }).terms).toBe('Consegna in 10 giorni.')
    expect(build({ settings }, 'en').terms).toBe('Delivery in 10 days.')
    expect(build({ settings: { ...settingsRow, pdf_terms_it: '  ' } }).terms).toBeNull()
  })

  test('never includes internal data', () => {
    const data = JSON.stringify(
      build({
        items: [
          item({
            print_time_s: 3600,
            filament_g: 25,
            override_reason: 'Accordo segreto',
            override_total: 30,
          }),
        ],
      }),
    )
    expect(data).not.toContain('Accordo segreto')
    expect(data).not.toContain('3600')
  })

  test('refuses a quote that is not fully priced', () => {
    expect(() => build({ items: [item({ item_total: null })] })).toThrow('quote_not_priced')
    expect(() => build({ items: [] })).toThrow('quote_not_priced')
  })
})
