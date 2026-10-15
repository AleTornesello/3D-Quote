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

/** `defaultUnit` is the unit proposed for a new consumable, in the UI language. */
export function consumableToForm(
  consumable: Consumable | null,
  locale: Locale,
  defaultUnit: string,
): ConsumableForm {
  return {
    name: consumable?.name ?? '',
    unit: consumable?.unit ?? defaultUnit,
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

/**
 * Only the fields the user changed. Editing must not write back the others: the cached stock may be stale (a quote
 * sent in the meantime consumed some) and a full update would restore it.
 */
export function dirtyConsumableValues(
  form: ConsumableForm,
  dirtyFields: Partial<Record<keyof ConsumableForm, boolean | undefined>>,
): Partial<ConsumableValues> {
  const all = formToConsumable(form)
  return Object.fromEntries(
    Object.entries(all).filter(([key]) => dirtyFields[key as keyof ConsumableForm]),
  )
}
