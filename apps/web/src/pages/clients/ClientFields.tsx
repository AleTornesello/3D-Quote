import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ClientForm } from './client-form'

/** The client fields, shared by the New client sheet and the client page. */
export function ClientFields({
  form,
  idPrefix,
}: {
  form: UseFormReturn<ClientForm>
  idPrefix: string
}) {
  const { t } = useTranslation()
  const {
    register,
    formState: { errors },
  } = form
  const id = (name: keyof ClientForm) => `${idPrefix}-${name}`
  return (
    <>
      <FormField id={id('name')} label={t('clients.fields.name')} error={errors.name?.message}>
        <Input id={id('name')} aria-invalid={!!errors.name} {...register('name')} />
      </FormField>
      <FormField id={id('company')} label={t('clients.fields.company')}>
        <Input id={id('company')} {...register('company')} />
      </FormField>
      <FormField id={id('email')} label={t('clients.fields.email')} error={errors.email?.message}>
        <Input
          id={id('email')}
          type="email"
          autoComplete="off"
          aria-invalid={!!errors.email}
          {...register('email')}
        />
      </FormField>
      <FormField id={id('phone')} label={t('clients.fields.phone')}>
        <Input id={id('phone')} type="tel" autoComplete="off" {...register('phone')} />
      </FormField>
      <FormField id={id('notes')} label={t('clients.fields.notes')}>
        <Textarea id={id('notes')} rows={3} {...register('notes')} />
      </FormField>
    </>
  )
}
