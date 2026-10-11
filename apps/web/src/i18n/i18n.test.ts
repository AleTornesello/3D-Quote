import { describe, expect, test } from 'vitest'
import { detectLanguage } from '@/i18n'
import en from '@/i18n/locales/en.json'
import it from '@/i18n/locales/it.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

test('it and en catalogs have the same keys', () => {
  expect(keys(en).sort()).toEqual(keys(it).sort())
})

describe('detectLanguage', () => {
  test('prefers a valid stored language', () => {
    expect(detectLanguage('en', ['it-IT'])).toBe('en')
  })
  test('ignores an invalid stored value', () => {
    expect(detectLanguage('fr', ['en-US'])).toBe('en')
  })
  test('maps regional browser tags to the base language', () => {
    expect(detectLanguage(null, ['it-CH'])).toBe('it')
    expect(detectLanguage(null, ['de-DE', 'en-GB'])).toBe('en')
  })
  test('falls back to Italian', () => {
    expect(detectLanguage(null, ['de-DE'])).toBe('it')
    expect(detectLanguage(null, [])).toBe('it')
  })
})
