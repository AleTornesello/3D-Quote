import { Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { Uploads } from './use-uploads'

/** Drop zone and Choose files (the button is the main path on tablets), rejected files and upload rows. */
export function UploadZone({ uploads, empty }: { uploads: Uploads; empty: boolean }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div className="grid gap-3">
      <div
        role="group"
        aria-label={t('quotes.upload.drop')}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          uploads.add([...event.dataTransfer.files])
        }}
        className={cn(
          'grid place-items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center',
          over && 'border-primary bg-muted',
        )}
      >
        {empty && <p className="font-medium">{t('quotes.upload.empty')}</p>}
        <p className="text-sm text-muted-foreground">
          {t('quotes.upload.drop')} · {t('quotes.upload.hint')}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept=".stl,.3mf"
          tabIndex={-1}
          aria-label={t('quotes.upload.choose')}
          className="sr-only"
          onChange={(event) => {
            uploads.add([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <Button type="button" onClick={() => input.current?.click()}>
          <Upload aria-hidden />
          {t('quotes.upload.choose')}
        </Button>
      </div>

      {uploads.rejected.length > 0 && (
        <ul className="grid gap-1">
          {uploads.rejected.map((file) => (
            <li key={file.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-destructive">
                {t(`quotes.upload.rejected.${file.problem}`, { name: file.name })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('quotes.upload.dismiss', { name: file.name })}
                onClick={() => uploads.dismissRejected(file.key)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {uploads.rows.length > 0 && (
        <ul className="grid gap-2">
          {uploads.rows.map((row) => (
            <li key={row.key} className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{row.name}</span>
                {row.status === 'failed' ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t('quotes.upload.retry', { name: row.name })}
                      onClick={() => uploads.retry(row.key)}
                    >
                      {t('common.retry')}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('quotes.upload.dismiss', { name: row.name })}
                      onClick={() => uploads.dismiss(row.key)}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ) : (
                  row.status !== 'creating' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('quotes.upload.cancel', { name: row.name })}
                      onClick={() => uploads.cancel(row.key)}
                    >
                      {t('common.cancel')}
                    </Button>
                  )
                )}
              </div>
              {row.status === 'failed' ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(row.error ?? 'errors.unknown')}
                </p>
              ) : (
                <>
                  <Progress
                    value={Math.round(row.progress * 100)}
                    aria-label={t('quotes.upload.progress', { name: row.name })}
                  />
                  {row.status === 'waiting' && (
                    <span className="text-xs text-muted-foreground">
                      {t('quotes.upload.waiting')}
                    </span>
                  )}
                  {row.status === 'creating' && (
                    <span className="text-xs text-muted-foreground">
                      {t('quotes.upload.creating')}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
