import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Consumable = Tables<'consumables'>
export type ConsumableValues = Omit<TablesInsert<'consumables'>, 'id' | 'created_at' | 'updated_at'>
/** `stock` is what is still available; `reserved` is held by sent quotes and comes back if they're rejected or expire. */
export type ConsumableListRow = Consumable & { reserved: number }

export function useConsumables() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.consumables,
    queryFn: async (): Promise<ConsumableListRow[]> => {
      const { data, error } = await supabase
        .from('consumables')
        .select('*, reserved:quote_consumables(quantity, quotes!inner(status))')
        .eq('reserved.quotes.status', 'sent')
        .order('name')
      if (error) throw toAppError(error)
      return data.map(({ reserved, ...consumable }) => ({
        ...consumable,
        reserved: reserved.reduce((sum, line) => sum + line.quantity, 0),
      }))
    },
  })
}

/** Inserts without `id`, otherwise updates that consumable (partial values allowed, e.g. the Active toggle). */
export function useSaveConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: Partial<ConsumableValues> }) => {
      const { data, error } =
        id === undefined
          ? await supabase
              .from('consumables')
              .insert(values as ConsumableValues)
              .select()
              .single()
          : await supabase.from('consumables').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.consumables }),
  })
}

export function useDeleteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('consumables').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.consumables }),
  })
}
