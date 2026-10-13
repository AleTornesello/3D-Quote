import { z } from 'zod'
import type { ClientOption } from '@/data/clients'
import type { QuoteValues } from '@/data/quotes'
import { toInputNumber, type Locale } from '@/lib/format'
import { nullIfEmpty, numberField, parseDecimal } from '@/lib/forms'

/** New quote and Edit details. `today` is the shop date: valid-until may not be earlier. */
export function quoteSchema(today: string) {
  return z.object({
    client: z
      .custom<ClientOption | null>()
      .refine((client): boolean => client !== null, 'validation.required'),
    valid_until: z
      .string()
      .refine((value) => value !== '', 'validation.required')
      .refine((value) => value === '' || value >= today, 'validation.validUntilPast'),
    notes: z.string(),
    markup: numberField({
      min: 0,
      decimals: 2,
      rangeError: 'validation.nonNegative',
      optional: true,
    }),
  })
}

export type QuoteForm = z.infer<ReturnType<typeof quoteSchema>>

export function quoteToForm(
  source: {
    client: ClientOption | null
    valid_until: string
    notes: string | null
    markup_override_pct: number | null
  },
  locale: Locale,
): QuoteForm {
  return {
    client: source.client,
    valid_until: source.valid_until,
    notes: source.notes ?? '',
    markup: toInputNumber(source.markup_override_pct, locale),
  }
}

/** Only call on a validated form: the client is set. */
export function formToQuote(form: QuoteForm): QuoteValues {
  return {
    client_id: (form.client as ClientOption).id,
    valid_until: form.valid_until,
    notes: nullIfEmpty(form.notes),
  }
}

/** The markup override, or null when the field is empty. */
export function formMarkup(form: QuoteForm): number | null {
  return form.markup.trim() === '' ? null : parseDecimal(form.markup)
}
