import type { SupabaseClient } from '@supabase/supabase-js'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthProvider'
import { SupabaseContext } from '@/lib/supabase'

export function AppProviders({
  client,
  queryClient,
  children,
}: {
  client: SupabaseClient
  queryClient: QueryClient
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext value={client}>
        <AuthProvider>{children}</AuthProvider>
      </SupabaseContext>
    </QueryClientProvider>
  )
}
