import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'

/** Label, control and its error. `error` is an i18n key; the control must use `id` and set `aria-invalid`. */
export function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      <FieldError>{error ? t(error) : null}</FieldError>
    </Field>
  )
}
