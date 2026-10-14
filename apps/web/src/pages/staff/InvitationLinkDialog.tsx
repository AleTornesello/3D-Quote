import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Shows an invitation link to copy and send by hand. */
export function InvitationLinkDialog({
  name,
  link,
  onClose,
}: {
  name: string
  link: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // The link is selectable in the dialog; copying by hand still works.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('staff.linkDialog.title')}</DialogTitle>
          <DialogDescription>{t('staff.linkDialog.body', { name })}</DialogDescription>
        </DialogHeader>
        <p className="rounded-md border bg-muted p-2 text-sm break-all select-all">{link}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => void copy()}>
            {copied ? t('staff.linkDialog.copied') : t('staff.linkDialog.copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
