import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings } from '@/data/settings'
import { formatCurrency, formatDate, formatNumber, localeFor } from './format'

/** Formatters for the UI language, with the shop currency from settings (EUR until it loads). */
export function useFormat() {
  const { i18n } = useTranslation()
  const settings = useSettings()
  const locale = localeFor(i18n.language)
  const currency = settings.data?.currency ?? 'EUR'
  return useMemo(
    () => ({
      locale,
      number: (value: number, decimals?: number) => formatNumber(value, locale, decimals),
      currency: (value: number) => formatCurrency(value, locale, currency),
      date: (value: string) => formatDate(value, locale),
    }),
    [locale, currency],
  )
}
