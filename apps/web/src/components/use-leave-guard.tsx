import { useRef } from 'react'
import { useBlocker } from 'react-router'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

/**
 * Asks before navigating to another page while `dirty`. Render `dialog`; call `allowLeaving()` right before a
 * navigation that should not ask (e.g. after deleting the record being edited).
 */
export function useLeaveGuard(dirty: boolean) {
  const bypass = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  )
  return {
    dialog: (
      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        onStay={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
    ),
    allowLeaving: () => {
      bypass.current = true
    },
  }
}
