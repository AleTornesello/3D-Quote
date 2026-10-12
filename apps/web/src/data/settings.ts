import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesUpdate } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Settings = Tables<'settings'>

export function useSettings() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
      if (error) throw toAppError(error)
      return data
    },
  })
}

export type SettingsValues = TablesUpdate<'settings'>

export function useSaveSettings() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: SettingsValues) => {
      const { data, error } = await supabase
        .from('settings')
        .update(values)
        .eq('id', 1)
        .select()
        .single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}
