import { createContext, useContext } from 'react'
import type { Language } from '@/i18n'

export type Staff = {
  userId: string
  displayName: string
  role: 'owner' | 'operator'
  isOwner: boolean
  language: Language
}

export const StaffContext = createContext<Staff | null>(null)

/** The signed-in staff member. <StaffProvider> renders nothing else until it is known. */
export function useStaff(): Staff {
  const staff = useContext(StaffContext)
  if (!staff) throw new Error('useStaff must be used inside <StaffProvider>')
  return staff
}

/** Null outside <StaffProvider>, e.g. on the login page. */
export function useOptionalStaff(): Staff | null {
  return useContext(StaffContext)
}
