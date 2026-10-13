import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/ui/sonner'
import { ModelUploaderContext, type ModelUploader } from '@/data/model-upload'
import { SupabaseContext, type AppSupabaseClient } from '@/lib/supabase'

export function AppProviders({
  client,
  queryClient,
  uploader,
  children,
}: {
  client: AppSupabaseClient
  queryClient: QueryClient
  uploader: ModelUploader
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext value={client}>
        <ModelUploaderContext value={uploader}>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ModelUploaderContext>
      </SupabaseContext>
    </QueryClientProvider>
  )
}
