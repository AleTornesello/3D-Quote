import { expect, test } from 'vitest'
import { formatCurrency, formatDate, formatNumber, localeFor, toInputNumber } from './format'

// Intl uses non-breaking spaces; compare with plain ones.
const plain = (text: string) => text.replace(/\s/g, ' ')

test('localeFor maps the UI language', () => {
  expect(localeFor('it')).toBe('it-IT')
  expect(localeFor('en')).toBe('en-GB')
})

test('numbers use the locale separators', () => {
  expect(formatNumber(1234.5, 'it-IT')).toBe('1234,5')
  expect(formatNumber(12345.5, 'it-IT')).toBe('12.345,5')
  expect(formatNumber(0.4, 'it-IT', 2)).toBe('0,40')
  expect(formatNumber(0.4, 'en-GB', 2)).toBe('0.40')
})

test('currency follows the locale', () => {
  expect(plain(formatCurrency(1.5, 'it-IT', 'EUR'))).toBe('1,50 €')
  expect(formatCurrency(1.5, 'en-GB', 'EUR')).toBe('€1.50')
})

test('dates are dd/mm/yyyy; date-only values never shift a day', () => {
  expect(formatDate('2026-11-01', 'it-IT')).toBe('01/11/2026')
  expect(formatDate('2026-11-01', 'en-GB')).toBe('01/11/2026')
  // 23:30 UTC on 31 Oct is already 1 Nov in Rome.
  expect(formatDate('2026-10-31T23:30:00Z', 'it-IT')).toBe('01/11/2026')
})

test('toInputNumber writes numbers the way the user types them', () => {
  expect(toInputNumber(0.4, 'it-IT', 2)).toBe('0,40')
  expect(toInputNumber(0.4, 'en-GB', 2)).toBe('0.40')
  expect(toInputNumber(250, 'it-IT')).toBe('250')
  expect(toInputNumber(null, 'it-IT')).toBe('')
})
