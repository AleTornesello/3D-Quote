import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { QuoteItem } from '@/data/quote-items'
import { useFormat } from '@/lib/use-format'

/** The quote total: the sum of the (rounded) item totals, or — while any item has no price. */
export function QuoteTotals({
  items,
  editable,
  pricing,
  onRecalculate,
}: {
  items: QuoteItem[]
  editable: boolean
  pricing: boolean
  onRecalculate: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const total =
    items.length > 0 && items.every((item) => item.item_total !== null)
      ? items.reduce((sum, item) => sum + (item.item_total ?? 0), 0)
      : null

  return (
    <section
      aria-labelledby="quote-total-title"
      className="flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4"
    >
      <div>
        <h2 id="quote-total-title" className="text-sm text-muted-foreground">
          {t('quotes.editor.total')}
        </h2>
        <p className="text-2xl font-semibold">{total === null ? '—' : format.currency(total)}</p>
        <p className="text-xs text-muted-foreground">{t('quotes.editor.netOfVat')}</p>
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
