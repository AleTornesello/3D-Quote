import { useQuery } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
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
