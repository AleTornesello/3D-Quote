import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '@/lib/database.types'
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

export type StaffMember = Database['public']['Functions']['list_staff']['Returns'][number]

/** Everyone on staff with their login email (owner only; the function refuses anyone else). */
export function useStaffList() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.staffList,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_staff')
      if (error) throw toAppError(error)
      return data
    },
  })
}

export function useSetStaffRole() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'owner' | 'operator' }) => {
      const { error } = await supabase
        .from('staff')
        .update({ role })
        .eq('user_id', userId)
        .select('user_id')
        .single()
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll }),
  })
}
