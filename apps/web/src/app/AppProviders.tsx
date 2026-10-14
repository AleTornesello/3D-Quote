import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/ui/sonner'
import { ModelUploaderContext, type ModelUploader } from '@/data/model-upload'
import { PdfRendererContext, type PdfRenderer } from '@/pdf/pdf-renderer'
import { SupabaseContext, type AppSupabaseClient } from '@/lib/supabase'

export function AppProviders({
  client,
  queryClient,
  uploader,
  pdfRenderer,
  children,
}: {
  client: AppSupabaseClient
  queryClient: QueryClient
  uploader: ModelUploader
  pdfRenderer: PdfRenderer
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext value={client}>
        <ModelUploaderContext value={uploader}>
          <PdfRendererContext value={pdfRenderer}>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </PdfRendererContext>
        </ModelUploaderContext>
      </SupabaseContext>
    </QueryClientProvider>
  )
}
