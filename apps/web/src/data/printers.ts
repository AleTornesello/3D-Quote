import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Printer = Tables<'printers'>
export type PrinterValues = Omit<TablesInsert<'printers'>, 'id' | 'created_at' | 'updated_at'>

export function usePrinters() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.printers,
    queryFn: async () => {
      const { data, error } = await supabase.from('printers').select('*').order('name')
      if (error) throw toAppError(error)
      return data
    },
  })
}

/** Inserts without `id`, otherwise updates that printer (partial values allowed, e.g. the Active toggle). */
export function useSavePrinter() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: Partial<PrinterValues> }) => {
      const { data, error } =
        id === undefined
          ? await supabase
              .from('printers')
              .insert(values as PrinterValues)
              .select()
              .single()
          : await supabase.from('printers').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.printers }),
  })
}

export function useDeletePrinter() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('printers').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.printers }),
  })
}
