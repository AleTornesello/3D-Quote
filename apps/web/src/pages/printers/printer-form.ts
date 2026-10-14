import { z } from 'zod'
import type { Printer, PrinterValues } from '@/data/printers'
import { toInputNumber, type Locale } from '@/lib/format'
import { numberField, parseDecimal, requiredText } from '@/lib/forms'

/** Either the hourly cost is typed, or it is calculated from the purchase cost and the life in hours. */
export const RATE_MODES = ['direct', 'purchase'] as const
export type RateMode = (typeof RATE_MODES)[number]

const hourlyRateField = numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' })
const purchaseCostField = numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' })
const lifetimeHoursField = numberField({ gt: 0, decimals: 0, rangeError: 'validation.positive' })

const RATE_FIELDS = {
  direct: [['hourly_rate', hourlyRateField]],
  purchase: [
    ['purchase_cost', purchaseCostField],
    ['lifetime_hours', lifetimeHoursField],
  ],
} as const

export const printerSchema = z
  .object({
    name: requiredText(),
    model: requiredText(),
    build_x_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
    build_y_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
    build_z_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
    nozzle_diameter_mm: numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' }),
    rate_mode: z.enum(RATE_MODES),
    // Only the fields of the chosen mode are checked (below).
    hourly_rate: z.string(),
    purchase_cost: z.string(),
    lifetime_hours: z.string(),
    power_w: numberField({ gt: 0, decimals: 0, rangeError: 'validation.positive' }),
    active: z.boolean(),
  })
  .superRefine((form, ctx) => {
    for (const [name, field] of RATE_FIELDS[form.rate_mode]) {
      const result = field.safeParse(form[name])
      if (result.success) continue
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: [name], message: issue.message })
      }
    }
  })

export type PrinterForm = z.infer<typeof printerSchema>

/** Purchase cost over life in hours, in cents. Null while either value is missing or invalid. */
export function hourlyRateFromPurchase(purchaseCost: string, lifetimeHours: string): number | null {
  if (!purchaseCostField.safeParse(purchaseCost).success) return null
  if (!lifetimeHoursField.safeParse(lifetimeHours).success) return null
  const cost = parseDecimal(purchaseCost) as number
  const hours = parseDecimal(lifetimeHours) as number
  return Math.round((cost * 100) / hours) / 100
}

export function printerToForm(printer: Printer | null, locale: Locale): PrinterForm {
  return {
    name: printer?.name ?? '',
    model: printer?.model ?? '',
    build_x_mm: toInputNumber(printer?.build_x_mm, locale),
    build_y_mm: toInputNumber(printer?.build_y_mm, locale),
    build_z_mm: toInputNumber(printer?.build_z_mm, locale),
    nozzle_diameter_mm: toInputNumber(printer?.nozzle_diameter_mm ?? 0.4, locale, 2),
    rate_mode: printer?.purchase_cost != null ? 'purchase' : 'direct',
    hourly_rate: toInputNumber(printer?.hourly_rate, locale, 2),
    purchase_cost: toInputNumber(printer?.purchase_cost, locale, 2),
    lifetime_hours: toInputNumber(printer?.lifetime_hours, locale),
    power_w: toInputNumber(printer?.power_w, locale),
    active: printer?.active ?? true,
  }
}

/** Only called on values that passed printerSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

export function formToPrinter(form: PrinterForm): PrinterValues {
  const purchase = form.rate_mode === 'purchase'
  return {
    name: form.name.trim(),
    model: form.model.trim(),
    build_x_mm: number(form.build_x_mm),
    build_y_mm: number(form.build_y_mm),
    build_z_mm: number(form.build_z_mm),
    nozzle_diameter_mm: number(form.nozzle_diameter_mm),
    hourly_rate: purchase
      ? (hourlyRateFromPurchase(form.purchase_cost, form.lifetime_hours) as number)
      : number(form.hourly_rate),
    purchase_cost: purchase ? number(form.purchase_cost) : null,
    lifetime_hours: purchase ? number(form.lifetime_hours) : null,
    power_w: number(form.power_w),
    active: form.active,
  }
}
