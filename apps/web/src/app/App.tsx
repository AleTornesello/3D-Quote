import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { createTusUploader } from '@/data/model-upload'
import type { EnvResult, SupabaseEnv } from '@/lib/env'
import { createQueryClient } from '@/lib/query-client'
import { getSupabaseClient } from '@/lib/supabase'
import { renderQuotePdf } from '@/pdf/pdf-renderer'
import { ConfigErrorPage } from '@/pages/ConfigErrorPage'
import { AppProviders } from './AppProviders'
import { routes } from './routes'

function ConfiguredApp({ env }: { env: SupabaseEnv }) {
  const client = getSupabaseClient(env)
  const [queryClient] = useState(createQueryClient)
  const [uploader] = useState(() => createTusUploader(client, env))
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <AppProviders
      client={client}
      queryClient={queryClient}
      uploader={uploader}
      pdfRenderer={renderQuotePdf}
    >
      <RouterProvider router={router} />
    </AppProviders>
  )
}

export default function App({ env }: { env: EnvResult }) {
  if (!env.ok) return <ConfigErrorPage missing={env.missing} />
  return <ConfiguredApp env={env.env} />
}
