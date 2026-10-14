import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMaterials } from '@/data/materials'
import type { QuoteItem } from '@/data/quote-items'
import { pdfFileName } from '@/data/quote-rules'
import type { Quote } from '@/data/quotes'
import { useLogoUrl, useSettings } from '@/data/settings'
import { shopToday } from '@/lib/format'
import { downloadBlob } from './download'
import { loadLogoDataUrl } from './logo'
import { usePdfRenderer } from './pdf-renderer'
import { toQuotePdfData, type PdfLanguage } from './quote-pdf-data'

const LANGUAGE_KEYS: Record<PdfLanguage, string> = {
  it: 'quotes.pdf.italian',
  en: 'quotes.pdf.english',
}

/** Asks for the PDF language, builds the PDF in the browser and downloads it. */
export function ExportPdfDialog({
  quote,
  items,
  onClose,
}: {
  quote: Quote
  items: QuoteItem[]
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const render = usePdfRenderer()
  const settings = useSettings()
  const materials = useMaterials()
  const logo = useLogoUrl(settings.data?.shop_logo_path ?? null)
  const [language, setLanguage] = useState<PdfLanguage>(i18n.language === 'en' ? 'en' : 'it')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready =
    settings.data !== undefined && materials.data !== undefined && logo.fetchStatus !== 'fetching'

  async function download() {
    if (!settings.data || !materials.data) return
    setPending(true)
    setError(null)
    try {
      let logoDataUrl: string | null = null
      if (settings.data.shop_logo_path) {
        try {
          if (!logo.data) throw new Error('no logo url')
          logoDataUrl = await loadLogoDataUrl(logo.data)
        } catch {
          toast.warning(t('quotes.pdf.logoWarning'))
        }
      }
      const data = toQuotePdfData({
        quote,
        items,
        materials: materials.data,
        settings: settings.data,
        logo: logoDataUrl,
        language,
        today: shopToday(),
        t: i18n.getFixedT(language),
      })
      const blob = await render(data)
      downloadBlob(blob, pdfFileName(quote.number, quote.client.name))
      onClose()
    } catch {
      setError(t('quotes.pdf.error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('quotes.pdf.title', { number: quote.number })}</DialogTitle>
          <DialogDescription>
            {quote.status === 'draft' ? t('quotes.pdf.draftNote') : ' '}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="mb-1 text-sm font-medium">{t('quotes.pdf.language')}</legend>
          {(['it', 'en'] as const).map((code) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="pdf-language"
                value={code}
                checked={language === code}
                onChange={() => setLanguage(code)}
              />
              {t(LANGUAGE_KEYS[code])}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!ready || pending} onClick={() => void download()}>
            {pending ? t('quotes.pdf.creating') : t('quotes.pdf.download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
