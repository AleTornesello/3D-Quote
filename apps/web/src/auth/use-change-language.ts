import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSaveOwnProfile } from '@/data/staff'
import { setLanguage, type Language } from '@/i18n'
import { useOptionalStaff } from './staff-context'

/** Switches the UI language at once and, when signed in, saves it on the staff record. */
export function useChangeLanguage() {
  const staff = useOptionalStaff()
  const save = useSaveOwnProfile()
  const { i18n } = useTranslation()
  // The last language asked for; i18n.language lags behind while a change is in flight.
  const requested = useRef<string | null>(null)

  async function change(language: Language) {
    const previous = requested.current ?? i18n.language
    requested.current = language
    save.reset()
    await setLanguage(language)
    // Compare with the UI language, not the stored one: that is stale while a save is pending.
    if (staff && previous !== language) save.mutate({ userId: staff.userId, language })
  }

  return { change, saveFailed: save.isError }
}
