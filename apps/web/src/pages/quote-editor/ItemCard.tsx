import { FileBox, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import {
  useClearPriceOverride,
  useModelDownload,
  useRemoveItem,
  useRetrySlicing,
  useUpdateItem,
  useUpdateItemSettings,
  type QuoteItem,
} from '@/data/quote-items'
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
  const update = useUpdateItem()
  const settings = useUpdateItemSettings()
  const retry = useRetrySlicing()
  const clear = useClearPriceOverride()
  const remove = useRemoveItem()
  const download = useModelDownload()
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // One flag for the whole card, so nothing can be edited while any of its changes is being saved.
  const busy =
    update.isPending || settings.isPending || retry.isPending || clear.isPending || remove.isPending
  const titleId = `item-${item.id}-title`

  async function openDownload() {
    // Opened before the request: browsers like Safari only allow a new tab within the click itself.
    const tab = window.open('', '_blank')
    try {
      const url = await download.mutateAsync(item.model_path)
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else {
        window.location.assign(url)
      }
    } catch (caught) {
      tab?.close()
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
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(true)}>
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
          disabled={busy}
          revertOnError
          validate={(text) => (text.trim() ? null : 'validation.required')}
          onSave={(text) => update.mutateAsync({ item, values: { description: text.trim() } })}
        />
      )}
      <ItemSettings
        item={item}
        editable={editable}
        busy={busy}
        settings={settings}
        update={update}
      />
      <SlicingStatus item={item} editable={editable} busy={busy} retry={retry} />
      <ItemPrice
        item={item}
        editable={editable}
        notCalculated={notCalculated}
        busy={busy}
        clear={clear}
      />
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
