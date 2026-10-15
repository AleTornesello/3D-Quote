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
import { useSaveConsumable, type Consumable } from '@/data/consumables'
import { toAppError } from '@/data/errors'
import { useFormat } from '@/lib/use-format'
import {
  consumableSchema,
  consumableToForm,
  dirtyConsumableValues,
  formToConsumable,
  type ConsumableForm,
} from './consumable-form'

/** New consumable when `consumable` is null. */
export function ConsumableSheet({
  consumable,
  onClose,
}: {
  consumable: Consumable | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const save = useSaveConsumable()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<ConsumableForm>({
    resolver: zodResolver(consumableSchema),
    defaultValues: consumableToForm(consumable, locale, t('consumables.defaultUnit')),
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await save.mutateAsync({
        id: consumable?.id,
        values: consumable ? dirtyConsumableValues(values, dirtyFields) : formToConsumable(values),
      })
      onClose()
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <FormSheet
      title={t(consumable ? 'consumables.edit' : 'consumables.new')}
      dirty={isDirty}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormField
          id="consumable-name"
          label={t('consumables.fields.name')}
          error={errors.name?.message}
        >
          <Input id="consumable-name" aria-invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField
          id="consumable-unit"
          label={t('consumables.fields.unit')}
          error={errors.unit?.message}
        >
          <Input id="consumable-unit" aria-invalid={!!errors.unit} {...register('unit')} />
        </FormField>
        <FormField
          id="consumable-price"
          label={t('consumables.fields.unitPrice')}
          error={errors.unit_price?.message}
        >
          <Input
            id="consumable-price"
            inputMode="decimal"
            aria-invalid={!!errors.unit_price}
            {...register('unit_price')}
          />
        </FormField>
        <FormField
          id="consumable-stock"
          label={t('consumables.fields.stock')}
          error={errors.stock?.message}
        >
          <Input
            id="consumable-stock"
            inputMode="numeric"
            aria-invalid={!!errors.stock}
            {...register('stock')}
          />
        </FormField>
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch
                id="consumable-active"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <FieldLabel htmlFor="consumable-active">{t('consumables.fields.active')}</FieldLabel>
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
