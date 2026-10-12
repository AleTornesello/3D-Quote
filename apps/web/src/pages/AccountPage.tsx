import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { useStaff } from '@/auth/staff-context'
import { useChangeLanguage } from '@/auth/use-change-language'
import { FormField } from '@/components/FormField'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useLeaveGuard } from '@/components/use-leave-guard'
import { useChangePassword } from '@/data/account'
import { toAppError } from '@/data/errors'
import { useSaveOwnProfile } from '@/data/staff'
import { LANGUAGES, type Language } from '@/i18n'
import { requiredText } from '@/lib/forms'

const profileSchema = z.object({ display_name: requiredText(100) })
type ProfileForm = z.infer<typeof profileSchema>

const passwordSchema = z
  .object({ password: z.string().min(6, 'validation.passwordLength'), confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'validation.passwordMismatch',
  })
type PasswordForm = z.infer<typeof passwordSchema>

export function AccountPage() {
  const { t } = useTranslation()
  return (
    <section className="grid max-w-xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.account')}</h1>
      <ProfileCard />
      <PasswordCard />
    </section>
  )
}

function ProfileCard() {
  const { t, i18n } = useTranslation()
  const staff = useStaff()
  const save = useSaveOwnProfile()
  const language = useChangeLanguage()
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: staff.displayName },
  })
  const guard = useLeaveGuard(isDirty)

  const onSubmit = handleSubmit(async ({ display_name }) => {
    setSaved(false)
    setFormError(null)
    try {
      await save.mutateAsync({ userId: staff.userId, display_name })
      reset({ display_name })
      setSaved(true)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('account.profile.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField
            id="account-name"
            label={t('account.profile.name')}
            error={errors.display_name?.message}
          >
            <Input
              id="account-name"
              autoComplete="name"
              aria-invalid={!!errors.display_name}
              {...register('display_name')}
            />
          </FormField>
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
        </form>
        <FormField id="account-language" label={t('account.profile.language')}>
          <NativeSelect
            id="account-language"
            value={i18n.language}
            onChange={(event) => void language.change(event.target.value as Language)}
          >
            {LANGUAGES.map((lng) => (
              <NativeSelectOption key={lng} value={lng}>
                {t(`language.${lng}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {language.saveFailed && (
          <p role="alert" className="text-sm text-destructive">
            {t('language.saveFailed')}
          </p>
        )}
      </CardContent>
      {guard.dialog}
    </Card>
  )
}

/** Also completes a password reset: the reset email links to /account?reset=1 with a recovery session. */
function PasswordCard() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const resetting = params.get('reset') === '1'
  const change = useChangePassword()
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const passwordInput = useRef<HTMLInputElement | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirm: '' },
  })
  const passwordField = register('password')

  useEffect(() => {
    if (resetting) passwordInput.current?.focus()
  }, [resetting])

  const onSubmit = handleSubmit(async ({ password }) => {
    setDone(false)
    setFormError(null)
    try {
      await change.mutateAsync(password)
      reset()
      setDone(true)
      if (resetting) setParams({}, { replace: true })
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('account.password.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {resetting && (
            <Alert>
              <AlertDescription>{t('account.password.resetBanner')}</AlertDescription>
            </Alert>
          )}
          <FormField
            id="account-password"
            label={t('account.password.new')}
            error={errors.password?.message}
          >
            <Input
              id="account-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...passwordField}
              ref={(element) => {
                passwordField.ref(element)
                passwordInput.current = element
              }}
            />
          </FormField>
          <FormField
            id="account-confirm"
            label={t('account.password.confirm')}
            error={errors.confirm?.message}
          >
            <Input
              id="account-confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              {...register('confirm')}
            />
          </FormField>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('account.password.changed')}
            </p>
          )}
          <div>
            <Button type="submit" disabled={change.isPending}>
              {t('account.password.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
