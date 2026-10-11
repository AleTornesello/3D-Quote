import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './auth-context'

/** Layout route: renders children only with a session; otherwise sends the user to /login. */
export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()
  const { t } = useTranslation()

  if (auth.status === 'loading') {
    return (
      <p role="status" className="p-6 text-muted-foreground">
        {t('auth.loading')}
      </p>
    )
  }
  if (auth.status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
