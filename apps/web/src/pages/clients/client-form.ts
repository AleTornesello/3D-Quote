import { z } from 'zod'
import type { Client, ClientValues } from '@/data/clients'
import { nullIfEmpty, optionalEmail, requiredText } from '@/lib/forms'

export const clientSchema = z.object({
  name: requiredText(),
  company: z.string(),
  email: optionalEmail,
  phone: z.string(),
  notes: z.string(),
})

export type ClientForm = z.infer<typeof clientSchema>

export function clientToForm(client: Client | null): ClientForm {
  return {
    name: client?.name ?? '',
    company: client?.company ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    notes: client?.notes ?? '',
  }
}

export function formToClient(form: ClientForm): ClientValues {
  return {
    name: form.name.trim(),
    company: nullIfEmpty(form.company),
    email: nullIfEmpty(form.email),
    phone: nullIfEmpty(form.phone),
    notes: nullIfEmpty(form.notes),
  }
}
