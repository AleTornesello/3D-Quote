import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/ui/sonner'
import { SupabaseContext, type AppSupabaseClient } from '@/lib/supabase'

export function AppProviders({
  client,
  queryClient,
  children,
}: {
  client: AppSupabaseClient
  queryClient: QueryClient
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext value={client}>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </SupabaseContext>
    </QueryClientProvider>
  )
}
