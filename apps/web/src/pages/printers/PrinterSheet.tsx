import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import { useSavePrinter, type Printer } from '@/data/printers'
import { useFormat } from '@/lib/use-format'
import { formToPrinter, printerSchema, printerToForm, type PrinterForm } from './printer-form'

const NUMBER_FIELDS = [
  ['build_x_mm', 'printers.fields.buildX'],
  ['build_y_mm', 'printers.fields.buildY'],
  ['build_z_mm', 'printers.fields.buildZ'],
  ['nozzle_diameter_mm', 'printers.fields.nozzle'],
  ['hourly_rate', 'printers.fields.hourlyRate'],
  ['power_w', 'printers.fields.power'],
] as const

/** New printer when `printer` is null. */
export function PrinterSheet({
  printer,
  onClose,
}: {
  printer: Printer | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const save = useSavePrinter()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<PrinterForm>({
    resolver: zodResolver(printerSchema),
    defaultValues: printerToForm(printer, locale),
  })

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
        {NUMBER_FIELDS.map(([name, label]) => (
          <FormField
            key={name}
            id={`printer-${name}`}
            label={t(label)}
            error={errors[name]?.message}
          >
            <Input
              id={`printer-${name}`}
              inputMode="decimal"
              aria-invalid={!!errors[name]}
              {...register(name)}
            />
          </FormField>
        ))}
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
