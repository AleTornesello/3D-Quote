import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useStaff } from '@/auth/staff-context'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import type { QuotePlate, useClearPriceOverride } from '@/data/quote-plates'
import { isPlateComplete } from '@/data/quote-rules'
import { useFormat } from '@/lib/use-format'
import { OverrideDialog } from './OverrideDialog'

/** Plate total and unit price, the stored breakdown, and the owner's override. */
export function PlatePrice({
  plate,
  editable,
  notCalculated,
  busy,
  clear,
}: {
  plate: QuotePlate
  editable: boolean
  notCalculated: boolean
  busy: boolean
  clear: ReturnType<typeof useClearPriceOverride>
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { isOwner } = useStaff()
  const [overriding, setOverriding] = useState(false)
  const canOverride = editable && isOwner

  const lines: [string, number | null][] = [
    [t('quotes.plate.price.material'), plate.material_cost],
    [t('quotes.plate.price.machine'), plate.machine_cost],
    [t('quotes.plate.price.energy'), plate.energy_cost],
    [t('quotes.plate.price.failure'), plate.failure_cost],
    [t('quotes.plate.price.setupFee'), plate.setup_fee],
    [
      t('quotes.plate.price.markup', { pct: format.number(plate.markup_pct ?? 0) }),
      plate.markup_amount,
    ],
    [t('quotes.plate.price.computed'), plate.computed_total],
  ]

  return (
    <div className="grid gap-2">
      {plate.plate_total !== null ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-1">
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.plate.price.total')}</dt>
            <dd className="text-lg font-semibold">{format.currency(plate.plate_total)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.plate.price.unit')}</dt>
            <dd>{format.currency(plate.plate_total / plate.quantity)}</dd>
          </div>
        </dl>
      ) : (
        isPlateComplete(plate) && (
          <p className="text-sm text-muted-foreground">
            {t(
              notCalculated ? 'quotes.plate.price.notCalculated' : 'quotes.plate.price.calculating',
            )}
          </p>
        )
      )}
      {plate.override_total !== null && (
        <div className="text-sm">
          <p>
            {t('quotes.plate.price.overridden', {
              total: format.currency(plate.override_total),
              computed: plate.computed_total === null ? '—' : format.currency(plate.computed_total),
            })}
          </p>
          {plate.override_reason && (
            <p className="text-muted-foreground">
              {t('quotes.plate.price.reason', { reason: plate.override_reason })}
            </p>
          )}
        </div>
      )}
      {plate.computed_total !== null && (
        <details className="text-sm">
          <summary className="cursor-pointer">{t('quotes.plate.price.breakdown')}</summary>
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
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setOverriding(true)}>
            {t('quotes.plate.price.override')}
          </Button>
          {plate.override_total !== null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                clear.mutate(plate, {
                  onError: (caught) => toast.error(t(toAppError(caught).messageKey)),
                })
              }
            >
              {t('quotes.plate.price.removeOverride')}
            </Button>
          )}
        </div>
      )}
      {overriding && <OverrideDialog plate={plate} onClose={() => setOverriding(false)} />}
    </div>
  )
}
