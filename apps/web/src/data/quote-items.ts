import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'
import { descriptionFromFilename, type ItemJob } from './quote-rules'

export type QuoteItem = Tables<'quote_items'> & { job: ItemJob | null }

const ITEM_COLUMNS = '*, job:slicing_jobs(id, status, error, queued_at, started_at, finished_at)'

/** The quote's items in creation order, each with its newest slicing job. */
export function useQuoteItems(quoteId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quoteItems(quoteId),
    queryFn: async (): Promise<QuoteItem[]> => {
      const { data, error } = await supabase
        .from('quote_items')
        .select(ITEM_COLUMNS)
        .eq('quote_id', quoteId)
        .order('id')
        .order('id', { referencedTable: 'job', ascending: false })
        .limit(1, { referencedTable: 'job' })
      if (error) throw toAppError(error)
      return data.map(({ job, ...item }) => ({
        ...item,
        job: (job[0] as ItemJob | undefined) ?? null,
      }))
    },
  })
}

export type SliceSettings = {
  printer_id: number | null
  material_id: number | null
  layer_height_mm: number
  infill_percent: number
  supports: boolean
}

/** An item change can move the quote's total, so the list refreshes too. */
function refreshItems(queryClient: QueryClient, quoteId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
  ])
}

/** Every edit fails once the quote has left draft; reloading the quote turns the editor read-only. */
function refreshIfNotDraft(queryClient: QueryClient, error: unknown, quoteId: number) {
  if (error instanceof AppError && error.kind === 'notDraft') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) })
  }
}

/**
 * Sends all five slicing inputs: the item's current values with `change` applied. Any difference clears the
 * results and queues a new slice; no difference does nothing.
 */
export function useUpdateItemSettings() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ item, change }: { item: QuoteItem; change: Partial<SliceSettings> }) => {
      const next: SliceSettings = {
        printer_id: item.printer_id,
        material_id: item.material_id,
        layer_height_mm: item.layer_height_mm,
        infill_percent: item.infill_percent,
        supports: item.supports,
        ...change,
      }
      // Printer and material may still be null; the generated Args type says number.
      const { error } = await supabase.rpc('update_quote_item_settings', {
        item_id: item.id,
        printer_id: next.printer_id as number,
        material_id: next.material_id as number,
        layer_height_mm: next.layer_height_mm,
        infill_percent: next.infill_percent,
        supports: next.supports,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, { item }) => refreshItems(queryClient, item.quote_id),
    onError: (error, { item }) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** Description or quantity. RLS hides items of quotes that left draft, so no row back means exactly that. */
export function useUpdateItem() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      item,
      values,
    }: {
      item: QuoteItem
      values: { description?: string; quantity?: number }
    }) => {
      const { data, error } = await supabase
        .from('quote_items')
        .update(values)
        .eq('id', item.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, { item }) => refreshItems(queryClient, item.quote_id),
    onError: (error, { item }) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** Deletes the item, then its file on a best-effort basis (a leftover is an orphan for the cleanup job). */
export function useRemoveItem() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: QuoteItem) => {
      const { data, error } = await supabase
        .from('quote_items')
        .delete()
        .eq('id', item.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
      await supabase.storage.from('models').remove([item.model_path])
    },
    onSuccess: (_data, item) => refreshItems(queryClient, item.quote_id),
    onError: (error, item) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

export function useRetrySlicing() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: QuoteItem) => {
      const { error } = await supabase.rpc('retry_slicing', { item_id: item.id })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, item) => refreshItems(queryClient, item.quote_id),
    onError: (error, item) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** Owner only: sets the item total by hand; the computed breakdown is kept. */
export function useSetPriceOverride() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      item,
      total,
      reason,
    }: {
      item: QuoteItem
      total: number
      reason: string
    }) => {
      const { error } = await supabase.rpc('set_price_override', {
        item_id: item.id,
        total,
        reason,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, { item }) => refreshItems(queryClient, item.quote_id),
    onError: (error, { item }) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

export function useClearPriceOverride() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: QuoteItem) => {
      const { error } = await supabase.rpc('clear_price_override', { item_id: item.id })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, item) => refreshItems(queryClient, item.quote_id),
    onError: (error, item) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** A download link for a model file, valid for 60 seconds. */
export function useModelDownload() {
  const supabase = useSupabase()
  return useMutation({
    mutationFn: async (path: string): Promise<string> => {
      const { data, error } = await supabase.storage.from('models').createSignedUrl(path, 60)
      if (error) throw toAppError(error)
      return data.signedUrl
    },
  })
}

export type NewItem = {
  quoteId: number
  path: string
  filename: string
  printer_id: number | null
  material_id: number | null
}

/** Creates the item for an uploaded file (queued for slicing when printer and material are set). */
export function useCreateQuoteItem() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ quoteId, path, filename, printer_id, material_id }: NewItem) => {
      const { data, error } = await supabase.rpc('create_quote_item', {
        quote_id: quoteId,
        model_path: path,
        original_filename: filename,
        description: descriptionFromFilename(filename),
        ...(printer_id !== null && material_id !== null ? { printer_id, material_id } : {}),
      })
      if (error) {
        // Without its item the file is an orphan: remove it now, on a best-effort basis.
        await supabase.storage.from('models').remove([path])
        throw toAppError(error)
      }
      return data
    },
    onSuccess: (_id, { quoteId }) => refreshItems(queryClient, quoteId),
  })
}
