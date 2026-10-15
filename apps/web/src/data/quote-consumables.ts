import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type QuoteConsumable = Tables<'quote_consumables'> & {
  consumable: { name: string; unit: string; stock: number }
}

/** The quote's consumable lines in the order they were added. */
export function useQuoteConsumables(quoteId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quoteConsumables(quoteId),
    queryFn: async (): Promise<QuoteConsumable[]> => {
      const { data, error } = await supabase
        .from('quote_consumables')
        .select('*, consumable:consumables(name, unit, stock)')
        .eq('quote_id', quoteId)
        .order('id')
      if (error) throw toAppError(error)
      return data as QuoteConsumable[]
    },
  })
}

/** A line change moves the quote's total, so the list refreshes too. */
function refresh(queryClient: QueryClient, quoteId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteConsumables(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
  ])
}

/** Every edit fails once the quote has left draft; reloading the quote turns the editor read-only. */
function refreshIfNotDraft(queryClient: QueryClient, error: unknown, quoteId: number) {
  if (error instanceof AppError && error.kind === 'notDraft') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) })
  }
}

/** Adds a line at the consumable's current price, or raises the quantity of the existing line. */
export function useAddQuoteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      quoteId,
      consumableId,
      quantity,
    }: {
      quoteId: number
      consumableId: number
      quantity: number
    }) => {
      const { data, error } = await supabase.rpc('add_quote_consumable', {
        quote_id: quoteId,
        consumable_id: consumableId,
        quantity,
      })
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: (_id, { quoteId }) => refresh(queryClient, quoteId),
    onError: (error, { quoteId }) => refreshIfNotDraft(queryClient, error, quoteId),
  })
}

/** RLS hides lines of quotes that left draft, so no row back means exactly that. */
export function useUpdateQuoteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ line, quantity }: { line: QuoteConsumable; quantity: number }) => {
      const { data, error } = await supabase
        .from('quote_consumables')
        .update({ quantity })
        .eq('id', line.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, { line }) => refresh(queryClient, line.quote_id),
    onError: (error, { line }) => refreshIfNotDraft(queryClient, error, line.quote_id),
  })
}

export function useRemoveQuoteConsumable() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (line: QuoteConsumable) => {
      const { data, error } = await supabase
        .from('quote_consumables')
        .delete()
        .eq('id', line.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, line) => refresh(queryClient, line.quote_id),
    onError: (error, line) => refreshIfNotDraft(queryClient, error, line.quote_id),
  })
}
