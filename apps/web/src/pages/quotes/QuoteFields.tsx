import { Controller, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ClientPicker } from './ClientPicker'
import type { QuoteForm } from './quote-form'

/** Client, valid until, notes and (owners) the markup override: New quote and Edit details share them. */
export function QuoteFields({
  form,
  idPrefix,
  showMarkup,
}: {
  form: UseFormReturn<QuoteForm>
  idPrefix: string
  showMarkup: boolean
}) {
  const { t } = useTranslation()
  const {
    register,
    control,
    formState: { errors },
  } = form
  return (
    <>
      <FormField
        id={`${idPrefix}-client`}
        label={t('quotes.form.client')}
        error={errors.client?.message}
      >
        <Controller
          control={control}
          name="client"
          render={({ field }) => (
            <ClientPicker
              id={`${idPrefix}-client`}
              value={field.value}
              onChange={field.onChange}
              invalid={!!errors.client}
            />
          )}
        />
      </FormField>
      <FormField
        id={`${idPrefix}-valid-until`}
        label={t('quotes.form.validUntil')}
        error={errors.valid_until?.message}
      >
        <Input
          id={`${idPrefix}-valid-until`}
          type="date"
          aria-invalid={!!errors.valid_until}
          {...register('valid_until')}
        />
      </FormField>
      <FormField id={`${idPrefix}-notes`} label={t('quotes.form.notes')}>
        <Textarea id={`${idPrefix}-notes`} {...register('notes')} />
      </FormField>
      {showMarkup && (
        <FormField
          id={`${idPrefix}-markup`}
          label={t('quotes.form.markup')}
          error={errors.markup?.message}
        >
          <Input
            id={`${idPrefix}-markup`}
            inputMode="decimal"
            aria-invalid={!!errors.markup}
            aria-describedby={`${idPrefix}-markup-hint`}
            {...register('markup')}
          />
          <p id={`${idPrefix}-markup-hint`} className="text-xs text-muted-foreground">
            {t('quotes.form.markupHint')}
          </p>
        </FormField>
      )}
    </>
  )
}
