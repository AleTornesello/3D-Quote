import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Language } from '@/i18n'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'

/** The signed-in user's staff row; null when RLS hides it (no staff record, or inactive). */
export function useOwnStaff(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.ownStaff(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('user_id, display_name, role, language, active')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw toAppError(error)
      return data
    },
  })
}

export type ProfileChanges = { userId: string; display_name?: string; language?: Language }

export function useSaveOwnProfile() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, ...changes }: ProfileChanges) => {
      const { error } = await supabase
        .from('staff')
        .update(changes)
        .eq('user_id', userId)
        .select('user_id')
        .single()
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll }),
  })
}
