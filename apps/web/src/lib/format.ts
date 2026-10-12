export type Locale = 'it-IT' | 'en-GB'

export function localeFor(language: string): Locale {
  return language === 'en' ? 'en-GB' : 'it-IT'
}

export function formatNumber(value: number, locale: Locale, decimals?: number) {
  const options =
    decimals === undefined
      ? {}
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatCurrency(value: number, locale: Locale, currency: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** dd/mm/yyyy. Date-only values are calendar dates; timestamps are shown in shop time (Europe/Rome). */
export function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: DATE_ONLY.test(value) ? 'UTC' : 'Europe/Rome',
  }).format(new Date(value))
}

/** A number as an input value, written the way the user types it: 0.4 → "0,40" in Italian. */
export function toInputNumber(value: number | null | undefined, locale: Locale, decimals?: number) {
  if (value === null || value === undefined) return ''
  const text = decimals === undefined ? String(value) : value.toFixed(decimals)
  return locale === 'it-IT' ? text.replace('.', ',') : text
}
