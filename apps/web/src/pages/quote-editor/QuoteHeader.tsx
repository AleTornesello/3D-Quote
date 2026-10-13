import { Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import type { Quote } from '@/data/quotes'
import { useSettings } from '@/data/settings'
import { useFormat } from '@/lib/use-format'
import { clientLabel } from '../quotes/labels'
import { QuoteStatusBadge } from '../quotes/QuoteStatusBadge'
import { QuoteDetailsSheet } from './QuoteDetailsSheet'

function Detail({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function QuoteHeader({ quote, actions }: { quote: Quote; actions: ReactNode }) {
  const { t } = useTranslation()
  const format = useFormat()
  const settings = useSettings()
  const [editing, setEditing] = useState(false)

  const markup =
    quote.markup_override_pct !== null
      ? t('quotes.editor.markupOverride', { pct: format.number(quote.markup_override_pct) })
      : settings.data
        ? t('quotes.editor.markupDefault', {
            pct: format.number(settings.data.default_markup_pct),
          })
        : '—'

  return (
    <div className="grid gap-4">
      <PageHeader title={quote.number} actions={actions} />
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t('quotes.columns.status')}>
          <QuoteStatusBadge status={quote.status} />
        </Detail>
        <Detail label={t('quotes.editor.client')}>
          <Link to={`/clients/${quote.client.id}`} className="underline-offset-4 hover:underline">
            {clientLabel(quote.client)}
          </Link>
        </Detail>
        <Detail label={t('quotes.columns.created')}>
          {t('quotes.editor.createdBy', {
            name: quote.creator.display_name,
            date: format.date(quote.created_at),
          })}
        </Detail>
        <Detail label={t('quotes.columns.validUntil')}>{format.date(quote.valid_until)}</Detail>
        <Detail label={t('quotes.editor.markup')}>{markup}</Detail>
        <Detail label={t('quotes.form.notes')} wide>
          <span className="whitespace-pre-wrap">{quote.notes ?? '—'}</span>
        </Detail>
      </dl>
      {quote.status === 'draft' && (
        <div>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t('quotes.editor.editDetails')}
          </Button>
        </div>
      )}
      {editing && <QuoteDetailsSheet quote={quote} onClose={() => setEditing(false)} />}
    </div>
  )
}
