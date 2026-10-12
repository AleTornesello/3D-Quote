import { useId, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toAppError } from '@/data/errors'
import {
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  useLogoUrl,
  useRemoveLogo,
  useUploadLogo,
} from '@/data/settings'

/** The shop logo. Uploads and removals save at once, separately from the settings form's Save. */
export function LogoField({ path, editable }: { path: string | null; editable: boolean }) {
  const { t } = useTranslation()
  const inputId = useId()
  const url = useLogoUrl(path)
  const upload = useUploadLogo()
  const remove = useRemoveLogo()
  const [error, setError] = useState<string | null>(null)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    if (!(file.type in LOGO_TYPES)) {
      setError(t('settings.logo.badType'))
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(t('settings.logo.tooBig'))
      return
    }
    try {
      await upload.mutateAsync({ file, previousPath: path })
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  async function onRemove() {
    if (!path) return
    setError(null)
    try {
      await remove.mutateAsync(path)
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{t('settings.logo.label')}</span>
      {path ? (
        url.data ? (
          <img
            src={url.data}
            alt={t('settings.logo.alt')}
            className="h-16 w-auto self-start rounded border bg-white p-1"
          />
        ) : (
          <Skeleton className="h-16 w-32" />
        )
      ) : (
        <p className="text-sm text-muted-foreground">{t('settings.logo.none')}</p>
      )}
      {editable && (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{t('settings.logo.upload')}</Label>
          <Input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            disabled={upload.isPending}
            onChange={(event) => void onFile(event)}
          />
          <p className="text-xs text-muted-foreground">{t('settings.logo.hint')}</p>
          {path && (
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => void onRemove()}
              >
                {t('settings.logo.remove')}
              </Button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
