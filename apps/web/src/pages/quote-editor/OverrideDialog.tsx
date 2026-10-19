import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toAppError } from '@/data/errors'
import { useSetPriceOverride, type QuotePlate } from '@/data/quote-plates'
import { toInputNumber } from '@/lib/format'
import { numberField, parseDecimal, requiredText } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'

const overrideSchema = z.object({
  total: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  reason: requiredText(500),
})
type OverrideForm = z.infer<typeof overrideSchema>

/** Owner only: the plate total by hand, with a reason staff can see. */
export function OverrideDialog({ plate, onClose }: { plate: QuotePlate; onClose: () => void }) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const setOverride = useSetPriceOverride()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OverrideForm>({
    resolver: zodResolver(overrideSchema),
    defaultValues: {
      total: toInputNumber(plate.override_total ?? plate.computed_total, locale, 2),
      reason: plate.override_reason ?? '',
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await setOverride.mutateAsync({
        plate,
        total: parseDecimal(values.total) as number,
        reason: values.reason.trim(),
      })
      onClose()
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {t('quotes.plate.overrideDialog.title', { name: plate.description })}
          </DialogTitle>
          <DialogDescription>{t('quotes.plate.overrideDialog.body')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField
            id="override-total"
            label={t('quotes.plate.overrideDialog.total')}
            error={errors.total?.message}
          >
            <Input
              id="override-total"
              inputMode="decimal"
              aria-invalid={!!errors.total}
              {...register('total')}
            />
          </FormField>
          <FormField
            id="override-reason"
            label={t('quotes.plate.overrideDialog.reason')}
            error={errors.reason?.message}
          >
            <Textarea id="override-reason" aria-invalid={!!errors.reason} {...register('reason')} />
          </FormField>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={setOverride.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
