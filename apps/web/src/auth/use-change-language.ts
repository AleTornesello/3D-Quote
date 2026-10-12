import { useSaveOwnProfile } from '@/data/staff'
import { setLanguage, type Language } from '@/i18n'
import { useOptionalStaff } from './staff-context'

/** Switches the UI language at once and, when signed in, saves it on the staff record. */
export function useChangeLanguage() {
  const staff = useOptionalStaff()
  const save = useSaveOwnProfile()

  async function change(language: Language) {
    await setLanguage(language)
    if (staff && staff.language !== language) save.mutate({ userId: staff.userId, language })
  }

  return { change, saveFailed: save.isError }
}
