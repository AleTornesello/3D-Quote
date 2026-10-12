import { z } from 'zod'
import { MATERIAL_TYPES, TYPE_DENSITY, type Material, type MaterialValues } from '@/data/materials'
import { toInputNumber, type Locale } from '@/lib/format'
import { nullIfEmpty, numberField, parseDecimal, requiredText } from '@/lib/forms'

export const materialSchema = z.object({
  name: requiredText(),
  type: z.enum(MATERIAL_TYPES),
  color: z.string(),
  cost_per_kg: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  density_g_cm3: numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' }),
  active: z.boolean(),
})

export type MaterialForm = z.infer<typeof materialSchema>

export function materialToForm(material: Material | null, locale: Locale): MaterialForm {
  const type = (material?.type ?? 'PLA') as MaterialForm['type']
  return {
    name: material?.name ?? '',
    type,
    color: material?.color ?? '',
    cost_per_kg: toInputNumber(material?.cost_per_kg, locale, 2),
    density_g_cm3: toInputNumber(material?.density_g_cm3 ?? TYPE_DENSITY[type], locale, 2),
    active: material?.active ?? true,
  }
}

/** Only called on values that passed materialSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

export function formToMaterial(form: MaterialForm): MaterialValues {
  return {
    name: form.name.trim(),
    type: form.type,
    color: nullIfEmpty(form.color),
    cost_per_kg: number(form.cost_per_kg),
    density_g_cm3: number(form.density_g_cm3),
    active: form.active,
  }
}
