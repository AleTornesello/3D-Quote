import type { Session } from '@supabase/supabase-js'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/AppProviders'
import { routes } from '@/app/routes'
import type { Tables } from '@/lib/database.types'
import { createQueryClient } from '@/lib/query-client'
import { FakeDb, type FunctionHandler, type Row } from './fake-db'
import { FakePdfRenderer } from './fake-pdf'
import { createFakeSupabase, type SignInFailure } from './fake-supabase'
import { ownerStaff, quoteRow, settingsRow } from './fixtures'

export type RenderAppOptions = {
  session?: Session | null
  signInError?: SignInFailure
  pendingSession?: boolean
  /** The signed-in user's (`user-1`) staff row. Defaults to an owner; `null` means no staff record. */
  staff?: Tables<'staff'> | null
  /** Rows per table. A settings row is seeded unless `tables.settings` is given. */
  tables?: Record<string, Row[]>
  rpc?: Record<string, (args: unknown) => unknown>
  /**
   * Edge Function handlers by name, e.g. `{ 'price-quote': () => ({ data: { priced: 1, skipped: 0 } }) }`.
   * price-quote defaults to pricing nothing: complete unpriced plates call it on their own.
   */
  functions?: Record<string, FunctionHandler>
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
    { 'price-quote': () => ({ data: { priced: 0, skipped: 0 } }), ...opts.functions },
  )
  db.configure({
    defaults: {
      // Column defaults and the numbering trigger.
      quotes: () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...defaults } = quoteRow()
        return defaults
      },
    },
    embeds: {
      quotes: (row, fake) => {
        const client = fake.table('clients').find((c) => c.id === row.client_id)
        const creator = fake.table('staff').find((s) => s.user_id === row.created_by)
        return {
          client: client
            ? {
                id: client.id,
                name: client.name,
                company: client.company,
                email: client.email,
                phone: client.phone,
              }
            : null,
          creator: { display_name: creator?.display_name ?? '' },
        }
      },
      quote_plates: () => ({ materials: [] }),
    },
    // RLS: staff update and delete drafts only.
    writable: { quotes: (row) => row.status === 'draft' },
  })
  const fake = createFakeSupabase({ ...opts, db })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = createQueryClient({ retry: false })
  const user = userEvent.setup()
  const pdf = new FakePdfRenderer()
  const { unmount } = render(
    <AppProviders client={fake.client} queryClient={queryClient} pdfRenderer={pdf.render}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...fake, router, user, queryClient, pdf, unmount }
}
