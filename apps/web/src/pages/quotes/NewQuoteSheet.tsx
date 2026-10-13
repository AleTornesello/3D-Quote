import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useStaff } from '@/auth/staff-context'
import { FormSheet } from '@/components/FormSheet'
import { QueryError } from '@/components/QueryError'
import { Button } from '@/components/ui/button'
import { useClient, type ClientOption } from '@/data/clients'
import { toAppError } from '@/data/errors'
import { useCreateQuote, useSetMarkupOverride } from '@/data/quotes'
import { useSettings } from '@/data/settings'
import { addDays, shopToday } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { formMarkup, formToQuote, quoteSchema, quoteToForm, type QuoteForm } from './quote-form'
import { QuoteFields } from './QuoteFields'

/** New quote; `clientId` (from /quotes/new?client=) pre-selects a client. Opens the editor once created. */
export function NewQuoteSheet({
  clientId,
  onClose,
}: {
  clientId: number | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const settings = useSettings()
  const client = useClient(clientId)
  // A disabled query (no client id) stays pending, so only wait for it when there is an id.
  const ready = settings.data !== undefined && (clientId === null || !client.isPending)

  // dirty comes from the form once it exists; one FormSheet stays mounted from loading to ready.
  const [dirty, setDirty] = useState(false)

  return (
    <FormSheet title={t('quotes.new')} dirty={dirty} onClose={onClose}>
      {ready ? (
        <NewQuoteForm
          validityDays={settings.data.default_validity_days}
          client={client.data ?? null}
          onDirtyChange={setDirty}
        />
      ) : settings.isError ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <p role="status" className="text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
    </FormSheet>
  )
}

function NewQuoteForm({
  validityDays,
  client,
  onDirtyChange,
}: {
  validityDays: number
  client: ClientOption | null
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const { locale } = useFormat()
  const navigate = useNavigate()
  const create = useCreateQuote()
  const setMarkup = useSetMarkupOverride()
  const [today] = useState(shopToday)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<QuoteForm>({
    resolver: zodResolver(quoteSchema(today)),
    defaultValues: quoteToForm(
      {
        client: client && { id: client.id, name: client.name, company: client.company },
        valid_until: addDays(today, validityDays),
        notes: null,
        markup_override_pct: null,
      },
      locale,
    ),
  })

  const { isDirty } = form.formState
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange])

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    let id: number
    try {
      id = await create.mutateAsync(formToQuote(values))
    } catch (error) {
      setFormError(toAppError(error).messageKey)
      return
    }
    const markup = formMarkup(values)
    if (isOwner && markup !== null) {
      try {
        await setMarkup.mutateAsync({ quoteId: id, pct: markup })
      } catch {
        // The quote exists; open it rather than leave an orphan behind the sheet.
        toast.error(t('quotes.markupNotSaved'))
      }
    }
    navigate(`/quotes/${id}`)
  })

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <QuoteFields form={form} idPrefix="new-quote" showMarkup={isOwner} />
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {t(formError)}
        </p>
      )}
      <Button type="submit" disabled={create.isPending || setMarkup.isPending}>
        {t('quotes.form.create')}
      </Button>
    </form>
  )
}
