import type { TFunction } from 'i18next'
import type { Material } from '@/data/materials'
import type { QuoteItem } from '@/data/quote-items'
import { quoteTotals, vatRateFor } from '@/data/quote-rules'
import type { Quote } from '@/data/quotes'
import type { Settings } from '@/data/settings'
import { formatCurrency, formatDate, formatNumber, localeFor } from '@/lib/format'

export type PdfLanguage = 'it' | 'en'

export type QuotePdfRow = {
  description: string
  material: string
  quantity: string
  unitPrice: string
  total: string
}

/** Everything the PDF prints, already translated and formatted: the layout adds no logic. */
export type QuotePdfData = {
  language: PdfLanguage
  logo: string | null
  shop: { name: string | null; lines: string[] }
  title: string
  number: string
  meta: { label: string; value: string }[]
  client: { title: string; lines: string[] }
  columns: QuotePdfRow
  rows: QuotePdfRow[]
  totals: { label: string; value: string; strong: boolean }[]
  notes: { title: string; text: string } | null
  terms: string | null
  watermark: string | null
  footer: { number: string; page: string; of: string }
}

export type QuotePdfInput = {
  quote: Quote
  items: QuoteItem[]
  materials: Pick<Material, 'id' | 'name' | 'type' | 'color'>[]
  settings: Settings
  /** A PNG or JPEG data URL, or null for no logo. */
  logo: string | null
  language: PdfLanguage
  /** Today in shop time (yyyy-mm-dd): the date of a draft. */
  today: string
  /** `i18n.getFixedT(language)` */
  t: TFunction
}

const present = (text: string | null | undefined): text is string =>
  text !== null && text !== undefined && text.trim() !== ''

function materialLabel(materials: QuotePdfInput['materials'], materialId: number | null): string {
  const material = materials.find((candidate) => candidate.id === materialId)
  if (!material) return ''
  const base = material.type === 'other' ? material.name : material.type
  return present(material.color) ? `${base} · ${material.color.trim()}` : base
}

export function toQuotePdfData({
  quote,
  items,
  materials,
  settings,
  logo,
  language,
  today,
  t,
}: QuotePdfInput): QuotePdfData {
  const locale = localeFor(language)
  const money = (value: number) => formatCurrency(value, locale, settings.currency)
  const rate = vatRateFor(quote, settings) ?? settings.vat_rate_pct
  const totals = quoteTotals(items, rate)
  if (totals === null) throw new Error('quote_not_priced')

  const shopLines = [
    ...(settings.shop_address ?? '')
      .split('\n')
      .filter(present)
      .map((line) => line.trim()),
    ...(present(settings.shop_vat_number)
      ? [t('pdf.vatNumber', { value: settings.shop_vat_number.trim() })]
      : []),
    ...[settings.shop_email, settings.shop_phone].filter(present).map((line) => line.trim()),
  ]
  const draft = quote.status === 'draft'
  const terms = language === 'en' ? settings.pdf_terms_en : settings.pdf_terms_it

  return {
    language,
    logo,
    shop: {
      name: present(settings.shop_name) ? settings.shop_name.trim() : null,
      lines: shopLines,
    },
    title: t('pdf.title'),
    number: quote.number,
    meta: [
      {
        label: t('pdf.date'),
        value: formatDate(draft ? today : (quote.sent_at ?? today), locale),
      },
      { label: t('pdf.validUntil'), value: formatDate(quote.valid_until, locale) },
    ],
    client: {
      title: t('pdf.client'),
      lines: [quote.client.name, quote.client.company, quote.client.email, quote.client.phone]
        .filter(present)
        .map((line) => line.trim()),
    },
    columns: {
      description: t('pdf.columns.description'),
      material: t('pdf.columns.material'),
      quantity: t('pdf.columns.quantity'),
      unitPrice: t('pdf.columns.unitPrice'),
      total: t('pdf.columns.total'),
    },
    rows: items.map((item) => ({
      description: item.description,
      material: materialLabel(materials, item.material_id),
      quantity: formatNumber(item.quantity, locale),
      unitPrice: money((item.item_total as number) / item.quantity),
      total: money(item.item_total as number),
    })),
    totals: [
      { label: t('pdf.netTotal'), value: money(totals.net), strong: false },
      {
        label: t('pdf.vat', { rate: formatNumber(rate, locale) }),
        value: money(totals.vat),
        strong: false,
      },
      { label: t('pdf.totalInclVat'), value: money(totals.gross), strong: true },
    ],
    notes: present(quote.notes) ? { title: t('pdf.notes'), text: quote.notes.trim() } : null,
    terms: present(terms) ? terms.trim() : null,
    watermark: draft ? t('pdf.watermark') : null,
    footer: { number: quote.number, page: t('pdf.page'), of: t('pdf.of') },
  }
}
