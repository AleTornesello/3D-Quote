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

/** Today's date (yyyy-mm-dd) in shop time, Europe/Rome, like `private.shop_today()` in the database. */
export function shopToday(now: Date = new Date()): string {
  // en-CA formats dates as yyyy-mm-dd.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** A yyyy-mm-dd date moved by whole days. */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() + days)
  return moved.toISOString().slice(0, 10)
}

/** Seconds as h:mm, rounded to the minute: 19800 → "5:30". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Seconds as m:ss: 65 → "1:05". */
export function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
