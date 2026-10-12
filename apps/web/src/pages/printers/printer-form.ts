import { z } from 'zod'
import type { Printer, PrinterValues } from '@/data/printers'
import { toInputNumber, type Locale } from '@/lib/format'
import { numberField, parseDecimal, requiredText } from '@/lib/forms'

export const printerSchema = z.object({
  name: requiredText(),
  model: requiredText(),
  build_x_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
  build_y_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
  build_z_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
  nozzle_diameter_mm: numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' }),
  hourly_rate: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  power_w: numberField({ gt: 0, decimals: 0, rangeError: 'validation.positive' }),
  active: z.boolean(),
})

export type PrinterForm = z.infer<typeof printerSchema>

export function printerToForm(printer: Printer | null, locale: Locale): PrinterForm {
  return {
    name: printer?.name ?? '',
    model: printer?.model ?? '',
    build_x_mm: toInputNumber(printer?.build_x_mm, locale),
    build_y_mm: toInputNumber(printer?.build_y_mm, locale),
    build_z_mm: toInputNumber(printer?.build_z_mm, locale),
    nozzle_diameter_mm: toInputNumber(printer?.nozzle_diameter_mm ?? 0.4, locale, 2),
    hourly_rate: toInputNumber(printer?.hourly_rate, locale, 2),
    power_w: toInputNumber(printer?.power_w, locale),
    active: printer?.active ?? true,
  }
}

/** Only called on values that passed printerSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

export function formToPrinter(form: PrinterForm): PrinterValues {
  return {
    name: form.name.trim(),
    model: form.model.trim(),
    build_x_mm: number(form.build_x_mm),
    build_y_mm: number(form.build_y_mm),
    build_z_mm: number(form.build_z_mm),
    nozzle_diameter_mm: number(form.nozzle_diameter_mm),
    hourly_rate: number(form.hourly_rate),
    power_w: number(form.power_w),
    active: form.active,
  }
}
