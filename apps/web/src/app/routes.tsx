import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/auth/RequireAuth'
import { AppShell } from '@/layout/AppShell'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SectionPage } from '@/pages/SectionPage'
import { SECTIONS } from './sections'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/quotes" replace /> },
          ...SECTIONS.map(({ path, labelKey }) => ({
            path: path.slice(1),
            element: <SectionPage titleKey={labelKey} />,
          })),
          { path: 'account', element: <SectionPage titleKey="nav.account" /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
