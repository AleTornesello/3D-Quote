import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toAppError } from '@/data/errors'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

/**
 * Deletes a printer or material. One that quote items still use can't be deleted (foreign key), so the dialog then
 * explains why and offers to deactivate it instead.
 */
export function DeleteCatalogItemDialog({
  title,
  inUseMessage,
  onDelete,
  onDeactivate,
  onClose,
}: {
  title: string
  inUseMessage: string
  onDelete: () => Promise<unknown>
  onDeactivate: () => Promise<unknown>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [inUse, setInUse] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (caught) {
      const appError = toAppError(caught)
      if (appError.kind === 'inUse') setInUse(true)
      else setError(t(appError.messageKey))
      setPending(false)
    }
  }

  return (
    <ConfirmDeleteDialog
      title={title}
      pending={pending}
      error={error ?? (inUse ? inUseMessage : null)}
      alternative={
        inUse
          ? { label: t('common.deactivateInstead'), onClick: () => void run(onDeactivate) }
          : null
      }
      onConfirm={() => void run(onDelete)}
      onCancel={onClose}
    />
  )
}
