import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useStaff } from '@/auth/staff-context'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useClearPriceOverride, type QuoteItem } from '@/data/quote-items'
import { useFormat } from '@/lib/use-format'
import { OverrideDialog } from './OverrideDialog'

/** Item total and unit price, the stored breakdown, and the owner's override. */
export function ItemPrice({
  item,
  editable,
  notCalculated,
}: {
  item: QuoteItem
  editable: boolean
  notCalculated: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { isOwner } = useStaff()
  const clear = useClearPriceOverride()
  const [overriding, setOverriding] = useState(false)
  const canOverride = editable && isOwner

  const lines: [string, number | null][] = [
    [t('quotes.item.price.material'), item.material_cost],
    [t('quotes.item.price.machine'), item.machine_cost],
    [t('quotes.item.price.energy'), item.energy_cost],
    [t('quotes.item.price.failure'), item.failure_cost],
    [t('quotes.item.price.setupFee'), item.setup_fee],
    [
      t('quotes.item.price.markup', { pct: format.number(item.markup_pct ?? 0) }),
      item.markup_amount,
    ],
    [t('quotes.item.price.computed'), item.computed_total],
  ]

  return (
    <div className="grid gap-2">
      {item.item_total !== null ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-1">
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.item.price.total')}</dt>
            <dd className="text-lg font-semibold">{format.currency(item.item_total)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.item.price.unit')}</dt>
            <dd>{format.currency(item.item_total / item.quantity)}</dd>
          </div>
        </dl>
      ) : (
        item.print_time_s !== null && (
          <p className="text-sm text-muted-foreground">
            {t(notCalculated ? 'quotes.item.price.notCalculated' : 'quotes.item.price.calculating')}
          </p>
        )
      )}
      {item.override_total !== null && (
        <div className="text-sm">
          <p>
            {t('quotes.item.price.overridden', {
              total: format.currency(item.override_total),
              computed: item.computed_total === null ? '—' : format.currency(item.computed_total),
            })}
          </p>
          {item.override_reason && (
            <p className="text-muted-foreground">
              {t('quotes.item.price.reason', { reason: item.override_reason })}
            </p>
          )}
        </div>
      )}
      {item.computed_total !== null && (
        <details className="text-sm">
          <summary className="cursor-pointer">{t('quotes.item.price.breakdown')}</summary>
          <dl className="mt-2 grid max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {lines.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd className="text-right tabular-nums">{format.currency(value ?? 0)}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}
      {canOverride && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOverriding(true)}>
            {t('quotes.item.price.override')}
          </Button>
          {item.override_total !== null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate(item, {
                  onError: (caught) => toast.error(t(toAppError(caught).messageKey)),
                })
              }
            >
              {t('quotes.item.price.removeOverride')}
            </Button>
          )}
        </div>
      )}
      {overriding && <OverrideDialog item={item} onClose={() => setOverriding(false)} />}
    </div>
  )
}
