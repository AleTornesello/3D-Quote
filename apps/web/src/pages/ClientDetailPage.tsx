import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useStaff } from '@/auth/staff-context'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { Button } from '@/components/ui/button'
import { useLeaveGuard } from '@/components/use-leave-guard'
import {
  useClient,
  useClientQuotes,
  useDeleteClient,
  useSaveClient,
  type Client,
  type ClientQuote,
} from '@/data/clients'
import { toAppError } from '@/data/errors'
import { useFormat } from '@/lib/use-format'
import { clientSchema, clientToForm, formToClient, type ClientForm } from './clients/client-form'
import { ClientFields } from './clients/ClientFields'
import { NotFoundMessage } from './NotFoundPage'
import { QuoteStatusBadge } from './quotes/QuoteStatusBadge'

export function ClientDetailPage() {
  const { t } = useTranslation()
  const { id: rawId } = useParams()
  const id = Number(rawId)
  const valid = Number.isInteger(id) && id > 0
  const client = useClient(valid ? id : null)

  if (!valid) return <NotFoundMessage />
  if (client.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  if (client.isError && client.data === undefined) {
    return <QueryError error={client.error} onRetry={() => void client.refetch()} />
  }
  if (!client.data) return <NotFoundMessage />
  return (
    <>
      {client.isError && <QueryError error={client.error} onRetry={() => void client.refetch()} />}
      <ClientDetail key={client.data.id} client={client.data} />
    </>
  )
}

function ClientDetail({ client }: { client: Client }) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const navigate = useNavigate()
  const quotes = useClientQuotes(client.id)
  const save = useSaveClient()
  const remove = useDeleteClient()
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: clientToForm(client),
  })
  const isDirty = form.formState.isDirty
  const guard = useLeaveGuard(isDirty)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false)
    setFormError(null)
    try {
      const updated = await save.mutateAsync({ id: client.id, values: formToClient(values) })
      form.reset(clientToForm(updated))
      setSaved(true)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  async function confirmDelete() {
    setDeleteError(null)
    try {
      await remove.mutateAsync(client.id)
      guard.allowLeaving()
      navigate('/clients')
    } catch (error) {
      const appError = toAppError(error)
      setDeleteError(t(appError.kind === 'inUse' ? 'clients.inUse' : appError.messageKey))
    }
  }

  const canDelete = isOwner && quotes.isSuccess && quotes.data.length === 0
  const columns: Column<ClientQuote>[] = [
    { key: 'number', header: t('clients.detail.number'), cell: (q) => q.number },
    {
      key: 'status',
      header: t('clients.detail.status'),
      cell: (q) => <QuoteStatusBadge status={q.status} />,
    },
    { key: 'created', header: t('clients.detail.created'), cell: (q) => format.date(q.created_at) },
    {
      key: 'validUntil',
      header: t('clients.detail.validUntil'),
      cell: (q) => format.date(q.valid_until),
    },
  ]

  return (
    <section className="grid gap-8">
      <PageHeader
        title={client.name}
        actions={
          <>
            <Button asChild>
              <Link to={`/quotes/new?client=${client.id}`}>{t('clients.detail.newQuote')}</Link>
            </Button>
            {canDelete && (
              <Button variant="outline" onClick={() => setDeleting(true)}>
                {t('common.delete')}
              </Button>
            )}
          </>
        }
      />
      <form onSubmit={onSubmit} noValidate className="grid max-w-xl gap-4">
        <ClientFields form={form} idPrefix="client" />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        {saved && !isDirty && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.saved')}
          </p>
        )}
        <div>
          <Button type="submit" disabled={!isDirty || save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
      <div>
        <h2 className="mb-3 text-lg font-semibold">{t('clients.detail.quotes')}</h2>
        <DataTable
          query={quotes}
          columns={columns}
          rowKey={(q) => q.id}
          caption={t('clients.detail.quotes')}
          empty={t('clients.detail.noQuotes')}
        />
      </div>
      {deleting && (
        <ConfirmDeleteDialog
          title={t('clients.detail.deleteTitle', { name: client.name })}
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setDeleting(false)
            setDeleteError(null)
          }}
        />
      )}
      {guard.dialog}
    </section>
  )
}
