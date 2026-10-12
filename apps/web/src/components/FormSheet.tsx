import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

/** A create/edit form beside the list. Mount it only while open; closing with changes asks first. */
export function FormSheet({
  title,
  dirty,
  onClose,
  children,
}: {
  title: string
  dirty: boolean
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)

  function requestClose(open: boolean) {
    if (open) return
    if (dirty) setConfirming(true)
    else onClose()
  }

  return (
    <>
      <Sheet open onOpenChange={requestClose}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-lg"
          closeLabel={t('common.close')}
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{children}</div>
        </SheetContent>
      </Sheet>
      <UnsavedChangesDialog
        open={confirming}
        onStay={() => setConfirming(false)}
        onDiscard={() => {
          setConfirming(false)
          onClose()
        }}
      />
    </>
  )
}
