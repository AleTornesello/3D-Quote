import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { QuoteConsumable } from '@/data/quote-consumables'
import type { QuotePlate } from '@/data/quote-plates'
import { incompletePlates, quoteTotals, vatRateFor } from '@/data/quote-rules'
import type { Quote } from '@/data/quotes'
import { useSettings } from '@/data/settings'
import { useFormat } from '@/lib/use-format'

/**
 * Net total (the sum of the rounded plate totals and the consumables), VAT and the total including VAT; — while any
 * plate is incomplete or has no price, or the shop rate is still loading. While editing, the incomplete plates are
 * listed. A sent quote shows the rate it was sent with.
 */
export function QuoteTotals({
  quote,
  plates,
  consumables,
  editable,
  pricing,
  onRecalculate,
}: {
  quote: Quote
  plates: QuotePlate[]
  consumables: QuoteConsumable[]
  editable: boolean
  pricing: boolean
  onRecalculate: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const settings = useSettings()
  const rate = vatRateFor(quote, settings.data)
  const totals = rate === null ? null : quoteTotals(plates, rate, consumables)
  const incomplete = incompletePlates(plates)
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
        {editable && incomplete.length > 0 && (
          <div className="mt-2 text-sm text-muted-foreground">
            <p>{t('quotes.editor.completePlates')}</p>
            <ul className="list-disc pl-5">
              {incomplete.map((plate) => (
                <li key={plate.id}>{plate.description}</li>
              ))}
            </ul>
          </div>
        )}
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
