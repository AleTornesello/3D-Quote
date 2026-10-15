import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { QueryError } from '@/components/QueryError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useConsumables } from '@/data/consumables'
import { toAppError } from '@/data/errors'
import {
  useAddQuoteConsumable,
  useRemoveQuoteConsumable,
  useUpdateQuoteConsumable,
  type QuoteConsumable,
} from '@/data/quote-consumables'
import { parseDecimal } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { InlineField } from './InlineField'

const isPositiveInteger = (text: string) => {
  const value = parseDecimal(text)
  return value !== null && Number.isInteger(value) && value > 0
}

/**
 * The quote's consumable lines (bolts, screws…). Editable while the quote is a draft; a quote that left draft shows
 * its lines only when it has any. Stock is only checked here as a warning: it is spent when the quote is sent.
 */
export function QuoteConsumables({
  quoteId,
  lines,
  editable,
}: {
  quoteId: number
  lines: QuoteConsumable[]
  editable: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const consumables = useConsumables()
  const add = useAddQuoteConsumable()
  const update = useUpdateQuoteConsumable()
  const remove = useRemoveQuoteConsumable()
  const [choice, setChoice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const busy = add.isPending || update.isPending || remove.isPending

  if (!editable && lines.length === 0) return null

  async function addLine() {
    setError(null)
    if (!choice || !isPositiveInteger(quantity)) {
      setError(choice ? 'quotes.editor.consumable.quantityInvalid' : 'validation.required')
      return
    }
    try {
      await add.mutateAsync({
        quoteId,
        consumableId: Number(choice),
        quantity: Number(parseDecimal(quantity)),
      })
      setChoice('')
      setQuantity('1')
    } catch (caught) {
      setError(toAppError(caught).messageKey)
    }
  }

  const offered = (consumables.data ?? []).filter((consumable) => consumable.active)

  return (
    <section aria-labelledby="quote-consumables-title" className="grid gap-4">
      <h2 id="quote-consumables-title" className="text-lg font-semibold">
        {t('quotes.editor.consumables')}
      </h2>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('quotes.editor.consumable.empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {lines.map((line) => {
            const low = editable && line.quantity > line.consumable.stock
            return (
              <li key={line.id} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{line.consumable.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('quotes.editor.consumable.unitPrice', {
                        price: format.currency(line.unit_price),
                      })}
                    </p>
                  </div>
                  <p className="font-medium">{format.currency(line.line_total)}</p>
                </div>
                {editable ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <InlineField
                      id={`consumable-${line.id}-quantity`}
                      label={t('quotes.editor.consumable.quantity')}
                      value={String(line.quantity)}
                      inputMode="numeric"
                      disabled={busy}
                      revertOnError
                      validate={(text) =>
                        isPositiveInteger(text) ? null : 'quotes.editor.consumable.quantityInvalid'
                      }
                      onSave={(text) =>
                        update.mutateAsync({ line, quantity: Number(parseDecimal(text)) })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={t('quotes.editor.consumable.remove', {
                        name: line.consumable.name,
                      })}
                      onClick={() => remove.mutate(line)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm">
                    {t('quotes.editor.consumable.quantity')}: {format.number(line.quantity)}
                  </p>
                )}
                {low && (
                  <p role="status" className="text-sm text-destructive">
                    {t('quotes.editor.consumable.lowStock', {
                      stock: format.number(line.consumable.stock),
                      unit: line.consumable.unit,
                    })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(toAppError(remove.error).messageKey)}
        </p>
      )}
      {consumables.isError && (
        <QueryError error={consumables.error} onRetry={() => void consumables.refetch()} />
      )}
      {editable && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField id={`quote-${quoteId}-consumable`} label={t('quotes.editor.consumable.add')}>
            <NativeSelect
              id={`quote-${quoteId}-consumable`}
              value={choice}
              disabled={busy}
              onChange={(event) => setChoice(event.target.value)}
            >
              <NativeSelectOption value="">
                {t('quotes.editor.consumable.choose')}
              </NativeSelectOption>
              {offered.map((consumable) => (
                <NativeSelectOption key={consumable.id} value={String(consumable.id)}>
                  {consumable.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            id={`quote-${quoteId}-consumable-quantity`}
            label={t('quotes.editor.consumable.quantity')}
          >
            <Input
              id={`quote-${quoteId}-consumable-quantity`}
              inputMode="numeric"
              className="w-24"
              value={quantity}
              disabled={busy}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </FormField>
          <Button disabled={busy} onClick={() => void addLine()}>
            {t('common.add')}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
    </section>
  )
}
