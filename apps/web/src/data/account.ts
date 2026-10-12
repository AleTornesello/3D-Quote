import { useMutation } from '@tanstack/react-query'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'

const PASSWORD_ERRORS: Record<string, string> = {
  weak_password: 'account.password.weak',
  same_password: 'account.password.same',
}

export function useChangePassword() {
  const supabase = useSupabase()
  return useMutation({
    mutationFn: async (password: string) => {
      const { error } = await supabase.auth.updateUser({ password })
      if (!error) return
      const messageKey = error.code ? PASSWORD_ERRORS[error.code] : undefined
      throw messageKey ? new AppError('invalid', { messageKey, cause: error }) : toAppError(error)
    },
  })
}
