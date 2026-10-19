import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/ui/sonner'
import { PdfRendererContext, type PdfRenderer } from '@/pdf/pdf-renderer'
import { SupabaseContext, type AppSupabaseClient } from '@/lib/supabase'

export function AppProviders({
  client,
  queryClient,
  pdfRenderer,
  children,
}: {
  client: AppSupabaseClient
  queryClient: QueryClient
  pdfRenderer: PdfRenderer
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext value={client}>
        <PdfRendererContext value={pdfRenderer}>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </PdfRendererContext>
      </SupabaseContext>
    </QueryClientProvider>
  )
}
