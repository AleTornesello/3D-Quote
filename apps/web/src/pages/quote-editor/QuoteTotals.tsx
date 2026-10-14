import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { QuoteItem } from '@/data/quote-items'
import { quoteTotals, vatRateFor } from '@/data/quote-rules'
import type { Quote } from '@/data/quotes'
import { useSettings } from '@/data/settings'
import { useFormat } from '@/lib/use-format'

/**
 * Net total (the sum of the rounded item totals), VAT and the total including VAT; — while any item has no price or
 * the shop rate is still loading. A sent quote shows the rate it was sent with.
 */
export function QuoteTotals({
  quote,
  items,
  editable,
  pricing,
  onRecalculate,
}: {
  quote: Quote
  items: QuoteItem[]
  editable: boolean
  pricing: boolean
  onRecalculate: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const settings = useSettings()
  const rate = vatRateFor(quote, settings.data)
  const totals = rate === null ? null : quoteTotals(items, rate)
  const money = (value: number | undefined) => (value === undefined ? '—' : format.currency(value))

  return (
    <section
      aria-labelledby="quote-total-title"
      className="flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4"
    >
      <div className="grid gap-1">
        <h2 id="quote-total-title" className="text-sm text-muted-foreground">
          {t('quotes.editor.total')}
        </h2>
        <dl className="grid grid-cols-[auto_auto] justify-start gap-x-6 gap-y-1">
          <dt className="text-sm text-muted-foreground">{t('quotes.editor.netTotal')}</dt>
          <dd className="text-right">{money(totals?.net)}</dd>
          <dt className="text-sm text-muted-foreground">
            {t('quotes.editor.vat', { rate: rate === null ? '—' : format.number(rate) })}
          </dt>
          <dd className="text-right">{money(totals?.vat)}</dd>
          <dt className="self-end text-sm text-muted-foreground">
            {t('quotes.editor.totalInclVat')}
          </dt>
          <dd className="text-right text-2xl font-semibold">{money(totals?.gross)}</dd>
        </dl>
      </div>
      {editable && (
        <Button variant="outline" disabled={pricing} onClick={onRecalculate}>
          <RefreshCw aria-hidden />
          {t('quotes.editor.recalculate')}
        </Button>
      )}
    </section>
  )
}
