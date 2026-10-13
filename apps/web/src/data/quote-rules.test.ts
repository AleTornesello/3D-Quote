import { describe, expect, test } from 'vitest'
import {
  DEFAULT_QUOTE_LIST,
  MAX_MODEL_BYTES,
  SLOW_QUEUE_MS,
  defaultCatalogChoice,
  descriptionFromFilename,
  expiresSoon,
  fitsPrinter,
  hasFilters,
  isSlicingInProgress,
  modelPath,
  parseQuoteListParams,
  safeObjectName,
  slicingState,
  toQuoteListSearch,
  unpricedItems,
  validateModelFile,
  type ItemJob,
} from './quote-rules'

describe('list params', () => {
  test('an empty URL gives the defaults', () => {
    expect(parseQuoteListParams(new URLSearchParams())).toEqual(DEFAULT_QUOTE_LIST)
  })

  test('reads every param', () => {
    const params = parseQuoteListParams(
      new URLSearchParams(
        'q=rossi&status=sent,draft&client=4&from=2026-10-01&to=2026-10-31&sort=total&dir=asc&page=3',
      ),
    )
    expect(params).toEqual({
      q: 'rossi',
      status: ['draft', 'sent'],
      client: 4,
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'total',
      dir: 'asc',
      page: 3,
    })
  })

  test('bad values fall back to their defaults', () => {
    const params = parseQuoteListParams(
      new URLSearchParams(
        'status=sent,bogus,sent&client=-2&from=2026-02-30&to=yesterday&sort=x&dir=up&page=0',
      ),
    )
    expect(params).toEqual({ ...DEFAULT_QUOTE_LIST, status: ['sent'] })
  })

  test('round-trips, leaving defaults out of the URL', () => {
    expect(toQuoteListSearch(DEFAULT_QUOTE_LIST).toString()).toBe('')
    const params = { ...DEFAULT_QUOTE_LIST, q: 'Q-2026', status: ['sent' as const], page: 2 }
    expect(parseQuoteListParams(toQuoteListSearch(params))).toEqual(params)
  })

  test('hasFilters ignores sort and page', () => {
    expect(hasFilters({ ...DEFAULT_QUOTE_LIST, sort: 'total', page: 4 })).toBe(false)
    expect(hasFilters({ ...DEFAULT_QUOTE_LIST, q: ' x ' })).toBe(true)
    expect(hasFilters({ ...DEFAULT_QUOTE_LIST, to: '2026-10-01' })).toBe(true)
  })
})

test('expiresSoon: sent quotes within seven days of today', () => {
  const today = '2026-10-13'
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-13' }, today)).toBe(true)
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-20' }, today)).toBe(true)
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-21' }, today)).toBe(false)
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-12' }, today)).toBe(false)
  expect(expiresSoon({ status: 'draft', valid_until: '2026-10-14' }, today)).toBe(false)
})

