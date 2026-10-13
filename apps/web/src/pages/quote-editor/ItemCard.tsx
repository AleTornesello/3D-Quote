import { FileBox, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { usePrinters } from '@/data/printers'
import { useModelDownload, useRemoveItem, useUpdateItem, type QuoteItem } from '@/data/quote-items'
import { fitsPrinter } from '@/data/quote-rules'
import { InlineField } from './InlineField'
import { ItemPrice } from './ItemPrice'
import { ItemSettings } from './ItemSettings'
import { SlicingStatus } from './SlicingStatus'

/** One quote item. `editable` is true while the quote is a draft. */
export function ItemCard({
  item,
  editable,
  notCalculated,
}: {
  item: QuoteItem
  editable: boolean
  notCalculated: boolean
}) {
  const { t } = useTranslation()
  const printers = usePrinters()
  const update = useUpdateItem()
  const remove = useRemoveItem()
  const download = useModelDownload()
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const printer = printers.data?.find((p) => p.id === item.printer_id)
  const titleId = `item-${item.id}-title`

  async function openDownload() {
    try {
      const url = await download.mutateAsync(item.model_path)
      window.open(url, '_blank', 'noopener')
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function confirmRemove() {
    setRemoveError(null)
    try {
      await remove.mutateAsync(item)
      setRemoving(false)
    } catch (caught) {
      setRemoveError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <article aria-labelledby={titleId} className="grid gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h3 id={titleId} className={editable ? 'sr-only' : 'font-medium'}>
            {item.description}
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <FileBox aria-hidden className="size-4" />
            {item.original_filename}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={download.isPending}
              aria-label={t('quotes.item.download', { name: item.original_filename })}
              onClick={() => void openDownload()}
            >
              {t('quotes.item.downloadShort')}
            </Button>
          </p>
        </div>
        {editable && (
          <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}>
            <Trash2 aria-hidden />
            {t('quotes.item.remove')}
          </Button>
        )}
      </div>
      {editable && (
        <InlineField
          id={`item-${item.id}-description`}
          label={t('quotes.item.description')}
          value={item.description}
          disabled={update.isPending}
          revertOnError
          validate={(text) => (text.trim() ? null : 'validation.required')}
          onSave={(text) => update.mutateAsync({ item, values: { description: text.trim() } })}
        />
      )}
      <ItemSettings item={item} editable={editable} />
      <SlicingStatus item={item} editable={editable} />
      {printer && !fitsPrinter(item, printer) && (
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <TriangleAlert aria-hidden className="size-4" />
          {t('quotes.item.doesNotFit', { printer: printer.name })}
        </p>
      )}
      <ItemPrice item={item} editable={editable} notCalculated={notCalculated} />
      {removing && (
        <ConfirmDeleteDialog
          title={t('quotes.item.removeTitle', { name: item.description })}
          body={t('quotes.item.removeBody')}
          pending={remove.isPending}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onCancel={() => {
            setRemoving(false)
            setRemoveError(null)
          }}
        />
      )}
    </article>
  )
}
