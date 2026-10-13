import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QueryError } from '@/components/QueryError'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { usePrinters } from '@/data/printers'
import type { QuoteItem } from '@/data/quote-items'
import { useMarkQuote, useSendBlockers, type Quote, type SendBlocker } from '@/data/quotes'

/** Lists what stops the quote from being sent, or confirms sending it. */
export function SendQuoteDialog({
  quote,
  items,
  onClose,
}: {
  quote: Quote
  items: QuoteItem[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const blockers = useSendBlockers(quote.id, true)
  const printers = usePrinters()
  const mark = useMarkQuote()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setError(null)
    try {
      await mark.mutateAsync({ quoteId: quote.id, outcome: 'sent' })
      onClose()
    } catch (caught) {
      const appError = toAppError(caught)
      // Something changed since the check: show the new reasons instead of a generic error.
      if (appError.kind === 'notSendable') void blockers.refetch()
      else setError(t(appError.messageKey))
    }
  }

  function describe(blocker: SendBlocker) {
    const item = items.find((candidate) => candidate.id === blocker.quote_item_id)
    const printer = printers.data?.find((candidate) => candidate.id === item?.printer_id)
    return t(`quotes.editor.blockers.${blocker.code}`, {
      item: item?.description ?? '',
      printer: printer?.name ?? '',
    })
  }

  const list = blockers.data ?? []
  const blocked = list.length > 0
  const canSend = blockers.isSuccess && !blocked
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked
              ? t('quotes.editor.send.blockedTitle', { number: quote.number })
              : t('quotes.editor.send.title', { number: quote.number })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blockers.isPending
              ? t('quotes.editor.send.checking')
              : blocked
                ? t('quotes.editor.send.blockedBody')
                : t('quotes.editor.send.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {blockers.isError && (
          <QueryError error={blockers.error} onRetry={() => void blockers.refetch()} />
        )}
        {blocked && (
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {list.map((blocker, index) => (
              <li key={`${blocker.code}-${blocker.quote_item_id ?? index}`}>{describe(blocker)}</li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          {canSend && (
            <Button onClick={() => void confirm()} disabled={mark.isPending}>
              {t('quotes.editor.markSent')}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
