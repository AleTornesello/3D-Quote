import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useStaff } from './staff-context'

/** Owner-only pages. The database refuses operators anyway; this explains it instead of showing empty data. */
export function RequireOwner({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  if (isOwner) return children
  return (
    <section>
      <h1 className="mb-2 text-2xl font-semibold">{t('access.ownerOnly.title')}</h1>
      <p className="mb-4 text-muted-foreground">{t('access.ownerOnly.body')}</p>
      <Link to="/quotes" className="underline-offset-4 hover:underline">
        {t('pages.notFound.back')}
      </Link>
    </section>
  )
}
