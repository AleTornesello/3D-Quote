import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type PlateMaterial = Tables<'quote_plate_materials'>
export type QuotePlate = Tables<'quote_plates'> & { materials: PlateMaterial[] }

/** The quote's plates in creation order, each with its materials in creation order. */
export function useQuotePlates(quoteId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quotePlates(quoteId),
    queryFn: async (): Promise<QuotePlate[]> => {
      const { data, error } = await supabase
        .from('quote_plates')
        .select('*, materials:quote_plate_materials(*)')
        .eq('quote_id', quoteId)
        .order('id')
        .order('id', { referencedTable: 'materials' })
      if (error) throw toAppError(error)
      return data
    },
  })
}

/** A plate change can move the quote's total, so the list refreshes too. */
function refreshPlates(queryClient: QueryClient, quoteId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.quotePlates(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
  ])
}

/** Every edit fails once the quote has left draft; reloading the quote turns the editor read-only. */
function refreshIfNotDraft(queryClient: QueryClient, error: unknown, quoteId: number) {
  if (error instanceof AppError && error.kind === 'notDraft') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) })
  }
}

function useRefreshing() {
  const queryClient = useQueryClient()
  return {
    onSuccess: (quoteId: number) => refreshPlates(queryClient, quoteId),
    onError: (error: unknown, quoteId: number) => refreshIfNotDraft(queryClient, error, quoteId),
  }
}

export function useCreatePlate() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({
      quoteId,
      description,
      printer_id,
    }: {
      quoteId: number
      description: string
      printer_id: number | null
    }) => {
      const { data, error } = await supabase.rpc('create_quote_plate', {
        quote_id: quoteId,
        description,
        ...(printer_id !== null ? { printer_id } : {}),
      })
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: (_id, { quoteId }) => refresh.onSuccess(quoteId),
    onError: (error, { quoteId }) => refresh.onError(error, quoteId),
  })
}

export type PlateValues = { description?: string; quantity?: number; print_time_s?: number }

/** Description, quantity or print time. RLS hides plates of quotes that left draft, so no row back means that. */
export function useUpdatePlate() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ plate, values }: { plate: QuotePlate; values: PlateValues }) => {
      const { data, error } = await supabase
        .from('quote_plates')
        .update(values)
        .eq('id', plate.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useSetPlatePrinter() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ plate, printerId }: { plate: QuotePlate; printerId: number }) => {
      const { error } = await supabase.rpc('set_plate_printer', {
        plate_id: plate.id,
        printer_id: printerId,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

/** Adds the material or sets its grams when the plate already has it. */
export function useSaveMaterial() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({
      plate,
      materialId,
      grams,
    }: {
      plate: QuotePlate
      materialId: number
      grams: number
    }) => {
      const { error } = await supabase.rpc('save_plate_material', {
        plate_id: plate.id,
        material_id: materialId,
        grams,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useRemoveMaterial() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({ materialRowId }: { plate: QuotePlate; materialRowId: number }) => {
      const { data, error } = await supabase
        .from('quote_plate_materials')
        .delete()
        .eq('id', materialRowId)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useRemovePlate() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async (plate: QuotePlate) => {
      const { data, error } = await supabase
        .from('quote_plates')
        .delete()
        .eq('id', plate.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, plate) => refresh.onSuccess(plate.quote_id),
    onError: (error, plate) => refresh.onError(error, plate.quote_id),
  })
}

/** Owner only: sets the plate total by hand; the computed breakdown is kept. */
export function useSetPriceOverride() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async ({
      plate,
      total,
      reason,
    }: {
      plate: QuotePlate
      total: number
      reason: string
    }) => {
      const { error } = await supabase.rpc('set_price_override', {
        plate_id: plate.id,
        total,
        reason,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, { plate }) => refresh.onSuccess(plate.quote_id),
    onError: (error, { plate }) => refresh.onError(error, plate.quote_id),
  })
}

export function useClearPriceOverride() {
  const supabase = useSupabase()
  const refresh = useRefreshing()
  return useMutation({
    mutationFn: async (plate: QuotePlate) => {
      const { error } = await supabase.rpc('clear_price_override', { plate_id: plate.id })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, plate) => refresh.onSuccess(plate.quote_id),
    onError: (error, plate) => refresh.onError(error, plate.quote_id),
  })
}

/** Reads the quote's plates from the cache as they are right now (fresher than the last render). */
export function useCachedQuotePlates() {
  const queryClient = useQueryClient()
  return useCallback(
    (quoteId: number) =>
      queryClient.getQueryData<QuotePlate[]>(queryKeys.quotePlates(quoteId)) ?? [],
    [queryClient],
  )
}
