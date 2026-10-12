import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Material = Tables<'materials'>
export type MaterialValues = Omit<TablesInsert<'materials'>, 'id' | 'created_at' | 'updated_at'>

export const MATERIAL_TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'other'] as const
export type MaterialType = (typeof MATERIAL_TYPES)[number]

/** Typical densities in g/cm³ (functional analysis §3.7); `other` has none. */
export const TYPE_DENSITY: Partial<Record<MaterialType, number>> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  PA: 1.14,
  PC: 1.2,
}

export function useMaterials() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.materials,
    queryFn: async () => {
      const { data, error } = await supabase.from('materials').select('*').order('name')
      if (error) throw toAppError(error)
      return data
    },
  })
}

/** Inserts without `id`, otherwise updates that material (partial values allowed, e.g. the Active toggle). */
export function useSaveMaterial() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: Partial<MaterialValues> }) => {
      const { data, error } =
        id === undefined
          ? await supabase
              .from('materials')
              .insert(values as MaterialValues)
              .select()
              .single()
          : await supabase.from('materials').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.materials }),
  })
}

export function useDeleteMaterial() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('materials').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.materials }),
  })
}
