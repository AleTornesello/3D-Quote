import { z } from 'zod'
import type { Consumable, ConsumableValues } from '@/data/consumables'
import { toInputNumber, type Locale } from '@/lib/format'
import { numberField, parseDecimal, requiredText } from '@/lib/forms'

export const consumableSchema = z.object({
  name: requiredText(),
  unit: requiredText(20),
  unit_price: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  stock: numberField({ min: 0, decimals: 0, rangeError: 'validation.nonNegative' }),
  active: z.boolean(),
})

export type ConsumableForm = z.infer<typeof consumableSchema>

export function consumableToForm(consumable: Consumable | null, locale: Locale): ConsumableForm {
  return {
    name: consumable?.name ?? '',
    unit: consumable?.unit ?? 'pz',
    unit_price: toInputNumber(consumable?.unit_price, locale, 2),
    stock: consumable ? String(consumable.stock) : '0',
    active: consumable?.active ?? true,
  }
}

/** Only called on values that passed consumableSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

export function formToConsumable(form: ConsumableForm): ConsumableValues {
  return {
    name: form.name.trim(),
    unit: form.unit.trim(),
    unit_price: number(form.unit_price),
    stock: number(form.stock),
    active: form.active,
  }
}
