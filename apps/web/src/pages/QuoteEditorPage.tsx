import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { QueryError } from '@/components/QueryError'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { usePrinters } from '@/data/printers'
import { useQuoteLiveUpdates } from '@/data/quote-live'
import { useQuoteConsumables } from '@/data/quote-consumables'
import { useCreatePlate, useQuotePlates } from '@/data/quote-plates'
import { useQuote, type Quote } from '@/data/quotes'
import { NotFoundMessage } from './NotFoundPage'
import { PlateCard } from './quote-editor/PlateCard'
import { QuoteActions } from './quote-editor/QuoteActions'
import { QuoteConsumables } from './quote-editor/QuoteConsumables'
import { QuoteHeader } from './quote-editor/QuoteHeader'
import { QuoteTotals } from './quote-editor/QuoteTotals'
import { useAutoPrice } from './quote-editor/use-auto-price'

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
  const plates = useQuotePlates(quote.id)
  const plateList = plates.data ?? []
  const consumables = useQuoteConsumables(quote.id)
  const consumableList = consumables.data ?? []
  const printers = usePrinters()
  const editable = quote.status === 'draft'
  const pricing = useAutoPrice(quote, plates.data)
  const createPlate = useCreatePlate()
  useQuoteLiveUpdates(quote.id)

  function addPlate() {
    // The newest plate's printer, while it is still active (an inactive one would be refused).
    const lastPrinterId = plateList.at(-1)?.printer_id ?? null
    const active = printers.data?.some((p) => p.id === lastPrinterId && p.active) ?? false
    createPlate.mutate(
      {
        quoteId: quote.id,
        description: t('quotes.plate.defaultName', { number: plateList.length + 1 }),
        printer_id: active ? lastPrinterId : null,
      },
      { onError: (caught) => toast.error(t(toAppError(caught).messageKey)) },
    )
  }

  return (
    <section className="grid gap-6">
      <QuoteHeader
        quote={quote}
        actions={
          <QuoteActions
            quote={quote}
            plates={plateList}
            consumables={consumableList}
            consumablesReady={consumables.isSuccess}
          />
        }
      />
      <section aria-labelledby="quote-plates-title" className="grid gap-4">
        <h2 id="quote-plates-title" className="text-lg font-semibold">
          {t('quotes.editor.plates')}
        </h2>
        {plates.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : plates.isError && plates.data === undefined ? (
          <QueryError error={plates.error} onRetry={() => void plates.refetch()} />
        ) : plateList.length === 0 ? (
          <p className="text-muted-foreground">{t('quotes.plate.empty')}</p>
        ) : (
          <ul className="grid gap-4">
            {plateList.map((plate) => (
              <li key={plate.id}>
                <PlateCard
                  plate={plate}
                  editable={editable}
                  notCalculated={pricing.notCalculated(plate)}
                />
              </li>
            ))}
          </ul>
        )}
        {editable && plates.isSuccess && (
          <div>
            <Button variant="outline" disabled={createPlate.isPending} onClick={addPlate}>
              <Plus aria-hidden />
              {t('quotes.plate.add')}
            </Button>
          </div>
        )}
      </section>
      <QuoteConsumables quoteId={quote.id} lines={consumableList} editable={editable} />
      {consumables.isError && consumables.data === undefined && (
        <QueryError error={consumables.error} onRetry={() => void consumables.refetch()} />
      )}
      {plates.isSuccess && consumables.isSuccess && (
        <QuoteTotals
          quote={quote}
          plates={plateList}
          consumables={consumableList}
          editable={editable}
          pricing={pricing.pricing}
          onRecalculate={pricing.recalculate}
        />
      )}
    </section>
  )
}
