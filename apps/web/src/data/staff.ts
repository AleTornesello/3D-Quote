import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '@/lib/database.types'
import type { Language } from '@/i18n'
import { useSupabase } from '@/lib/supabase'
import { invokeFunction } from './edge-functions'
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

/** The generated type cannot express a nullable column in a function result: last_sign_in_at is null until the first sign-in. */
export type StaffMember = Omit<
  Database['public']['Functions']['list_staff']['Returns'][number],
  'last_sign_in_at'
> & { last_sign_in_at: string | null }

/** Everyone on staff with their login email (owner only; the function refuses anyone else). */
export function useStaffList() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.staffList,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_staff')
      if (error) throw toAppError(error)
      return data as StaffMember[]
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

export type StaffRole = 'owner' | 'operator'
export type InviteValues = { email: string; display_name: string; role: StaffRole }

/** Invitations change who is on the list, and a refused call usually means the list is stale. */
function useStaffFunction<TVariables, TResult>(
  run: (supabase: ReturnType<typeof useSupabase>, variables: TVariables) => Promise<TResult>,
) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll })
  return useMutation({
    mutationFn: (variables: TVariables) => run(supabase, variables),
    onSuccess: refresh,
    onError: refresh,
  })
}

export function useInviteStaff() {
  return useStaffFunction((supabase, values: InviteValues) =>
    invokeFunction<{ user_id: string; email_sent: boolean }>(supabase, 'manage-staff', {
      action: 'invite',
      ...values,
    }),
  )
}

export function useResendInvitation() {
  return useStaffFunction((supabase, { userId }: { userId: string }) =>
    invokeFunction<{ email_sent: boolean }>(supabase, 'manage-staff', {
      action: 'resend',
      user_id: userId,
    }),
  )
}

export function useInvitationLink() {
  return useStaffFunction((supabase, { userId }: { userId: string }) =>
    invokeFunction<{ link: string }>(supabase, 'manage-staff', { action: 'link', user_id: userId }),
  )
}

export function useCancelInvitation() {
  return useStaffFunction(async (supabase, { userId }: { userId: string }) => {
    await invokeFunction<Record<string, never>>(supabase, 'manage-staff', {
      action: 'cancel',
      user_id: userId,
    })
  })
}

/** Deactivating ends the person's access at once (is_staff() turns false); their quotes keep their name. */
export function useSetStaffActive() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase
        .from('staff')
        .update({ active })
        .eq('user_id', userId)
        .select('user_id')
        .single()
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll }),
  })
}
