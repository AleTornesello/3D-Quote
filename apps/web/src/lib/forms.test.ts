import { describe, expect, test } from 'vitest'
import { numberField, optionalEmail, parseDecimal, requiredText } from './forms'

const firstError = (
  schema: { safeParse: (v: unknown) => { error?: { issues: { message: string }[] } } },
  value: unknown,
) => schema.safeParse(value).error?.issues[0]?.message

describe('parseDecimal', () => {
  test.each([
    ['0,40', 0.4],
    ['0.40', 0.4],
    [' 12 ', 12],
    ['2,5', 2.5],
    ['-1', -1],
  ])('%s → %s', (text, value) => expect(parseDecimal(text)).toBe(value))

  test.each(['', 'abc', '1.2.3', '1,2,3', '1e3', '12a'])('rejects %j', (text) =>
    expect(parseDecimal(text)).toBeNull(),
  )
})

describe('numberField', () => {
  const nozzle = numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' })

  test('accepts a valid value in either locale', () => {
    expect(nozzle.safeParse('0,40').success).toBe(true)
    expect(nozzle.safeParse('0.4').success).toBe(true)
  })
  test('reports required, number, decimals and range in that order', () => {
    expect(firstError(nozzle, '')).toBe('validation.required')
    expect(firstError(nozzle, 'abc')).toBe('validation.number')
    expect(firstError(nozzle, '0,123')).toBe('validation.decimals2')
    expect(firstError(nozzle, '0')).toBe('validation.positive')
  })
  test('integers and inclusive ranges', () => {
    const days = numberField({
      min: 1,
      max: 365,
      decimals: 0,
      rangeError: 'validation.validityDays',
    })
    expect(firstError(days, '1,5')).toBe('validation.integer')
    expect(firstError(days, '366')).toBe('validation.validityDays')
    expect(days.safeParse('365').success).toBe(true)
  })
  test('optional fields accept empty text', () => {
    expect(
      numberField({ min: 0, decimals: 2, rangeError: 'x', optional: true }).safeParse('').success,
    ).toBe(true)
  })
})

test('requiredText trims and limits length', () => {
  expect(firstError(requiredText(), '   ')).toBe('validation.required')
  expect(firstError(requiredText(3), 'abcd')).toBe('validation.tooLong')
})

test('optionalEmail allows empty text but not a bad address', () => {
  expect(optionalEmail.safeParse('').success).toBe(true)
  expect(optionalEmail.safeParse('anna@example.com').success).toBe(true)
  expect(firstError(optionalEmail, 'anna@')).toBe('validation.email')
})
