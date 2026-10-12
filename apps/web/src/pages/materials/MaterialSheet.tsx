import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ChangeEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import {
  MATERIAL_TYPES,
  TYPE_DENSITY,
  useSaveMaterial,
  type Material,
  type MaterialType,
} from '@/data/materials'
import { toInputNumber } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { formToMaterial, materialSchema, materialToForm, type MaterialForm } from './material-form'

/** New material when `material` is null. */
export function MaterialSheet({
  material,
  onClose,
}: {
  material: Material | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const save = useSaveMaterial()
  const [formError, setFormError] = useState<string | null>(null)
  // Set once the user types a density; from then on a type change no longer overwrites it.
  const [densityEdited, setDensityEdited] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isDirty },
  } = useForm<MaterialForm>({
    resolver: zodResolver(materialSchema),
    defaultValues: materialToForm(material, locale),
  })

  const typeField = register('type', {
    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
      const density = TYPE_DENSITY[event.target.value as MaterialType]
      if (density !== undefined && !densityEdited) {
        setValue('density_g_cm3', toInputNumber(density, locale, 2))
      }
    },
  })
  const densityField = register('density_g_cm3', {
    onChange: () => {
      setDensityEdited(true)
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await save.mutateAsync({ id: material?.id, values: formToMaterial(values) })
      onClose()
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <FormSheet
      title={t(material ? 'materials.edit' : 'materials.new')}
      dirty={isDirty}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormField
          id="material-name"
          label={t('materials.fields.name')}
          error={errors.name?.message}
        >
          <Input id="material-name" aria-invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField
          id="material-type"
          label={t('materials.fields.type')}
          error={errors.type?.message}
        >
          <NativeSelect id="material-type" className="w-full" {...typeField}>
            {MATERIAL_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {type === 'other' ? t('materials.types.other') : type}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="material-color" label={t('materials.fields.color')}>
          <Input id="material-color" {...register('color')} />
        </FormField>
        <FormField
          id="material-cost"
          label={t('materials.fields.costPerKg')}
          error={errors.cost_per_kg?.message}
        >
          <Input
            id="material-cost"
            inputMode="decimal"
            aria-invalid={!!errors.cost_per_kg}
            {...register('cost_per_kg')}
          />
        </FormField>
        <FormField
          id="material-density"
          label={t('materials.fields.density')}
          error={errors.density_g_cm3?.message}
        >
          <Input
            id="material-density"
            inputMode="decimal"
            aria-invalid={!!errors.density_g_cm3}
            {...densityField}
          />
        </FormField>
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="material-active" checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor="material-active">{t('materials.fields.active')}</FieldLabel>
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
