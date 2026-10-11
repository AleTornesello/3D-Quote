import type { Session } from '@supabase/supabase-js'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/AppProviders'
import { routes } from '@/app/routes'
import { createQueryClient } from '@/lib/query-client'
import { createFakeSupabase, type SignInFailure } from './fake-supabase'

export function renderApp(
  path: string,
  opts: { session?: Session | null; signInError?: SignInFailure; pendingSession?: boolean } = {},
) {
  const fake = createFakeSupabase(opts)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders client={fake.client} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...fake, router }
}
