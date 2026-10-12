import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/** Plain buttons, not AlertDialogAction/Cancel: those also fire onOpenChange, which would call onStay a second time. */
export function UnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
}: {
  open: boolean
  onStay: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  const stayRef = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onStay()}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          // There is no AlertDialogCancel for Radix to focus, so focus the safe choice ourselves.
          event.preventDefault()
          stayRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('common.unsaved.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('common.unsaved.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button ref={stayRef} variant="outline" onClick={onStay}>
            {t('common.unsaved.stay')}
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            {t('common.unsaved.discard')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
