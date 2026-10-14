import { createContext, createElement, useContext, type ReactElement } from 'react'
import type { QuotePdfData } from './quote-pdf-data'

/** Turns a quote's PDF data into a PDF file. */
export type PdfRenderer = (data: QuotePdfData) => Promise<Blob>

export const PdfRendererContext = createContext<PdfRenderer | null>(null)

export function usePdfRenderer(): PdfRenderer {
  const renderer = useContext(PdfRendererContext)
  if (!renderer) throw new Error('usePdfRenderer must be used inside <PdfRendererContext>')
  return renderer
}

/** The real renderer. react-pdf and the layout load on the first export, not with the app. */
export const renderQuotePdf: PdfRenderer = async (data) => {
  const [{ pdf }, { QuotePdf }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./QuotePdf'),
  ])
  return pdf(createElement(QuotePdf, { data }) as ReactElement<never>).toBlob()
}
