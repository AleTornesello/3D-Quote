import { z } from 'zod'

/** Parses a number typed in either locale ("0,40" or "0.40"). Null unless it is a plain decimal number. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return null
  return Number(normalized)
}

function decimalsOf(text: string) {
  return text.trim().replace(',', '.').split('.')[1]?.length ?? 0
}

export type NumberRule = {
  /** Smallest allowed value, inclusive. */
  min?: number
  /** The value must be greater than this. */
  gt?: number
  /** Largest allowed value, inclusive. */
  max?: number
  decimals: 0 | 1 | 2 | 4
  /** i18n key shown when the value is out of range. */
  rangeError: string
  optional?: boolean
}

/** A number held as text in a form, checked with the same limits as the database. Messages are i18n keys. */
export function numberField(rule: NumberRule) {
  return z.string().superRefine((raw, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    const text = raw.trim()
    if (text === '') {
      if (!rule.optional) fail('validation.required')
      return
    }
    const value = parseDecimal(text)
    if (value === null) {
      fail('validation.number')
      return
    }
    if (decimalsOf(text) > rule.decimals) {
      fail(rule.decimals === 0 ? 'validation.integer' : `validation.decimals${rule.decimals}`)
      return
    }
    const tooLow =
      (rule.min !== undefined && value < rule.min) || (rule.gt !== undefined && value <= rule.gt)
    const tooHigh = rule.max !== undefined && value > rule.max
    if (tooLow || tooHigh) fail(rule.rangeError)
  })
}

export function requiredText(max = 200) {
  return z.string().trim().min(1, 'validation.required').max(max, 'validation.tooLong')
}

export const optionalEmail = z
  .string()
  .trim()
  .refine((value) => value === '' || z.email().safeParse(value).success, 'validation.email')

/** Empty text fields are stored as null. */
export function nullIfEmpty(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}
