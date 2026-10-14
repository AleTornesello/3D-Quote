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

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** An item's newest slicing job, as the items query embeds it. */
export type ItemJob = {
  id: number
  status: JobStatus
  error: string | null
  queued_at: string
  started_at: string | null
  finished_at: string | null
}

type SlicingInput = {
  printer_id: number | null
  material_id: number | null
  print_time_s: number | null
  job: ItemJob | null
}

export type SlicingState =
  | { kind: 'waiting' }
  | { kind: 'queued' }
  | { kind: 'slow' }
  | { kind: 'slicing'; elapsedS: number }
  | { kind: 'done' }
  | { kind: 'failed'; error: string | null }

export const SLOW_QUEUE_MS = 10 * 60 * 1000

/** What the item card shows about slicing (functional analysis §7). */
export function slicingState(item: SlicingInput, now: number): SlicingState {
  if (item.printer_id === null || item.material_id === null) return { kind: 'waiting' }
  const job = item.job
  if (job?.status === 'failed') return { kind: 'failed', error: job.error }
  if (job?.status === 'running') {
    const started = Date.parse(job.started_at ?? job.queued_at)
    return { kind: 'slicing', elapsedS: Math.max(0, Math.floor((now - started) / 1000)) }
  }
  if (item.print_time_s !== null) return { kind: 'done' }
  if (job && now - Date.parse(job.queued_at) > SLOW_QUEUE_MS) return { kind: 'slow' }
  return { kind: 'queued' }
}

/** Queued or running: Mark as sent waits for it. Needs no clock, so it is safe to call while rendering. */
export function isSlicingInProgress(item: SlicingInput): boolean {
  const kind = slicingState(item, 0).kind
  return kind === 'queued' || kind === 'slicing'
}

type Bbox = { bbox_x_mm: number | null; bbox_y_mm: number | null; bbox_z_mm: number | null }
type BuildVolume = { build_x_mm: number; build_y_mm: number; build_z_mm: number }

/** False when any axis of the sliced model is larger than the printer's; true while there are no results. */
export function fitsPrinter(item: Bbox, printer: BuildVolume): boolean {
  if (item.bbox_x_mm === null || item.bbox_y_mm === null || item.bbox_z_mm === null) return true
  return (
    item.bbox_x_mm <= printer.build_x_mm &&
    item.bbox_y_mm <= printer.build_y_mm &&
    item.bbox_z_mm <= printer.build_z_mm
  )
}

/** The `models` bucket's limit: 100 MiB. */
export const MAX_MODEL_BYTES = 100 * 1024 * 1024
export const MAX_PARALLEL_UPLOADS = 3

export type FileProblem = 'extension' | 'empty' | 'tooLarge'

export function validateModelFile(file: { name: string; size: number }): FileProblem | null {
  if (!/.\.(stl|3mf)$/i.test(file.name)) return 'extension'
  if (file.size === 0) return 'empty'
  if (file.size > MAX_MODEL_BYTES) return 'tooLarge'
  return null
}

export function descriptionFromFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Storage rejects some characters in object keys; the original name is kept on the item. */
export function safeObjectName(name: string): string {
  return name.replace(/[^\w.\- ()]/g, '_')
}

/** `<quote_id>/<upload_id>/<file>`, the layout the `models` storage policies expect. */
export function modelPath(quoteId: number, uploadId: string, filename: string): string {
  return `${quoteId}/${uploadId}/${filename}`
}

type PricingInput = {
  printer_id: number | null
  material_id: number | null
  print_time_s: number | null
  priced_at: string | null
}

/** Items `price-quote` would price that have no price yet. */
export function unpricedItems<T extends PricingInput>(items: T[]): T[] {
  return items.filter(
    (item) =>
      item.printer_id !== null &&
      item.material_id !== null &&
      item.print_time_s !== null &&
      item.priced_at === null,
  )
}

/** Printer and material for a new item: the newest item's (§3.4) when both are still active, else none. */
export function defaultCatalogChoice(
  items: { id: number; printer_id: number | null; material_id: number | null }[],
  activePrinterIds: ReadonlySet<number>,
  activeMaterialIds: ReadonlySet<number>,
): { printer_id: number | null; material_id: number | null } {
  const newest = [...items]
    .sort((a, b) => b.id - a.id)
    .find((item) => item.printer_id !== null && item.material_id !== null)
  if (
    newest?.printer_id != null &&
    newest.material_id != null &&
    activePrinterIds.has(newest.printer_id) &&
    activeMaterialIds.has(newest.material_id)
  ) {
    return { printer_id: newest.printer_id, material_id: newest.material_id }
  }
  return { printer_id: null, material_id: null }
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
 * Net (the sum of the item totals), VAT and gross, worked out in integer cents. VAT is rounded half-up once, on the
 * net. Null without items or while any item has no price.
 */
export function quoteTotals(
  items: { item_total: number | null }[],
  ratePct: number,
): QuoteTotals | null {
  if (items.length === 0 || items.some((item) => item.item_total === null)) return null
  const netCents = items.reduce(
    (sum, item) => sum + Math.round((item.item_total as number) * 100),
    0,
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
