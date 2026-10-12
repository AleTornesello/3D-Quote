import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * Confirms a delete, naming the item in `title`. Mount it only while open. The confirm button is a plain Button so the
 * dialog stays open to show `error`; `alternative` replaces it (e.g. "Deactivate instead").
 */
export function ConfirmDeleteDialog({
  title,
  body,
  pending,
  error,
  alternative,
  onConfirm,
  onCancel,
}: {
  title: string
  body?: string
  pending: boolean
  error?: string | null
  alternative?: { label: string; onClick: () => void } | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body ?? t('common.deleteBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          {alternative ? (
            <Button onClick={alternative.onClick} disabled={pending}>
              {alternative.label}
            </Button>
          ) : (
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>
              {t('common.delete')}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
