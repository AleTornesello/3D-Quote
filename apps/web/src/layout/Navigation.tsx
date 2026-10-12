import { CircleUser, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { SECTIONS } from '@/app/sections'
import { useStaff } from '@/auth/staff-context'
import { Button } from '@/components/ui/button'
import { useSupabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { LanguageSwitcher } from './LanguageSwitcher'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm',
    isActive ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/60',
  )

export function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const staff = useStaff()
  const supabase = useSupabase()

  return (
    <nav aria-label={t('nav.main')} className="flex h-full flex-col gap-4 p-3">
      <div className="px-3 pt-2 text-lg font-semibold">{t('app.name')}</div>
      <ul className="grid gap-1">
        {SECTIONS.filter((section) => !section.ownerOnly || staff.isOwner).map(
          ({ path, labelKey, icon: Icon }) => (
            <li key={path}>
              <NavLink to={path} onClick={onNavigate} className={linkClass}>
                <Icon className="size-4" aria-hidden />
                {t(labelKey)}
              </NavLink>
            </li>
          ),
        )}
      </ul>
      <div className="mt-auto grid gap-2 border-t pt-4">
        <p className="truncate px-3 text-sm text-muted-foreground">{staff.displayName}</p>
        <div className="px-3">
          <LanguageSwitcher />
        </div>
        <NavLink to="/account" onClick={onNavigate} className={linkClass}>
          <CircleUser className="size-4" aria-hidden />
          {t('nav.account')}
        </NavLink>
        <Button
          variant="ghost"
          className="min-h-11 justify-start gap-3 px-3"
          onClick={() => void supabase.auth.signOut()}
        >
          <LogOut className="size-4" aria-hidden />
          {t('nav.logout')}
        </Button>
      </div>
    </nav>
  )
}
