import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toAppError } from '@/data/errors'
import { useSetStaffRole, useStaffList, type StaffMember } from '@/data/staff'
import { staffStatus, type StaffStatus } from '@/data/staff-rules'
import { InvitationLinkDialog } from './staff/InvitationLinkDialog'
import { InviteSheet } from './staff/InviteSheet'
import { StaffActions } from './staff/StaffActions'
import { useShowInvitationLink, type ShownLink } from './staff/use-invitation-link'

const STATUS_VARIANT: Record<StaffStatus, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  invited: 'secondary',
  inactive: 'outline',
}

/** Owner only (wrapped in RequireOwner). The select shows the saved role, so a refused change snaps back. */
export function StaffPage() {
  const { t } = useTranslation()
  const me = useStaff()
  const members = useStaffList()
  const setRole = useSetStaffRole()
  const [inviting, setInviting] = useState(false)
  const [shownLink, setShownLink] = useState<ShownLink | null>(null)
  const showLinkFor = useShowInvitationLink(setShownLink)

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: t('staff.columns.name'),
      cell: (m) => <span className="font-medium">{m.display_name}</span>,
    },
    { key: 'email', header: t('staff.columns.email'), cell: (m) => m.email },
    {
      key: 'role',
      header: t('staff.columns.role'),
      cell: (m) => (
        <NativeSelect
          aria-label={t('staff.roleFor', { name: m.display_name })}
          value={m.role}
          // Your own role can't be changed here, so an owner can't demote themselves by accident.
          disabled={m.user_id === me.userId || setRole.isPending || !m.active}
          onChange={(event) =>
            setRole.mutate({
              userId: m.user_id,
              role: event.target.value === 'owner' ? 'owner' : 'operator',
            })
          }
        >
          <NativeSelectOption value="owner">{t('staff.roles.owner')}</NativeSelectOption>
          <NativeSelectOption value="operator">{t('staff.roles.operator')}</NativeSelectOption>
        </NativeSelect>
      ),
    },
    {
      key: 'status',
      header: t('staff.columns.status'),
      cell: (m) => {
        const status = staffStatus(m)
        return <Badge variant={STATUS_VARIANT[status]}>{t(`staff.status.${status}`)}</Badge>
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('staff.columns.actions')}</span>,
      cell: (m) => (
        <StaffActions member={m} isSelf={m.user_id === me.userId} onShowLink={setShownLink} />
      ),
    },
  ]

  return (
    <section>
      <PageHeader
        title={t('nav.staff')}
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden />
            {t('staff.invite.button')}
          </Button>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">{t('staff.note')}</p>
      {setRole.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(toAppError(setRole.error).messageKey)}
        </p>
      )}
      <DataTable
        query={members}
        columns={columns}
        rowKey={(m) => m.user_id}
        caption={t('nav.staff')}
        empty={t('staff.empty')}
      />
      {inviting && <InviteSheet onClose={() => setInviting(false)} onShowLink={showLinkFor} />}
      {shownLink && (
        <InvitationLinkDialog
          name={shownLink.name}
          link={shownLink.link}
          reason={shownLink.reason}
          onClose={() => setShownLink(null)}
        />
      )}
    </section>
  )
}
