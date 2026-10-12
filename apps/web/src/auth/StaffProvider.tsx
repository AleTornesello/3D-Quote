import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useOwnStaff } from '@/data/staff'
import { setLanguage } from '@/i18n'
import { useSupabase } from '@/lib/supabase'
import { StaffContext, type Staff } from './staff-context'

/**
 * Loads the signed-in user's staff row and renders the app only for active staff. RLS hides the row from users
 * without one and from inactive staff, so "no row" means "no access"; a failed request does not.
 */
export function StaffProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { t } = useTranslation()
  const supabase = useSupabase()
  const own = useOwnStaff(userId)
  const row = own.data

  const staff = useMemo<Staff | null>(() => {
    if (!row || !row.active) return null
    const role: Staff['role'] = row.role === 'owner' ? 'owner' : 'operator'
    return {
      userId: row.user_id,
      displayName: row.display_name,
      role,
      isOwner: role === 'owner',
      language: row.language === 'en' ? 'en' : 'it',
    }
  }, [row])

  const language = staff?.language
  useEffect(() => {
    if (language) void setLanguage(language)
  }, [language])

  if (own.isPending) {
    return (
      <p role="status" className="p-6 text-muted-foreground">
        {t('auth.loading')}
      </p>
    )
  }
  if (own.isError) {
    return (
      <main className="mx-auto grid max-w-lg gap-4 p-6">
        <h1 className="text-2xl font-semibold">{t('access.loadError.title')}</h1>
        <p role="alert" className="text-muted-foreground">
          {t(toAppError(own.error).messageKey)}
        </p>
        <div>
          <Button onClick={() => void own.refetch()}>{t('common.retry')}</Button>
        </div>
      </main>
    )
  }
  if (!staff) {
    return (
      <main className="mx-auto grid max-w-lg gap-4 p-6">
        <h1 className="text-2xl font-semibold">{t('access.none.title')}</h1>
        <p className="text-muted-foreground">{t('access.none.body')}</p>
        <div>
          <Button variant="outline" onClick={() => void supabase.auth.signOut()}>
            {t('nav.logout')}
          </Button>
        </div>
      </main>
    )
  }
  return <StaffContext value={staff}>{children}</StaffContext>
}
