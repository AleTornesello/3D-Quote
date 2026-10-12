import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toAppError } from '@/data/errors'
import { useSetStaffRole, useStaffList, type StaffMember } from '@/data/staff'

/** Owner only (wrapped in RequireOwner). The select shows the saved role, so a refused change snaps back. */
export function StaffPage() {
  const { t } = useTranslation()
  const me = useStaff()
  const members = useStaffList()
  const setRole = useSetStaffRole()

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
          disabled={m.user_id === me.userId || setRole.isPending}
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
      key: 'active',
      header: t('staff.columns.active'),
      cell: (m) => t(m.active ? 'common.yes' : 'common.no'),
    },
  ]

  return (
    <section>
      <PageHeader title={t('nav.staff')} />
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
    </section>
  )
}
