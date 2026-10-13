import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { useSaveClient, type Client } from '@/data/clients'
import { toAppError } from '@/data/errors'
import { clientSchema, clientToForm, formToClient, type ClientForm } from './client-form'
import { ClientFields } from './ClientFields'

/** New client; on save, goes to the new client's page, or hands the client to `onCreated` when given. */
export function ClientSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated?: (client: Client) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const save = useSaveClient()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: clientToForm(null),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const created = await save.mutateAsync({ values: formToClient(values) })
      if (onCreated) onCreated(created)
      else navigate(`/clients/${created.id}`)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <FormSheet title={t('clients.new')} dirty={form.formState.isDirty} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <ClientFields form={form} idPrefix="new-client" />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={!form.formState.isDirty || save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormSheet>
  )
}
