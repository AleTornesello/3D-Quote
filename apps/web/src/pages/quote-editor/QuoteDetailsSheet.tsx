import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useSetMarkupOverride, useUpdateQuote, type Quote, type QuoteValues } from '@/data/quotes'
import { shopToday } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import {
  formMarkup,
  formToQuote,
  quoteSchema,
  quoteToForm,
  type QuoteForm,
} from '../quotes/quote-form'
import { QuoteFields } from '../quotes/QuoteFields'

/** Edit details of a draft. Saves only the fields that changed; a new markup reprices through automatic pricing. */
export function QuoteDetailsSheet({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const { locale } = useFormat()
  const update = useUpdateQuote()
  const setMarkup = useSetMarkupOverride()
  const [today] = useState(shopToday)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<QuoteForm>({
    resolver: zodResolver(quoteSchema(today)),
    defaultValues: quoteToForm(quote, locale),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    const next = formToQuote(values)
    const changed: Partial<QuoteValues> = {}
    if (next.client_id !== quote.client_id) changed.client_id = next.client_id
    if (next.valid_until !== quote.valid_until) changed.valid_until = next.valid_until
    if (next.notes !== quote.notes) changed.notes = next.notes
    const markup = formMarkup(values)
    try {
      if (Object.keys(changed).length > 0)
        await update.mutateAsync({ id: quote.id, values: changed })
      if (isOwner && markup !== quote.markup_override_pct) {
        await setMarkup.mutateAsync({ quoteId: quote.id, pct: markup })
      }
      onClose()
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <FormSheet
      title={t('quotes.editor.detailsTitle')}
      dirty={form.formState.isDirty}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <QuoteFields form={form} idPrefix="quote-details" showMarkup={isOwner} />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button
          type="submit"
          disabled={!form.formState.isDirty || update.isPending || setMarkup.isPending}
        >
          {t('common.save')}
        </Button>
      </form>
    </FormSheet>
  )
}
