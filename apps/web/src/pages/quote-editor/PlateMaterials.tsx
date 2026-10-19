import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toAppError } from '@/data/errors'
import { useMaterials } from '@/data/materials'
import type { QuotePlate, useRemoveMaterial, useSaveMaterial } from '@/data/quote-plates'
import { toInputNumber } from '@/lib/format'
import { numberField, parseDecimal } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { materialLabel } from '../quotes/labels'
import { InlineField } from './InlineField'

// numeric(10,2) and > 0 in the database.
const GRAMS = numberField({ gt: 0, max: 99999999.99, decimals: 2, rangeError: 'validation.grams' })

/** An i18n key, or null when the grams are valid. */
function gramsProblem(text: string) {
  const result = GRAMS.safeParse(text)
  return result.success ? null : (result.error.issues[0]?.message ?? 'validation.number')
}

/** The plate's materials: one row each with its grams, and a row to add another (active materials only). */
export function PlateMaterials({
  plate,
  editable,
  busy,
  save,
  remove,
}: {
  plate: QuotePlate
  editable: boolean
  busy: boolean
  save: ReturnType<typeof useSaveMaterial>
  remove: ReturnType<typeof useRemoveMaterial>
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const materials = useMaterials()
  const [newMaterial, setNewMaterial] = useState('')
  const [newGrams, setNewGrams] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const byId = new Map((materials.data ?? []).map((m) => [m.id, m]))
  const used = new Set(plate.materials.map((m) => m.material_id))
  const options = (materials.data ?? []).filter((m) => m.active && !used.has(m.id))
  const id = `plate-${plate.id}`

  async function add() {
    const problem = newMaterial ? gramsProblem(newGrams) : 'quotes.plate.chooseMaterial'
    if (problem) {
      setAddError(problem)
      return
    }
    setAddError(null)
    try {
      await save.mutateAsync({
        plate,
        materialId: Number(newMaterial),
        grams: parseDecimal(newGrams) as number,
      })
      setNewMaterial('')
      setNewGrams('')
    } catch (caught) {
      setAddError(toAppError(caught).messageKey)
    }
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">{t('quotes.plate.materials')}</legend>
      {plate.materials.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('quotes.plate.noMaterials')}</p>
      )}
      {plate.materials.length > 0 && (
        <ul className="grid gap-2">
          {plate.materials.map((row) => {
            const material = byId.get(row.material_id)
            const name = material ? materialLabel(material, t) : '—'
            return (
              <li key={row.id} className="flex flex-wrap items-end gap-3">
                {editable ? (
                  <>
                    <div className="min-w-48 flex-1">
                      <InlineField
                        id={`${id}-grams-${row.id}`}
                        label={t('quotes.plate.gramsOf', { name })}
                        value={toInputNumber(row.grams, format.locale)}
                        inputMode="decimal"
                        disabled={busy}
                        validate={gramsProblem}
                        onSave={(text) =>
                          save.mutateAsync({
                            plate,
                            materialId: row.material_id,
                            grams: parseDecimal(text) as number,
                          })
                        }
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={t('quotes.plate.removeMaterial', { name })}
                      onClick={() =>
                        remove.mutate(
                          { plate, materialRowId: row.id },
                          { onError: (caught) => toast.error(t(toAppError(caught).messageKey)) },
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1">{name}</span>
                    <span className="tabular-nums">
                      {t('quotes.plate.gramsValue', { value: format.number(row.grams) })}
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editable && (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-48 flex-1">
            <FormField id={`${id}-new-material`} label={t('quotes.plate.addMaterial')}>
              <NativeSelect
                id={`${id}-new-material`}
                className="w-full"
                value={newMaterial}
                disabled={busy}
                onChange={(event) => setNewMaterial(event.target.value)}
              >
                <NativeSelectOption value="">{t('quotes.plate.choose')}</NativeSelectOption>
                {options.map((m) => (
                  <NativeSelectOption key={m.id} value={String(m.id)}>
                    {materialLabel(m, t)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <div className="w-32">
            <FormField
              id={`${id}-new-grams`}
              label={t('quotes.plate.grams')}
              error={addError ?? undefined}
            >
              <Input
                id={`${id}-new-grams`}
                inputMode="decimal"
                value={newGrams}
                disabled={busy}
                aria-invalid={!!addError}
                onChange={(event) => setNewGrams(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void add()
                  }
                }}
              />
            </FormField>
          </div>
          <Button variant="outline" className="mt-6" disabled={busy} onClick={() => void add()}>
            {t('quotes.plate.addRow')}
          </Button>
        </div>
      )}
    </fieldset>
  )
}
