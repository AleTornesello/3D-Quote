import { Clock, Loader2, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useRetrySlicing, type QuoteItem } from '@/data/quote-items'
import { slicingState } from '@/data/quote-rules'
import { formatDuration, formatElapsed } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { useNow } from '@/lib/use-now'

/** The item's slicing state and, once done, its results (functional analysis §7). */
export function SlicingStatus({ item, editable }: { item: QuoteItem; editable: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const retry = useRetrySlicing()
  const ticking = item.job?.status === 'queued' || item.job?.status === 'running'
  const now = useNow(ticking)
  const state = slicingState(item, now)

  switch (state.kind) {
    case 'waiting':
      return <p className="text-sm text-muted-foreground">{t('quotes.item.slicing.waiting')}</p>
    case 'queued':
    case 'slicing':
      return (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {state.kind === 'queued'
            ? t('quotes.item.slicing.queued')
            : t('quotes.item.slicing.slicing', { elapsed: formatElapsed(state.elapsedS) })}
        </p>
      )
    case 'slow':
      return (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"
        >
          <Clock aria-hidden className="size-4" />
          {t('quotes.item.slicing.slow')}
        </p>
      )
    case 'failed':
      return (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-destructive">{t('quotes.item.slicing.failed')}</p>
          {state.error && <p className="text-sm">{state.error}</p>}
          {editable && (
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={retry.isPending}
                onClick={() =>
                  retry.mutate(item, {
                    onError: (caught) => toast.error(t(toAppError(caught).messageKey)),
                  })
                }
              >
                <RotateCw aria-hidden />
                {t('quotes.item.slicing.retry')}
              </Button>
            </div>
          )}
        </div>
      )
    case 'done':
      return (
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('quotes.item.results.printTime')}</dt>
            <dd>{formatDuration(item.print_time_s ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('quotes.item.results.filament')}</dt>
            <dd>
              {t('quotes.item.results.grams', { value: format.number(item.filament_g ?? 0) })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('quotes.item.results.bbox')}</dt>
            <dd>
              {t('quotes.item.results.bboxValue', {
                x: format.number(item.bbox_x_mm ?? 0),
                y: format.number(item.bbox_y_mm ?? 0),
                z: format.number(item.bbox_z_mm ?? 0),
              })}
            </dd>
          </div>
        </dl>
      )
  }
}
