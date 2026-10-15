import type { ReactElement } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/auth/RequireAuth'
import { RequireOwner } from '@/auth/RequireOwner'
import { AppShell } from '@/layout/AppShell'
import { AccountPage } from '@/pages/AccountPage'
import { ClientDetailPage } from '@/pages/ClientDetailPage'
import { ClientsPage } from '@/pages/ClientsPage'
import { ConsumablesPage } from '@/pages/ConsumablesPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { MaterialsPage } from '@/pages/MaterialsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PrintersPage } from '@/pages/PrintersPage'
import { QuoteEditorPage } from '@/pages/QuoteEditorPage'
import { QuotesPage } from '@/pages/QuotesPage'
import { SectionPage } from '@/pages/SectionPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { StaffPage } from '@/pages/StaffPage'
import { SECTIONS } from './sections'

/** Sections with a real page; the others still show the "coming soon" placeholder. */
const SECTION_PAGES: Partial<Record<string, ReactElement>> = {
  '/clients': <ClientsPage />,
  '/consumables': <ConsumablesPage />,
  '/materials': <MaterialsPage />,
  '/printers': <PrintersPage />,
  '/quotes': <QuotesPage />,
  '/settings': <SettingsPage />,
  '/staff': (
    <RequireOwner>
      <StaffPage />
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
          { path: 'clients/:id', element: <ClientDetailPage /> },
          { path: 'quotes/new', element: <QuotesPage creating /> },
          { path: 'quotes/:id', element: <QuoteEditorPage /> },
          { path: 'account', element: <AccountPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
