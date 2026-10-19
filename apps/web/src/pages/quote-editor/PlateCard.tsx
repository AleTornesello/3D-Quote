import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toAppError } from '@/data/errors'
import { usePrinters } from '@/data/printers'
import {
  useClearPriceOverride,
  useRemoveMaterial,
  useRemovePlate,
  useSaveMaterial,
  useSetPlatePrinter,
  useUpdatePlate,
  type QuotePlate,
} from '@/data/quote-plates'
import { parseDuration } from '@/data/quote-rules'
import { formatDuration } from '@/lib/format'
import { numberField } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { InlineField } from './InlineField'
import { PlateMaterials } from './PlateMaterials'
import { PlatePrice } from './PlatePrice'

const QUANTITY = numberField({
  min: 1,
  max: 2147483647,
  decimals: 0,
  rangeError: 'validation.quantity',
})

/** One quote plate. `editable` is true while the quote is a draft. */
export function PlateCard({
  plate,
  editable,
  notCalculated,
}: {
  plate: QuotePlate
  editable: boolean
  notCalculated: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const printers = usePrinters()
  const update = useUpdatePlate()
  const setPrinter = useSetPlatePrinter()
  const saveMaterial = useSaveMaterial()
  const removeMaterial = useRemoveMaterial()
  const clear = useClearPriceOverride()
  const remove = useRemovePlate()
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // One flag for the whole card, so nothing can be edited while any of its changes is being saved.
  const busy = [update, setPrinter, saveMaterial, removeMaterial, clear, remove].some(
    (mutation) => mutation.isPending,
  )
  const id = `plate-${plate.id}`
  const printer = printers.data?.find((p) => p.id === plate.printer_id)
  // A deactivated printer stays listed for the plate that already uses it, so the select shows the truth.
  const printerOptions = (printers.data ?? []).filter((p) => p.active || p.id === plate.printer_id)
  const missing = [
    plate.printer_id === null && t('quotes.plate.missing.printer'),
    plate.print_time_s === null && t('quotes.plate.missing.printTime'),
    plate.materials.length === 0 && t('quotes.plate.missing.materials'),
  ].filter(Boolean)

  async function confirmRemove() {
    setRemoveError(null)
    try {
      await remove.mutateAsync(plate)
      setRemoving(false)
    } catch (caught) {
      setRemoveError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <article aria-labelledby={`${id}-title`} className="grid gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`${id}-title`} className={editable ? 'sr-only' : 'font-medium'}>
          {plate.description}
        </h3>
        {editable && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(true)}>
            <Trash2 aria-hidden />
            {t('quotes.plate.remove')}
          </Button>
        )}
      </div>
      {editable ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InlineField
            id={`${id}-description`}
            label={t('quotes.plate.description')}
            value={plate.description}
            disabled={busy}
            revertOnError
            validate={(text) => (text.trim() ? null : 'validation.required')}
            onSave={(text) => update.mutateAsync({ plate, values: { description: text.trim() } })}
          />
          <FormField id={`${id}-printer`} label={t('quotes.plate.printer')}>
            <NativeSelect
              id={`${id}-printer`}
              className="w-full"
              disabled={busy}
              value={plate.printer_id === null ? '' : String(plate.printer_id)}
              onChange={(event) => {
                if (!event.target.value) return
                setPrinter.mutate(
                  { plate, printerId: Number(event.target.value) },
                  { onError: (caught) => toast.error(t(toAppError(caught).messageKey)) },
                )
              }}
            >
              <NativeSelectOption value="" disabled={plate.printer_id !== null}>
                {t('quotes.plate.choose')}
              </NativeSelectOption>
              {printerOptions.map((p) => (
                <NativeSelectOption key={p.id} value={String(p.id)}>
                  {p.active ? p.name : t('quotes.plate.inactive', { name: p.name })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <InlineField
            id={`${id}-time`}
            label={t('quotes.plate.printTime')}
            inputMode="text"
            disabled={busy}
            value={plate.print_time_s === null ? '' : formatDuration(plate.print_time_s)}
            validate={(text) => (parseDuration(text) === null ? 'validation.duration' : null)}
            onSave={(text) =>
              update.mutateAsync({
                plate,
                values: { print_time_s: parseDuration(text) as number },
              })
            }
          />
          <InlineField
            id={`${id}-quantity`}
            label={t('quotes.plate.quantity')}
            value={String(plate.quantity)}
            inputMode="numeric"
            disabled={busy}
            validate={(text) => {
              const result = QUANTITY.safeParse(text)
              return result.success
                ? null
                : (result.error.issues[0]?.message ?? 'validation.number')
            }}
            onSave={(text) =>
              update.mutateAsync({ plate, values: { quantity: Number(text.trim()) } })
            }
          />
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.plate.printer')}</dt>
            <dd>{printer?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.plate.printTime')}</dt>
            <dd>{plate.print_time_s === null ? '—' : formatDuration(plate.print_time_s)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.plate.quantity')}</dt>
            <dd>{format.number(plate.quantity)}</dd>
          </div>
        </dl>
      )}
      <PlateMaterials
        plate={plate}
        editable={editable}
        busy={busy}
        save={saveMaterial}
        remove={removeMaterial}
      />
      {editable && missing.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('quotes.plate.incomplete', { missing: missing.join(', ') })}
        </p>
      )}
      <PlatePrice
        plate={plate}
        editable={editable}
        notCalculated={notCalculated}
        busy={busy}
        clear={clear}
      />
      {removing && (
        <ConfirmDeleteDialog
          title={t('quotes.plate.removeTitle', { name: plate.description })}
          body={t('quotes.plate.removeBody')}
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
