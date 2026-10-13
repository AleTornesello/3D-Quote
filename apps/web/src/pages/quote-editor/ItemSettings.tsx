import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ZodType } from 'zod'
import { FormField } from '@/components/FormField'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import { useMaterials } from '@/data/materials'
import { usePrinters } from '@/data/printers'
import {
  useUpdateItem,
  useUpdateItemSettings,
  type QuoteItem,
  type SliceSettings,
} from '@/data/quote-items'
import { toInputNumber } from '@/lib/format'
import { numberField, parseDecimal } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { materialLabel } from '../quotes/labels'
import { InlineField } from './InlineField'

// The database's limits: layer_height_mm numeric(3,2) > 0, infill 0..100, quantity > 0.
const LAYER_HEIGHT = numberField({
  gt: 0,
  max: 9.99,
  decimals: 2,
  rangeError: 'validation.layerHeight',
})
const INFILL = numberField({ min: 0, max: 100, decimals: 0, rangeError: 'validation.percent' })
const QUANTITY = numberField({
  min: 1,
  max: 2147483647,
  decimals: 0,
  rangeError: 'validation.quantity',
})

function check(schema: ZodType) {
  return (text: string) => {
    const result = schema.safeParse(text)
    return result.success ? null : (result.error.issues[0]?.message ?? 'validation.number')
  }
}

function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** Printer, material, quantity, layer height, infill and supports; each saves as soon as it changes. */
export function ItemSettings({ item, editable }: { item: QuoteItem; editable: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const printers = usePrinters()
  const materials = useMaterials()
  const settings = useUpdateItemSettings()
  const update = useUpdateItem()
  const busy = settings.isPending || update.isPending
  const printer = printers.data?.find((p) => p.id === item.printer_id)
  const material = materials.data?.find((m) => m.id === item.material_id)

  if (!editable) {
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <ReadOnly label={t('quotes.item.printer')}>{printer?.name ?? '—'}</ReadOnly>
        <ReadOnly label={t('quotes.item.material')}>
          {material ? materialLabel(material, t) : '—'}
        </ReadOnly>
        <ReadOnly label={t('quotes.item.quantity')}>{format.number(item.quantity)}</ReadOnly>
        <ReadOnly label={t('quotes.item.layerHeight')}>
          {format.number(item.layer_height_mm, 2)}
        </ReadOnly>
        <ReadOnly label={t('quotes.item.infill')}>{format.number(item.infill_percent)}</ReadOnly>
        <ReadOnly label={t('quotes.item.supports')}>
          {t(item.supports ? 'common.yes' : 'common.no')}
        </ReadOnly>
      </dl>
    )
  }

  const save = (change: Partial<SliceSettings>) => settings.mutateAsync({ item, change })
  const saveNow = (change: Partial<SliceSettings>) => {
    save(change).catch((caught: unknown) => toast.error(t(toAppError(caught).messageKey)))
  }
  // Show a change being saved at once, instead of the old value until the refetch lands.
  const current = {
    printer_id: item.printer_id,
    material_id: item.material_id,
    supports: item.supports,
    ...(settings.isPending ? settings.variables?.change : undefined),
  }
  // Deactivated choices stay listed for the item that already uses them, so the select shows the truth.
  const printerOptions = (printers.data ?? []).filter((p) => p.active || p.id === item.printer_id)
  const materialOptions = (materials.data ?? []).filter(
    (m) => m.active || m.id === item.material_id,
  )
  const id = `item-${item.id}`

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id={`${id}-printer`} label={t('quotes.item.printer')}>
        <NativeSelect
          id={`${id}-printer`}
          className="w-full"
          value={current.printer_id === null ? '' : String(current.printer_id)}
          disabled={busy}
          onChange={(event) =>
            saveNow({ printer_id: event.target.value ? Number(event.target.value) : null })
          }
        >
          <NativeSelectOption value="">{t('quotes.item.choose')}</NativeSelectOption>
          {printerOptions.map((p) => (
            <NativeSelectOption key={p.id} value={String(p.id)}>
              {p.active ? p.name : t('quotes.item.inactivePrinter', { name: p.name })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id={`${id}-material`} label={t('quotes.item.material')}>
        <NativeSelect
          id={`${id}-material`}
          className="w-full"
          value={current.material_id === null ? '' : String(current.material_id)}
          disabled={busy}
          onChange={(event) =>
            saveNow({ material_id: event.target.value ? Number(event.target.value) : null })
          }
        >
          <NativeSelectOption value="">{t('quotes.item.choose')}</NativeSelectOption>
          {materialOptions.map((m) => (
            <NativeSelectOption key={m.id} value={String(m.id)}>
              {m.active
                ? materialLabel(m, t)
                : t('quotes.item.inactiveMaterial', { name: materialLabel(m, t) })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <InlineField
        id={`${id}-quantity`}
        label={t('quotes.item.quantity')}
        value={String(item.quantity)}
        inputMode="numeric"
        disabled={busy}
        validate={check(QUANTITY)}
        onSave={async (text) => {
          const quantity = Number(text.trim())
          if (quantity !== item.quantity) await update.mutateAsync({ item, values: { quantity } })
        }}
      />
      <InlineField
        id={`${id}-layer-height`}
        label={t('quotes.item.layerHeight')}
        value={toInputNumber(item.layer_height_mm, format.locale, 2)}
        inputMode="decimal"
        disabled={busy}
        validate={check(LAYER_HEIGHT)}
        onSave={async (text) => {
          const layerHeight = parseDecimal(text) as number
          if (layerHeight !== item.layer_height_mm) await save({ layer_height_mm: layerHeight })
        }}
      />
      <InlineField
        id={`${id}-infill`}
        label={t('quotes.item.infill')}
        value={String(item.infill_percent)}
        inputMode="numeric"
        disabled={busy}
        validate={check(INFILL)}
        onSave={async (text) => {
          const infill = Number(text.trim())
          if (infill !== item.infill_percent) await save({ infill_percent: infill })
        }}
      />
      <div className="flex items-center gap-2 self-end pb-2">
        <Switch
          id={`${id}-supports`}
          checked={current.supports}
          disabled={busy}
          onCheckedChange={(checked) => saveNow({ supports: checked })}
        />
        <Label htmlFor={`${id}-supports`}>{t('quotes.item.supports')}</Label>
      </div>
    </div>
  )
}
