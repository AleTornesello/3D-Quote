import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toAppError } from '@/data/errors'
import { useInvitationLink } from '@/data/staff'

export type ShownLink = { name: string; link: string; reason?: 'emailFailed' | 'clipboard' }

/** Fetches a pending person's invitation link and hands it to `show`; a failure becomes an error toast. */
export function useShowInvitationLink(show: (link: ShownLink) => void) {
  const { t } = useTranslation()
  const getLink = useInvitationLink()
  return async (userId: string, name: string) => {
    try {
      const { link } = await getLink.mutateAsync({ userId })
      show({ name, link })
    } catch (error) {
      toast.error(t(toAppError(error).messageKey))
    }
  }
}
