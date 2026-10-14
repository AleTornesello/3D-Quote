import { z } from 'zod'
import { requiredText } from '@/lib/forms'

export const inviteSchema = z.object({
  display_name: requiredText(),
  email: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .refine((value) => z.email().safeParse(value).success, 'validation.email'),
  role: z.enum(['operator', 'owner']),
})

export type InviteForm = z.infer<typeof inviteSchema>

export const INVITE_DEFAULTS: InviteForm = { display_name: '', email: '', role: 'operator' }
