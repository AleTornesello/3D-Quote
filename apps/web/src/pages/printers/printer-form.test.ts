import { describe, expect, test } from 'vitest'
import { printerRow } from '@/test/fixtures'
import {
  formToPrinter,
  hourlyRateFromPurchase,
  printerSchema,
  printerToForm,
  type PrinterForm,
} from './printer-form'

const direct = () => printerToForm(printerRow({ hourly_rate: 1.5 }), 'en-GB')
const bought = (overrides: Partial<PrinterForm> = {}): PrinterForm => ({
  ...direct(),
  rate_mode: 'purchase',
  purchase_cost: '500',
  lifetime_hours: '600',
  hourly_rate: '',
  ...overrides,
})

describe('hourlyRateFromPurchase', () => {
  test('divides the purchase cost by the life and rounds to cents', () => {
    expect(hourlyRateFromPurchase('500', '600')).toBe(0.83)
    expect(hourlyRateFromPurchase('1200', '4000')).toBe(0.3)
    expect(hourlyRateFromPurchase('799,99', '2000')).toBe(0.4)
  })

  test('is null until both values are valid', () => {
    expect(hourlyRateFromPurchase('', '600')).toBeNull()
    expect(hourlyRateFromPurchase('500', '')).toBeNull()
    expect(hourlyRateFromPurchase('500', '0')).toBeNull()
    expect(hourlyRateFromPurchase('0', '600')).toBeNull()
    expect(hourlyRateFromPurchase('500', '10.5')).toBeNull()
    expect(hourlyRateFromPurchase('abc', '600')).toBeNull()
  })
})

describe('printerToForm', () => {
  test('a printer without a purchase cost opens in direct mode', () => {
    const form = direct()
    expect(form).toMatchObject({ rate_mode: 'direct', hourly_rate: '1.50', purchase_cost: '' })
  })

  test('a printer with a purchase cost opens in purchase mode', () => {
    const form = printerToForm(
      printerRow({ hourly_rate: 0.83, purchase_cost: 500, lifetime_hours: 600 }),
      'it-IT',
    )
    expect(form).toMatchObject({
      rate_mode: 'purchase',
      purchase_cost: '500,00',
      lifetime_hours: '600',
    })
  })

  test('a new printer starts in direct mode', () => {
    expect(printerToForm(null, 'en-GB').rate_mode).toBe('direct')
  })
})

describe('printerSchema', () => {
  test('direct mode checks the hourly rate only', () => {
    expect(printerSchema.safeParse(direct()).success).toBe(true)
    const result = printerSchema.safeParse({ ...direct(), hourly_rate: '-1' })
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['hourly_rate'], message: 'validation.nonNegative' }),
    )
  })

  test('purchase mode checks the purchase cost and the life, not the hourly rate', () => {
    expect(printerSchema.safeParse(bought()).success).toBe(true)
    const result = printerSchema.safeParse(bought({ purchase_cost: '0', lifetime_hours: '' }))
    const issues = result.error?.issues ?? []
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['purchase_cost'], message: 'validation.positive' }),
    )
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['lifetime_hours'], message: 'validation.required' }),
    )
    expect(issues.some((issue) => issue.path[0] === 'hourly_rate')).toBe(false)
  })

  test('the life is a whole number of hours', () => {
    const result = printerSchema.safeParse(bought({ lifetime_hours: '10.5' }))
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['lifetime_hours'], message: 'validation.integer' }),
    )
  })

  test('purchase-mode errors appear together with errors on other fields', () => {
    const result = printerSchema.safeParse(bought({ name: '', purchase_cost: '' }))
    const paths = (result.error?.issues ?? []).map((issue) => issue.path[0])
    expect(paths).toEqual(expect.arrayContaining(['name', 'purchase_cost']))
  })
})

describe('formToPrinter', () => {
  test('direct mode sends the typed rate and clears the purchase figures', () => {
    expect(formToPrinter(direct())).toMatchObject({
      hourly_rate: 1.5,
      purchase_cost: null,
      lifetime_hours: null,
    })
  })

  test('purchase mode sends the figures and the calculated rate', () => {
    expect(formToPrinter(bought())).toMatchObject({
      hourly_rate: 0.83,
      purchase_cost: 500,
      lifetime_hours: 600,
    })
  })

  test('a leftover typed rate is ignored in purchase mode', () => {
    expect(formToPrinter(bought({ hourly_rate: '9' })).hourly_rate).toBe(0.83)
  })
})