describe('slicingState', () => {
  const NOW = Date.parse('2026-10-13T10:00:00Z')
  const job = (overrides: Partial<ItemJob>): ItemJob => ({
    id: 1,
    status: 'queued',
    error: null,
    queued_at: '2026-10-13T09:59:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  })
  const item = (overrides: Partial<Parameters<typeof slicingState>[0]> = {}) => ({
    printer_id: 1,
    material_id: 2,
    print_time_s: null,
    job: null,
    ...overrides,
  })

  test('waits for printer and material', () => {
    expect(slicingState(item({ printer_id: null }), NOW)).toEqual({ kind: 'waiting' })
    expect(slicingState(item({ material_id: null, job: job({}) }), NOW)).toEqual({
      kind: 'waiting',
    })
  })
  test('queued, then slow after more than ten minutes', () => {
    expect(slicingState(item({ job: job({}) }), NOW)).toEqual({ kind: 'queued' })
    const exactly = new Date(NOW - SLOW_QUEUE_MS).toISOString()
    expect(slicingState(item({ job: job({ queued_at: exactly }) }), NOW)).toEqual({
      kind: 'queued',
    })
    const longer = new Date(NOW - SLOW_QUEUE_MS - 1000).toISOString()
    expect(slicingState(item({ job: job({ queued_at: longer }) }), NOW)).toEqual({ kind: 'slow' })
  })
  test('slicing with the seconds since it started', () => {
    const running = job({ status: 'running', started_at: '2026-10-13T09:58:55Z' })
    expect(slicingState(item({ job: running }), NOW)).toEqual({ kind: 'slicing', elapsedS: 65 })
  })
  test('done once the item has results', () => {
    const succeeded = job({ status: 'succeeded' })
    expect(slicingState(item({ print_time_s: 19800, job: succeeded }), NOW)).toEqual({
      kind: 'done',
    })
  })
  test('failed with the error', () => {
    const failed = job({ status: 'failed', error: 'Model is not manifold' })
    expect(slicingState(item({ job: failed }), NOW)).toEqual({
      kind: 'failed',
      error: 'Model is not manifold',
    })
  })
  test('no job and no results counts as queued', () => {
    expect(slicingState(item(), NOW)).toEqual({ kind: 'queued' })
  })
  test('isSlicingInProgress is true while queued or running', () => {
    expect(isSlicingInProgress(item({ job: job({}) }))).toBe(true)
    expect(isSlicingInProgress(item({ job: job({ status: 'running' }) }))).toBe(true)
    expect(isSlicingInProgress(item({ print_time_s: 10, job: job({ status: 'succeeded' }) }))).toBe(
      false,
    )
    expect(isSlicingInProgress(item({ job: job({ status: 'failed' }) }))).toBe(false)
    expect(isSlicingInProgress(item({ printer_id: null }))).toBe(false)
  })
})

test('fitsPrinter compares each axis with the build volume', () => {
  const printer = { build_x_mm: 250, build_y_mm: 210, build_z_mm: 220 }
  const box = (x: number, y: number, z: number) => ({ bbox_x_mm: x, bbox_y_mm: y, bbox_z_mm: z })
  expect(fitsPrinter(box(250, 210, 220), printer)).toBe(true)
  expect(fitsPrinter(box(250.1, 10, 10), printer)).toBe(false)
  expect(fitsPrinter(box(10, 211, 10), printer)).toBe(false)
  expect(fitsPrinter(box(10, 10, 221), printer)).toBe(false)
  expect(fitsPrinter({ bbox_x_mm: null, bbox_y_mm: null, bbox_z_mm: null }, printer)).toBe(true)
})

describe('model files', () => {
  test('validateModelFile checks extension, emptiness and size', () => {
    expect(validateModelFile({ name: 'part.STL', size: 10 })).toBeNull()
    expect(validateModelFile({ name: 'part.3mf', size: MAX_MODEL_BYTES })).toBeNull()
    expect(validateModelFile({ name: 'part.obj', size: 10 })).toBe('extension')
    expect(validateModelFile({ name: 'stl', size: 10 })).toBe('extension')
    expect(validateModelFile({ name: 'part.stl', size: 0 })).toBe('empty')
    expect(validateModelFile({ name: 'part.stl', size: MAX_MODEL_BYTES + 1 })).toBe('tooLarge')
  })
  test('descriptionFromFilename drops the extension', () => {
    expect(descriptionFromFilename('Staffa grande.stl')).toBe('Staffa grande')
    expect(descriptionFromFilename('a.b.3mf')).toBe('a.b')
  })
  test('safeObjectName keeps letters, digits, spaces and . - _ ( )', () => {
    expect(safeObjectName('Staffa (v2) - finale.stl')).toBe('Staffa (v2) - finale.stl')
    expect(safeObjectName('pezzo#1 perché?.stl')).toBe('pezzo_1 perch__.stl')
  })
  test('modelPath', () => {
    expect(modelPath(7, 'u-1', 'a.stl')).toBe('7/u-1/a.stl')
  })
})

test('unpricedItems: results, printer and material, no price', () => {
  const base = {
    id: 1,
    updated_at: 't',
    printer_id: 1,
    material_id: 2,
    print_time_s: 100,
    priced_at: null,
  }
  expect(unpricedItems([base])).toEqual([base])
  expect(unpricedItems([{ ...base, priced_at: 't' }])).toEqual([])
  expect(unpricedItems([{ ...base, print_time_s: null }])).toEqual([])
  expect(unpricedItems([{ ...base, printer_id: null }])).toEqual([])
})

test('defaultCatalogChoice takes the newest item with both, if still active', () => {
  const items = [
    { id: 1, printer_id: 10, material_id: 20 },
    { id: 3, printer_id: 11, material_id: 21 },
    { id: 4, printer_id: null, material_id: 22 },
  ]
  expect(defaultCatalogChoice(items, new Set([10, 11]), new Set([20, 21]))).toEqual({
    printer_id: 11,
    material_id: 21,
  })
  expect(defaultCatalogChoice(items, new Set([10]), new Set([20, 21]))).toEqual({
    printer_id: null,
    material_id: null,
  })
  expect(defaultCatalogChoice([], new Set(), new Set())).toEqual({
    printer_id: null,
    material_id: null,
  })
})
