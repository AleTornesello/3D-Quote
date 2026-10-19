import { describe, expect, test } from 'vitest'
import {
  DEFAULT_QUOTE_LIST,
  expiresSoon,
  hasFilters,
  incompletePlates,
  isPlateComplete,
  parseDuration,
  parseQuoteListParams,
  pdfFileName,
  quoteTotals,
  toQuoteListSearch,
  unpricedPlates,
  vatRateFor,
} from './quote-rules'

const plate = (over = {}) => ({
  printer_id: 1 as number | null,
  print_time_s: 3600 as number | null,
  plate_total: 10 as number | null,
  priced_at: '2026-10-16T08:00:00Z' as string | null,
  materials: [{ grams: 12 }],
  ...over,
})

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

describe('isPlateComplete', () => {
  test('needs printer, print time and a material', () => {
    expect(isPlateComplete(plate())).toBe(true)
    expect(isPlateComplete(plate({ printer_id: null }))).toBe(false)
    expect(isPlateComplete(plate({ print_time_s: null }))).toBe(false)
    expect(isPlateComplete(plate({ materials: [] }))).toBe(false)
  })
})

describe('unpricedPlates', () => {
  test('lists complete plates that have no price yet', () => {
    const open = plate({ priced_at: null })
    expect(unpricedPlates([plate(), open, plate({ printer_id: null, priced_at: null })])).toEqual([
      open,
    ])
  })
})

describe('incompletePlates', () => {
  test('lists the incomplete ones', () => {
    const bad = plate({ materials: [] })
    expect(incompletePlates([plate(), bad])).toEqual([bad])
  })
})

describe('parseDuration', () => {
  test.each([
    ['1:30', 5400],
    ['0:05', 300],
    ['12:00', 43200],
    [' 2:00 ', 7200],
  ])('%s', (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds)
  })
  test.each(['', '0:00', '1:75', '90', '1:5', 'abc', '-1:00', '1:30:00'])('rejects %s', (text) => {
    expect(parseDuration(text)).toBeNull()
  })
})

describe('vatRateFor', () => {
  test('the quote’s own rate wins', () => {
    expect(vatRateFor({ vat_rate_pct: 22 }, { vat_rate_pct: 23 })).toBe(22)
  })
  test('a draft follows settings', () => {
    expect(vatRateFor({ vat_rate_pct: null }, { vat_rate_pct: 23 })).toBe(23)
  })
  test('a zero rate is a rate', () => {
    expect(vatRateFor({ vat_rate_pct: 0 }, { vat_rate_pct: 23 })).toBe(0)
  })
  test('is null while settings are loading', () => {
    expect(vatRateFor({ vat_rate_pct: null }, undefined)).toBeNull()
  })
})

describe('quoteTotals', () => {
  const plates = (...totals: (number | null)[]) =>
    totals.map((plate_total) => plate({ plate_total }))

  test('sums the plates and adds VAT', () => {
    expect(quoteTotals(plates(39.24, 10.5), 22)).toEqual({ net: 49.74, vat: 10.94, gross: 60.68 })
  })
  test('rounds VAT half-up to the cent', () => {
    expect(quoteTotals(plates(12.25), 22)).toEqual({ net: 12.25, vat: 2.7, gross: 14.95 })
    expect(quoteTotals(plates(0.25), 22)).toEqual({ net: 0.25, vat: 0.06, gross: 0.31 })
  })
  test('adds the plate totals without floating-point drift', () => {
    expect(quoteTotals(plates(0.1, 0.2), 0)).toEqual({ net: 0.3, vat: 0, gross: 0.3 })
  })
  test('a zero rate leaves the gross equal to the net', () => {
    expect(quoteTotals(plates(10), 0)).toEqual({ net: 10, vat: 0, gross: 10 })
  })
  test('handles a fractional rate', () => {
    expect(quoteTotals(plates(100), 7.5)).toEqual({ net: 100, vat: 7.5, gross: 107.5 })
  })
  test('is null without plates', () => {
    expect(quoteTotals([], 22)).toBeNull()
  })
  test('is null while a complete plate has no price', () => {
    expect(quoteTotals(plates(10, null), 22)).toBeNull()
  })
  test('is null while a plate is incomplete, even with an override total', () => {
    expect(quoteTotals([plate(), plate({ printer_id: null, plate_total: 5 })], 22)).toBeNull()
  })
  test('adds the plates and the consumables, then VAT', () => {
    expect(quoteTotals([plate(), plate({ plate_total: 20.5 })], 22, [{ line_total: 4.5 }])).toEqual(
      {
        net: 35,
        vat: 7.7,
        gross: 42.7,
      },
    )
  })
})

describe('pdfFileName', () => {
  test('joins the number and the client with a dash', () => {
    expect(pdfFileName('Q-2026-0042', 'Mario Rossi')).toBe('Q-2026-0042-Mario-Rossi.pdf')
  })
  test('removes characters that are not allowed in file names', () => {
    expect(pdfFileName('Q-2026-0042', 'Rossi/Bianchi: "SRL" <x>?*|\\')).toBe(
      'Q-2026-0042-RossiBianchi-SRL-x.pdf',
    )
  })
  test('keeps accented letters and collapses whitespace', () => {
    expect(pdfFileName('Q-2026-0042', '  Società   Perù  ')).toBe('Q-2026-0042-Società-Perù.pdf')
  })
  test('caps the client part at 60 characters', () => {
    const name = pdfFileName('Q-2026-0042', 'A'.repeat(100))
    expect(name).toBe(`Q-2026-0042-${'A'.repeat(60)}.pdf`)
  })
  test('without a usable client name it is just the number', () => {
    expect(pdfFileName('Q-2026-0042', ' /:? ')).toBe('Q-2026-0042.pdf')
  })
})

describe('quoteTotals with consumables', () => {
  test('adds the consumable lines to the net before VAT', () => {
    expect(
      quoteTotals([plate({ plate_total: 10 })], 22, [{ line_total: 0.3 }, { line_total: 1 }]),
    ).toEqual({
      net: 11.3,
      vat: 2.49,
      gross: 13.79,
    })
  })

  test('without consumables the result is unchanged', () => {
    expect(quoteTotals([plate({ plate_total: 10 })], 22)).toEqual({
      net: 10,
      vat: 2.2,
      gross: 12.2,
    })
  })

  test('still null without plates or with an unpriced plate', () => {
    expect(quoteTotals([], 22, [{ line_total: 5 }])).toBeNull()
    expect(quoteTotals([plate({ plate_total: null })], 22, [{ line_total: 5 }])).toBeNull()
  })
})
