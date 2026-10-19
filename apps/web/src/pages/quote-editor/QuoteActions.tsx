import { Copy, FileDown, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useStaff } from '@/auth/staff-context'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import type { QuoteConsumable } from '@/data/quote-consumables'
import type { QuotePlate } from '@/data/quote-plates'
import { incompletePlates } from '@/data/quote-rules'
import { useDeleteQuote, useDuplicateQuote, useMarkQuote, type Quote } from '@/data/quotes'
import { ExportPdfDialog } from '@/pdf/ExportPdfDialog'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { SendQuoteDialog } from './SendQuoteDialog'

type OpenDialog = 'send' | 'accepted' | 'rejected' | 'delete' | 'export' | null

/** The actions the quote's status allows (functional analysis §4). */
export function QuoteActions({
  quote,
  plates,
  consumables,
  consumablesReady,
}: {
  quote: Quote
  plates: QuotePlate[]
  consumables: QuoteConsumable[]
  /** The consumable lines have loaded; the PDF would otherwise miss them. */
  consumablesReady: boolean
}) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const navigate = useNavigate()
  const mark = useMarkQuote()
  const duplicate = useDuplicateQuote()
  const remove = useDeleteQuote()
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const [error, setError] = useState<string | null>(null)
  // Mark as sent stays enabled: its dialog explains what is missing.
  const notReady =
    incompletePlates(plates).length > 0 || plates.some((plate) => plate.plate_total === null)
  const exportBlocked = plates.length === 0 || notReady || !consumablesReady

  function close() {
    setDialog(null)
    setError(null)
  }

  async function runDuplicate() {
    try {
      const id = await duplicate.mutateAsync(quote.id)
      toast.success(t('quotes.editor.duplicated'))
      navigate(`/quotes/${id}`)
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function confirmOutcome(outcome: 'accepted' | 'rejected') {
    setError(null)
    try {
      await mark.mutateAsync({ quoteId: quote.id, outcome })
      close()
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  async function confirmDelete() {
    setError(null)
    try {
      await remove.mutateAsync(quote.id)
      navigate('/quotes')
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <>
      {quote.status === 'draft' && (
        <Button onClick={() => setDialog('send')}>
          <Send aria-hidden />
          {t('quotes.editor.markSent')}
        </Button>
      )}
      {quote.status === 'sent' && (
        <>
          <Button onClick={() => setDialog('accepted')}>{t('quotes.editor.markAccepted')}</Button>
          <Button variant="outline" onClick={() => setDialog('rejected')}>
            {t('quotes.editor.markRejected')}
          </Button>
        </>
      )}
      <Button variant="outline" disabled={duplicate.isPending} onClick={() => void runDuplicate()}>
        <Copy aria-hidden />
        {t('quotes.editor.duplicate')}
      </Button>
      <Button
        variant="outline"
        disabled={exportBlocked}
        aria-describedby={exportBlocked ? 'export-hint' : undefined}
        onClick={() => setDialog('export')}
      >
        <FileDown aria-hidden />
        {t('quotes.pdf.export')}
      </Button>
      {exportBlocked && (
        <span id="export-hint" className="self-center text-sm text-muted-foreground">
          {t(
            plates.length === 0
              ? 'quotes.pdf.needsPlates'
              : notReady
                ? 'quotes.pdf.needsComplete'
                : 'quotes.pdf.loadingConsumables',
          )}
        </span>
      )}
      {quote.status === 'draft' && isOwner && (
        <Button variant="outline" onClick={() => setDialog('delete')}>
          <Trash2 aria-hidden />
          {t('common.delete')}
        </Button>
      )}

      {dialog === 'send' && <SendQuoteDialog quote={quote} plates={plates} onClose={close} />}
      {dialog === 'export' && (
        <ExportPdfDialog quote={quote} plates={plates} consumables={consumables} onClose={close} />
      )}
      {(dialog === 'accepted' || dialog === 'rejected') && (
        <ConfirmActionDialog
          title={t(
            dialog === 'accepted' ? 'quotes.editor.acceptTitle' : 'quotes.editor.rejectTitle',
            { number: quote.number },
          )}
          body={t('quotes.editor.outcomeBody')}
          confirmLabel={t(
            dialog === 'accepted' ? 'quotes.editor.markAccepted' : 'quotes.editor.markRejected',
          )}
          pending={mark.isPending}
          error={error}
          onConfirm={() => void confirmOutcome(dialog)}
          onCancel={close}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDeleteDialog
          title={t('quotes.editor.deleteTitle', { number: quote.number })}
          pending={remove.isPending}
          error={error}
          onConfirm={() => void confirmDelete()}
          onCancel={close}
        />
      )}
    </>
  )
}
