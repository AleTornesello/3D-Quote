import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useSetStaffActive, type StaffMember } from '@/data/staff'
import { staffStatus } from '@/data/staff-rules'
import { ConfirmActionDialog } from '@/pages/quote-editor/ConfirmActionDialog'

/** The actions a row allows for its status. Your own row has none. */
export function StaffActions({ member, isSelf }: { member: StaffMember; isSelf: boolean }) {
  const { t } = useTranslation()
  const setActive = useSetStaffActive()
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

  return (
    <>
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
    </>
  )
}
