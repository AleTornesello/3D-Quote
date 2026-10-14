import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { AppError, toAppError } from '@/data/errors'
import { useInviteStaff } from '@/data/staff'
import { INVITE_DEFAULTS, inviteSchema, type InviteForm } from './invite-form'

/** Name, email and role of a new person. If the email can't be sent, `onShowLink` offers the link instead. */
export function InviteSheet({
  onClose,
  onShowLink,
}: {
  onClose: () => void
  onShowLink: (userId: string, name: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const invite = useInviteStaff()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: INVITE_DEFAULTS,
  })
  const {
    register,
    setError,
    formState: { errors, isDirty },
  } = form

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    const email = values.email.trim().toLowerCase()
    const name = values.display_name.trim()
    try {
      const result = await invite.mutateAsync({
        email,
        display_name: name,
        role: values.role,
      })
      if (result.email_sent) toast.success(t('staff.toasts.invited', { email }))
      else await onShowLink(result.user_id, name)
      onClose()
    } catch (error) {
      const appError = toAppError(error)
      if (appError instanceof AppError && appError.field === 'email') {
        setError('email', { message: appError.messageKey })
      } else {
        setFormError(appError.messageKey)
      }
    }
  })

  return (
    <FormSheet title={t('staff.invite.title')} dirty={isDirty} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormField
          id="invite-name"
          label={t('staff.invite.name')}
          error={errors.display_name?.message}
        >
          <Input
            id="invite-name"
            autoComplete="off"
            aria-invalid={!!errors.display_name}
            {...register('display_name')}
          />
        </FormField>
        <FormField id="invite-email" label={t('staff.invite.email')} error={errors.email?.message}>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
        </FormField>
        <FormField id="invite-role" label={t('staff.invite.role')}>
          <NativeSelect id="invite-role" {...register('role')}>
            <NativeSelectOption value="operator">{t('staff.roles.operator')}</NativeSelectOption>
            <NativeSelectOption value="owner">{t('staff.roles.owner')}</NativeSelectOption>
          </NativeSelect>
        </FormField>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={invite.isPending}>
          {t('staff.invite.submit')}
        </Button>
      </form>
    </FormSheet>
  )
}
