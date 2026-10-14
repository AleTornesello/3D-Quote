import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import { useSavePrinter, type Printer } from '@/data/printers'
import { toInputNumber } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import {
  RATE_MODES,
  formToPrinter,
  hourlyRateFromPurchase,
  printerSchema,
  printerToForm,
  type PrinterForm,
  type RateMode,
} from './printer-form'

type NumberField = readonly [keyof PrinterForm, string]

const SIZE_FIELDS: readonly NumberField[] = [
  ['build_x_mm', 'printers.fields.buildX'],
  ['build_y_mm', 'printers.fields.buildY'],
  ['build_z_mm', 'printers.fields.buildZ'],
  ['nozzle_diameter_mm', 'printers.fields.nozzle'],
]
const DIRECT_RATE_FIELDS: readonly NumberField[] = [['hourly_rate', 'printers.fields.hourlyRate']]
const PURCHASE_RATE_FIELDS: readonly NumberField[] = [
  ['purchase_cost', 'printers.fields.purchaseCost'],
  ['lifetime_hours', 'printers.fields.lifetimeHours'],
]

/** New printer when `printer` is null. */
export function PrinterSheet({
  printer,
  onClose,
}: {
  printer: Printer | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { locale } = format
  const save = useSavePrinter()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isDirty },
  } = useForm<PrinterForm>({
    resolver: zodResolver(printerSchema),
    defaultValues: printerToForm(printer, locale),
  })
  const [rateMode, purchaseCost, lifetimeHours] = useWatch({
    control,
    name: ['rate_mode', 'purchase_cost', 'lifetime_hours'],
  })
  const calculatedRate = hourlyRateFromPurchase(purchaseCost, lifetimeHours)
  const rateModeField = register('rate_mode', {
    // Leaving purchase mode keeps the calculated rate as the typed one, so nothing is lost.
    onChange: (event) => {
      if (event.target.value === 'direct' && calculatedRate !== null) {
        setValue('hourly_rate', toInputNumber(calculatedRate, locale, 2), { shouldDirty: true })
      }
    },
  })

  const numberInput = ([name, label]: NumberField) => (
    <FormField key={name} id={`printer-${name}`} label={t(label)} error={errors[name]?.message}>
      <Input
        id={`printer-${name}`}
        inputMode="decimal"
        aria-invalid={!!errors[name]}
        {...register(name)}
      />
    </FormField>
  )

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await save.mutateAsync({ id: printer?.id, values: formToPrinter(values) })
      onClose()
    } catch (error) {
      const appError = toAppError(error)
      if (appError.kind === 'duplicate' && appError.field === 'name') {
        setError('name', { message: 'printers.duplicateName' })
      } else {
        setFormError(appError.messageKey)
      }
    }
  })

  return (
    <FormSheet
      title={t(printer ? 'printers.edit' : 'printers.new')}
      dirty={isDirty}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormField id="printer-name" label={t('printers.fields.name')} error={errors.name?.message}>
          <Input id="printer-name" aria-invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField
          id="printer-model"
          label={t('printers.fields.model')}
          error={errors.model?.message}
        >
          <Input id="printer-model" aria-invalid={!!errors.model} {...register('model')} />
        </FormField>
        {SIZE_FIELDS.map(numberInput)}
        <FormField id="printer-rate_mode" label={t('printers.fields.rateMode')}>
          <NativeSelect id="printer-rate_mode" className="w-full" {...rateModeField}>
            {RATE_MODES.map((mode: RateMode) => (
              <NativeSelectOption key={mode} value={mode}>
                {t(`printers.rateModes.${mode}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {rateMode === 'purchase' ? (
          <>
            {PURCHASE_RATE_FIELDS.map(numberInput)}
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {t('printers.calculatedRate')}:{' '}
              <span className="font-medium text-foreground">
                {calculatedRate === null
                  ? '—'
                  : t('printers.rateValue', { value: format.currency(calculatedRate) })}
              </span>
            </p>
          </>
        ) : (
          DIRECT_RATE_FIELDS.map(numberInput)
        )}
        {numberInput(['power_w', 'printers.fields.power'])}
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="printer-active" checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor="printer-active">{t('printers.fields.active')}</FieldLabel>
            </Field>
          )}
        />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={!isDirty || save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormSheet>
  )
}
