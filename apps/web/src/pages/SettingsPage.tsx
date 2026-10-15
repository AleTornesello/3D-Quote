import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { ReadOnlyField } from '@/components/ReadOnlyField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useLeaveGuard } from '@/components/use-leave-guard'
import { toAppError } from '@/data/errors'
import { useSaveSettings, useSettings, type Settings } from '@/data/settings'
import { useFormat } from '@/lib/use-format'
import { LogoField } from './settings/LogoField'
import {
  changedSettings,
  settingsSchema,
  settingsToForm,
  type SettingsForm,
} from './settings/settings-form'

export function SettingsPage() {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const settings = useSettings()

  let content: ReactNode
  if (settings.isPending) {
    content = (
      <p role="status" className="text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  } else if (settings.data === undefined) {
    content = <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  } else {
    content = (
      <>
        {settings.isError && (
          <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
        )}
        {isOwner ? (
          <SettingsEditor settings={settings.data} />
        ) : (
          <SettingsView settings={settings.data} />
        )}
      </>
    )
  }

  return (
    <section>
      <PageHeader title={t('nav.settings')} />
      {content}
    </section>
  )
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  )
}

type FieldOptions = { multiline?: boolean; inputMode?: 'decimal' | 'numeric' }

function SettingsEditor({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const save = useSaveSettings()
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsToForm(settings, locale),
  })
  const guard = useLeaveGuard(isDirty)

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false)
    setFormError(null)
    try {
      const updated = await save.mutateAsync(changedSettings(values, dirtyFields))
      reset(settingsToForm(updated, locale))
      setSaved(true)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  const field = (name: keyof SettingsForm, labelKey: string, options: FieldOptions = {}) => {
    const id = `settings-${name}`
    return (
      <FormField key={name} id={id} label={t(labelKey)} error={errors[name]?.message}>
        {options.multiline ? (
          <Textarea id={id} rows={3} aria-invalid={!!errors[name]} {...register(name)} />
        ) : (
          <Input
            id={id}
            inputMode={options.inputMode}
            aria-invalid={!!errors[name]}
            {...register(name)}
          />
        )}
      </FormField>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-6">
      <SettingsCard title={t('settings.pricing.title')}>
        {field('energy_price_kwh', 'settings.pricing.energy', { inputMode: 'decimal' })}
        {field('setup_fee', 'settings.pricing.setupFee', { inputMode: 'decimal' })}
        {field('default_markup_pct', 'settings.pricing.markup', { inputMode: 'decimal' })}
        {field('vat_rate_pct', 'settings.pricing.vat', { inputMode: 'decimal' })}
        {field('minimum_item_price', 'settings.pricing.minimum', { inputMode: 'decimal' })}
        {field('currency', 'settings.pricing.currency')}
      </SettingsCard>
      <SettingsCard title={t('settings.quotes.title')}>
        {field('quote_prefix', 'settings.quotes.prefix')}
        {field('default_validity_days', 'settings.quotes.validity', { inputMode: 'numeric' })}
        {field('pdf_terms_it', 'settings.quotes.termsIt', { multiline: true })}
        {field('pdf_terms_en', 'settings.quotes.termsEn', { multiline: true })}
      </SettingsCard>
      <SettingsCard title={t('settings.shop.title')}>
        {field('shop_name', 'settings.shop.name')}
        {field('shop_address', 'settings.shop.address', { multiline: true })}
        {field('shop_vat_number', 'settings.shop.vat')}
        {field('shop_email', 'settings.shop.email')}
        {field('shop_phone', 'settings.shop.phone')}
        <LogoField path={settings.shop_logo_path} editable />
      </SettingsCard>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {t(formError)}
        </p>
      )}
      {saved && !isDirty && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.saved')}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!isDirty || save.isPending}>
          {t('common.save')}
        </Button>
      </div>
      {guard.dialog}
    </form>
  )
}

function SettingsView({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const format = useFormat()
  const percent = (value: number) => `${format.number(value)} %`
  return (
    <div className="grid max-w-3xl gap-6">
      <SettingsCard title={t('settings.pricing.title')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField
            label={t('settings.pricing.energy')}
            value={t('settings.pricing.energyValue', {
              value: format.number(settings.energy_price_kwh),
              currency: settings.currency,
            })}
          />
          <ReadOnlyField
            label={t('settings.pricing.setupFee')}
            value={format.currency(settings.setup_fee)}
          />
          <ReadOnlyField
            label={t('settings.pricing.markup')}
            value={percent(settings.default_markup_pct)}
          />
          <ReadOnlyField label={t('settings.pricing.vat')} value={percent(settings.vat_rate_pct)} />
          <ReadOnlyField
            label={t('settings.pricing.minimum')}
            value={format.currency(settings.minimum_item_price)}
          />
          <ReadOnlyField label={t('settings.pricing.currency')} value={settings.currency} />
        </dl>
      </SettingsCard>
      <SettingsCard title={t('settings.quotes.title')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label={t('settings.quotes.prefix')} value={settings.quote_prefix} />
          <ReadOnlyField
            label={t('settings.quotes.validity')}
            value={format.number(settings.default_validity_days)}
          />
          <ReadOnlyField label={t('settings.quotes.termsIt')} value={settings.pdf_terms_it} />
          <ReadOnlyField label={t('settings.quotes.termsEn')} value={settings.pdf_terms_en} />
        </dl>
      </SettingsCard>
      <SettingsCard title={t('settings.shop.title')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label={t('settings.shop.name')} value={settings.shop_name} />
          <ReadOnlyField label={t('settings.shop.address')} value={settings.shop_address} />
          <ReadOnlyField label={t('settings.shop.vat')} value={settings.shop_vat_number} />
          <ReadOnlyField label={t('settings.shop.email')} value={settings.shop_email} />
          <ReadOnlyField label={t('settings.shop.phone')} value={settings.shop_phone} />
        </dl>
        <LogoField path={settings.shop_logo_path} editable={false} />
      </SettingsCard>
    </div>
  )
}
