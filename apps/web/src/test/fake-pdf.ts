import type { PdfRenderer } from '@/pdf/pdf-renderer'
import type { QuotePdfData } from '@/pdf/quote-pdf-data'

/** Records what would be rendered; set `failWith` to make the next renders reject. */
export class FakePdfRenderer {
  readonly rendered: QuotePdfData[] = []
  failWith: unknown | null = null

  readonly render: PdfRenderer = async (data) => {
    if (this.failWith !== null) throw this.failWith
    this.rendered.push(data)
    return new Blob(['%PDF-fake'], { type: 'application/pdf' })
  }
}
