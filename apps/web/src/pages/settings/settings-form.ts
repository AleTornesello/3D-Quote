import { z } from 'zod'
import type { Settings, SettingsValues } from '@/data/settings'
import { toInputNumber, type Locale } from '@/lib/format'
import { nullIfEmpty, numberField, optionalEmail, parseDecimal } from '@/lib/forms'

export const settingsSchema = z.object({
  energy_price_kwh: numberField({ min: 0, decimals: 4, rangeError: 'validation.nonNegative' }),
  failure_allowance_pct: numberField({
    min: 0,
    max: 100,
    decimals: 2,
    rangeError: 'validation.percent',
  }),
  setup_fee: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  default_markup_pct: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  minimum_item_price: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  vat_rate_pct: numberField({ min: 0, max: 100, decimals: 2, rangeError: 'validation.percent' }),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'validation.currency'),
  quote_prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,10}$/, 'validation.quotePrefix'),
  default_validity_days: numberField({
    min: 1,
    max: 365,
    decimals: 0,
    rangeError: 'validation.validityDays',
  }),
  pdf_terms_it: z.string(),
  pdf_terms_en: z.string(),
  shop_name: z.string(),
  shop_address: z.string(),
  shop_vat_number: z.string(),
  shop_email: optionalEmail,
  shop_phone: z.string(),
})

export type SettingsForm = z.infer<typeof settingsSchema>

export function settingsToForm(settings: Settings, locale: Locale): SettingsForm {
  return {
    energy_price_kwh: toInputNumber(settings.energy_price_kwh, locale),
    failure_allowance_pct: toInputNumber(settings.failure_allowance_pct, locale),
    setup_fee: toInputNumber(settings.setup_fee, locale, 2),
    default_markup_pct: toInputNumber(settings.default_markup_pct, locale),
    minimum_item_price: toInputNumber(settings.minimum_item_price, locale, 2),
    vat_rate_pct: toInputNumber(settings.vat_rate_pct, locale),
    currency: settings.currency,
    quote_prefix: settings.quote_prefix,
    default_validity_days: String(settings.default_validity_days),
    pdf_terms_it: settings.pdf_terms_it ?? '',
    pdf_terms_en: settings.pdf_terms_en ?? '',
    shop_name: settings.shop_name ?? '',
    shop_address: settings.shop_address ?? '',
    shop_vat_number: settings.shop_vat_number ?? '',
    shop_email: settings.shop_email ?? '',
    shop_phone: settings.shop_phone ?? '',
  }
}

/** Only called on values that passed settingsSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

/** The fields the user changed, converted for the database. */
export function changedSettings(
  form: SettingsForm,
  dirtyFields: Partial<Record<keyof SettingsForm, boolean | undefined>>,
): SettingsValues {
  const all: Required<Pick<SettingsValues, keyof SettingsForm>> = {
    energy_price_kwh: number(form.energy_price_kwh),
    failure_allowance_pct: number(form.failure_allowance_pct),
    setup_fee: number(form.setup_fee),
    default_markup_pct: number(form.default_markup_pct),
    minimum_item_price: number(form.minimum_item_price),
    vat_rate_pct: number(form.vat_rate_pct),
    currency: form.currency.trim().toUpperCase(),
    quote_prefix: form.quote_prefix.trim(),
    default_validity_days: number(form.default_validity_days),
    pdf_terms_it: nullIfEmpty(form.pdf_terms_it),
    pdf_terms_en: nullIfEmpty(form.pdf_terms_en),
    shop_name: nullIfEmpty(form.shop_name),
    shop_address: nullIfEmpty(form.shop_address),
    shop_vat_number: nullIfEmpty(form.shop_vat_number),
    shop_email: nullIfEmpty(form.shop_email),
    shop_phone: nullIfEmpty(form.shop_phone),
  }
  return Object.fromEntries(
    Object.entries(all).filter(([key]) => dirtyFields[key as keyof SettingsForm]),
  ) as SettingsValues
}
