import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { QueryError } from '@/components/QueryError'
import { useLeaveGuard } from '@/components/use-leave-guard'
import { useQuoteLiveUpdates } from '@/data/quote-live'
import { useQuoteItems } from '@/data/quote-items'
import { useQuote, useRefreshQuote, type Quote } from '@/data/quotes'
import { NotFoundMessage } from './NotFoundPage'
import { ItemCard } from './quote-editor/ItemCard'
import { QuoteActions } from './quote-editor/QuoteActions'
import { QuoteHeader } from './quote-editor/QuoteHeader'
import { QuoteTotals } from './quote-editor/QuoteTotals'
import { UploadZone } from './quote-editor/UploadZone'
import { useAutoPrice } from './quote-editor/use-auto-price'
import { useUploads } from './quote-editor/use-uploads'

export function QuoteEditorPage() {
  const { t } = useTranslation()
  const { id: rawId } = useParams()
  const id = Number(rawId)
  const valid = Number.isInteger(id) && id > 0
  const quote = useQuote(valid ? id : null)

  if (!valid) return <NotFoundMessage />
  if (quote.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  if (quote.isError && quote.data === undefined) {
    return <QueryError error={quote.error} onRetry={() => void quote.refetch()} />
  }
  if (!quote.data) return <NotFoundMessage />
  return (
    <>
      {quote.isError && <QueryError error={quote.error} onRetry={() => void quote.refetch()} />}
      <QuoteEditor key={quote.data.id} quote={quote.data} />
    </>
  )
}

function QuoteEditor({ quote }: { quote: Quote }) {
  const { t } = useTranslation()
  const items = useQuoteItems(quote.id)
  const itemList = items.data ?? []
  const editable = quote.status === 'draft'
  const refreshQuote = useRefreshQuote()
  const uploads = useUploads(quote.id, itemList, () => void refreshQuote(quote.id))
  const guard = useLeaveGuard(uploads.busy, {
    titleKey: 'quotes.upload.leaveTitle',
    bodyKey: 'quotes.upload.leaveBody',
  })
  const pricing = useAutoPrice(quote, items.data)
  useQuoteLiveUpdates(
    quote.id,
    itemList.map((item) => item.id),
  )

  return (
    <section className="grid gap-6">
      <QuoteHeader quote={quote} actions={<QuoteActions quote={quote} items={itemList} />} />
      <section aria-labelledby="quote-items-title" className="grid gap-4">
        <h2 id="quote-items-title" className="text-lg font-semibold">
          {t('quotes.editor.items')}
        </h2>
        {items.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : items.isError && items.data === undefined ? (
          <QueryError error={items.error} onRetry={() => void items.refetch()} />
        ) : (
          <ul className="grid gap-4">
            {itemList.map((item) => (
              <li key={item.id}>
                <ItemCard
                  item={item}
                  editable={editable}
                  notCalculated={pricing.notCalculated(item)}
                />
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <UploadZone uploads={uploads} empty={items.isSuccess && itemList.length === 0} />
        )}
        {items.isSuccess && (
          <QuoteTotals
            items={itemList}
            editable={editable}
            pricing={pricing.pricing}
            onRecalculate={pricing.recalculate}
          />
        )}
      </section>
      {guard.dialog}
    </section>
  )
}
