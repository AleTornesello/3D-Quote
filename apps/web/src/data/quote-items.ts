import { useQuery } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'
import type { ItemJob } from './quote-rules'

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
