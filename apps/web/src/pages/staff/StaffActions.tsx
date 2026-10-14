import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import {
  useCancelInvitation,
  useInvitationLink,
  useResendInvitation,
  useSetStaffActive,
  type StaffMember,
} from '@/data/staff'
import { staffStatus } from '@/data/staff-rules'
import { ConfirmActionDialog } from '@/pages/quote-editor/ConfirmActionDialog'
import { useShowInvitationLink, type ShownLink } from './use-invitation-link'

/** The actions a row allows for its status. Your own row has none. */
export function StaffActions({
  member,
  isSelf,
  onShowLink,
}: {
  member: StaffMember
  isSelf: boolean
  onShowLink: (link: ShownLink) => void
}) {
  const { t } = useTranslation()
  const setActive = useSetStaffActive()
  const resend = useResendInvitation()
  const getLink = useInvitationLink()
  const cancel = useCancelInvitation()
  const showLinkFor = useShowInvitationLink(onShowLink)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (isSelf) return null
  const status = staffStatus(member)

  async function deactivate() {
    setError(null)
    try {
      await setActive.mutateAsync({ userId: member.user_id, active: false })
      setConfirming(false)
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  async function reactivate() {
    try {
      await setActive.mutateAsync({ userId: member.user_id, active: true })
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function resendInvitation() {
    try {
      const { email_sent } = await resend.mutateAsync({ userId: member.user_id })
      if (email_sent) toast.success(t('staff.toasts.resent'))
      else await showLinkFor(member.user_id, member.display_name)
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function copyLink() {
    try {
      const { link } = await getLink.mutateAsync({ userId: member.user_id })
      try {
        await navigator.clipboard.writeText(link)
        toast.success(t('staff.toasts.linkCopied'))
      } catch {
        onShowLink({ name: member.display_name, link, reason: 'clipboard' })
      }
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function revoke() {
    setRevokeError(null)
    try {
      await cancel.mutateAsync({ userId: member.user_id })
      setRevoking(false)
      toast.success(t('staff.toasts.revoked'))
    } catch (caught) {
      setRevokeError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === 'active' && (
          <Button
            variant="outline"
            size="sm"
            aria-label={t('staff.actions.deactivateFor', { name: member.display_name })}
            onClick={() => setConfirming(true)}
          >
            {t('staff.actions.deactivate')}
          </Button>
        )}
        {status === 'inactive' && (
          <Button
            variant="outline"
            size="sm"
            disabled={setActive.isPending}
            aria-label={t('staff.actions.reactivateFor', { name: member.display_name })}
            onClick={() => void reactivate()}
          >
            {t('staff.actions.reactivate')}
          </Button>
        )}
        {status === 'invited' && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={resend.isPending}
              aria-label={t('staff.actions.resendFor', { name: member.display_name })}
              onClick={() => void resendInvitation()}
            >
              {t('staff.actions.resend')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={getLink.isPending}
              aria-label={t('staff.actions.linkFor', { name: member.display_name })}
              onClick={() => void copyLink()}
            >
              {t('staff.actions.link')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={t('staff.actions.revokeFor', { name: member.display_name })}
              onClick={() => setRevoking(true)}
            >
              {t('staff.actions.revoke')}
            </Button>
          </>
        )}
      </div>
      {confirming && (
        <ConfirmActionDialog
          title={t('staff.deactivate.title', { name: member.display_name })}
          body={t('staff.deactivate.body', { name: member.display_name })}
          confirmLabel={t('staff.actions.deactivate')}
          pending={setActive.isPending}
          error={error}
          onConfirm={() => void deactivate()}
          onCancel={() => {
            setConfirming(false)
            setError(null)
          }}
        />
      )}
      {revoking && (
        <ConfirmActionDialog
          title={t('staff.revoke.title', { name: member.display_name })}
          body={t('staff.revoke.body')}
          confirmLabel={t('staff.revoke.confirm')}
          pending={cancel.isPending}
          error={revokeError}
          onConfirm={() => void revoke()}
          onCancel={() => {
            setRevoking(false)
            setRevokeError(null)
          }}
        />
      )}
    </>
  )
}
