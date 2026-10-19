import { addDays } from '@/lib/format'

/** Pure rules behind the quotes screens (spec: docs/superpowers/specs/2026-10-13-web-quotes-design.md). */

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const QUOTE_SORTS = ['number', 'created', 'valid_until', 'total'] as const
export type QuoteSort = (typeof QUOTE_SORTS)[number]
export type SortDir = 'asc' | 'desc'

export type QuoteListParams = {
  q: string
  status: QuoteStatus[]
  client: number | null
  from: string | null
  to: string | null
  sort: QuoteSort
  dir: SortDir
  page: number
}

export const DEFAULT_QUOTE_LIST: QuoteListParams = {
  q: '',
  status: [],
  client: null,
  from: null,
  to: null,
  sort: 'created',
  dir: 'desc',
  page: 1,
}

function positiveInt(text: string | null): number | null {
  if (!text || !/^\d+$/.test(text)) return null
  const value = Number(text)
  return value > 0 && Number.isSafeInteger(value) ? value : null
}

/** A real calendar date written yyyy-mm-dd (2026-02-30 is not). */
function dateParam(text: string | null): string | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null
}

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value)
}

/** The list's search, filters, sort and page from the URL; anything malformed falls back to its default. */
export function parseQuoteListParams(search: URLSearchParams): QuoteListParams {
  const statuses = (search.get('status') ?? '').split(',')
  const sort = search.get('sort')
  const dir = search.get('dir')
  return {
    q: search.get('q') ?? '',
    status: QUOTE_STATUSES.filter((status) => statuses.includes(status)),
    client: positiveInt(search.get('client')),
    from: dateParam(search.get('from')),
    to: dateParam(search.get('to')),
    sort: isOneOf(QUOTE_SORTS, sort) ? sort : DEFAULT_QUOTE_LIST.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_QUOTE_LIST.dir,
    page: positiveInt(search.get('page')) ?? 1,
  }
}

/** The URL for `params`, without the values that are already the defaults. */
export function toQuoteListSearch(params: QuoteListParams): URLSearchParams {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status.length) search.set('status', params.status.join(','))
  if (params.client !== null) search.set('client', String(params.client))
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.sort !== DEFAULT_QUOTE_LIST.sort) search.set('sort', params.sort)
  if (params.dir !== DEFAULT_QUOTE_LIST.dir) search.set('dir', params.dir)
  if (params.page !== 1) search.set('page', String(params.page))
  return search
}

export function hasFilters(params: QuoteListParams): boolean {
  return (
    params.q.trim() !== '' ||
    params.status.length > 0 ||
    params.client !== null ||
    params.from !== null ||
    params.to !== null
  )
}

/** A sent quote whose valid-until date is between today and a week from today (shop dates). */
export function expiresSoon(quote: { status: string; valid_until: string }, today: string) {
  return (
    quote.status === 'sent' && quote.valid_until >= today && quote.valid_until <= addDays(today, 7)
  )
}

type PlateShape = {
  printer_id: number | null
  print_time_s: number | null
  materials: { grams: number }[]
}

/** A plate can be priced: it has a printer, a print time and at least one material. */
export function isPlateComplete(plate: PlateShape): boolean {
  return plate.printer_id !== null && plate.print_time_s !== null && plate.materials.length > 0
}

export function incompletePlates<T extends PlateShape>(plates: T[]): T[] {
  return plates.filter((plate) => !isPlateComplete(plate))
}

/** Complete plates `price-quote` would price that have no price yet. */
export function unpricedPlates<T extends PlateShape & { priced_at: string | null }>(
  plates: T[],
): T[] {
  return plates.filter((plate) => isPlateComplete(plate) && plate.priced_at === null)
}

/** "h:mm" (minutes 00–59, at least one minute in total) as seconds, or null. */
export function parseDuration(text: string): number | null {
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(text.trim())
  if (!match) return null
  const seconds = (Number(match[1]) * 60 + Number(match[2])) * 60
  return seconds > 0 ? seconds : null
}

/** The quote's frozen VAT rate, or the shop's while it is a draft; null while settings are still loading. */
export function vatRateFor(
  quote: { vat_rate_pct: number | null },
  settings: { vat_rate_pct: number } | undefined,
): number | null {
  return quote.vat_rate_pct ?? settings?.vat_rate_pct ?? null
}

export type QuoteTotals = { net: number; vat: number; gross: number }

/**
 * Net (the plate totals plus the consumable lines), VAT and gross, worked out in integer cents. VAT is rounded
 * half-up once, on the net. Null without plates, or while any plate is incomplete or has no price: an override on
 * an incomplete plate does not make the total appear.
 */
export function quoteTotals(
  plates: (PlateShape & { plate_total: number | null })[],
  ratePct: number,
  consumables: { line_total: number }[] = [],
): QuoteTotals | null {
  if (plates.length === 0 || plates.some((p) => !isPlateComplete(p) || p.plate_total === null)) {
    return null
  }
  const plateCents = plates.reduce((sum, p) => sum + Math.round((p.plate_total as number) * 100), 0)
  const netCents = consumables.reduce(
    (sum, line) => sum + Math.round(line.line_total * 100),
    plateCents,
  )
  // The rate in hundredths of a percent keeps the maths in integers.
  const rateBasisPoints = Math.round(ratePct * 100)
  const vatCents = Math.floor((netCents * rateBasisPoints + 5000) / 10000)
  return { net: netCents / 100, vat: vatCents / 100, gross: (netCents + vatCents) / 100 }
}

const FORBIDDEN_IN_FILE_NAMES = /[\\/:*?"<>|]/g

/** `<number>-<client name>.pdf` with anything a file system dislikes removed (functional analysis §6). */
export function pdfFileName(number: string, clientName: string): string {
  const client = [...clientName.replace(FORBIDDEN_IN_FILE_NAMES, '')]
    .filter((char) => char.charCodeAt(0) >= 0x20)
    .join('')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  return client ? `${number}-${client}.pdf` : `${number}.pdf`
}
