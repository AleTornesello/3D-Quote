import type { Session } from '@supabase/supabase-js'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/AppProviders'
import { routes } from '@/app/routes'
import type { Tables } from '@/lib/database.types'
import { createQueryClient } from '@/lib/query-client'
import { FakeDb, type Row } from './fake-db'
import { createFakeSupabase, type SignInFailure } from './fake-supabase'
import { ownerStaff, settingsRow } from './fixtures'

export type RenderAppOptions = {
  session?: Session | null
  signInError?: SignInFailure
  pendingSession?: boolean
  /** The signed-in user's (`user-1`) staff row. Defaults to an owner; `null` means no staff record. */
  staff?: Tables<'staff'> | null
  /** Rows per table. A settings row is seeded unless `tables.settings` is given. */
  tables?: Record<string, Row[]>
  rpc?: Record<string, (args: unknown) => unknown>
}

export function renderApp(path: string, opts: RenderAppOptions = {}) {
  const staff = opts.staff === undefined ? ownerStaff : opts.staff
  const tables = opts.tables ?? {}
  const db = new FakeDb(
    {
      settings: [settingsRow],
      ...tables,
      staff: [...(staff ? [staff] : []), ...(tables.staff ?? [])],
    },
    opts.rpc,
  )
  const fake = createFakeSupabase({ ...opts, db })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = createQueryClient({ retry: false })
  const user = userEvent.setup()
  render(
    <AppProviders client={fake.client} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...fake, router, user, queryClient }
}
