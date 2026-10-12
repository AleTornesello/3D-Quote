import type { ReactElement } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/auth/RequireAuth'
import { RequireOwner } from '@/auth/RequireOwner'
import { AppShell } from '@/layout/AppShell'
import { ClientsPage } from '@/pages/ClientsPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { MaterialsPage } from '@/pages/MaterialsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PrintersPage } from '@/pages/PrintersPage'
import { SectionPage } from '@/pages/SectionPage'
import { SECTIONS } from './sections'

/** Sections with a real page; the others still show the "coming soon" placeholder. */
const SECTION_PAGES: Partial<Record<string, ReactElement>> = {
  '/clients': <ClientsPage />,
  '/materials': <MaterialsPage />,
  '/printers': <PrintersPage />,
  '/staff': (
    <RequireOwner>
      <SectionPage titleKey="nav.staff" />
    </RequireOwner>
  ),
}

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
            element: SECTION_PAGES[path] ?? <SectionPage titleKey={labelKey} />,
          })),
          { path: 'account', element: <SectionPage titleKey="nav.account" /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
