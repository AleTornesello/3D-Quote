import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/auth/RequireAuth'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { SectionPage } from '@/pages/SectionPage'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <Navigate to="/quotes" replace /> },
      { path: 'quotes', element: <SectionPage titleKey="nav.quotes" /> },
      { path: 'clients', element: <SectionPage titleKey="nav.clients" /> },
    ],
  },
]
