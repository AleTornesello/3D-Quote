import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSupabase } from '@/lib/supabase'
import { sanitizeSearch } from './clients'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'
import type { QuoteListParams, QuoteSort, QuoteStatus } from './quote-rules'

export const QUOTES_PAGE_SIZE = 25

/** A quotes_list row. View columns are typed nullable, but these come from not-null table columns. */
export type QuoteListRow = {
  id: number
  number: string
  status: QuoteStatus
  client_id: number
  client_name: string
  client_company: string | null
  valid_until: string
  created_at: string
  created_by_name: string
  item_count: number
  total: number | null
}

export type QuoteListPage = { rows: QuoteListRow[]; count: number; outOfRange: boolean }

const LIST_COLUMNS =
  'id, number, status, client_id, client_name, client_company, valid_until, created_at, created_by_name, item_count, total'

const SORT_COLUMN: Record<Exclude<QuoteSort, 'number'>, string> = {
  created: 'created_at',
  valid_until: 'valid_until',
  total: 'total',
}

export function useQuotesList(params: QuoteListParams) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quotesList(params),
    queryFn: async (): Promise<QuoteListPage> => {
      let query = supabase.from('quotes_list').select(LIST_COLUMNS, { count: 'exact' })
      const term = sanitizeSearch(params.q)
      if (term) {
        query = query.or(
          `number.ilike.%${term}%,client_name.ilike.%${term}%,client_company.ilike.%${term}%`,
        )
      }
      if (params.status.length) query = query.in('status', params.status)
      if (params.client !== null) query = query.eq('client_id', params.client)
      if (params.from) query = query.gte('created_on', params.from)
      if (params.to) query = query.lte('created_on', params.to)
      const ascending = params.dir === 'asc'
      if (params.sort === 'number') {
        query = query.order('number_year', { ascending }).order('number_seq', { ascending })
      } else {
        query = query.order(SORT_COLUMN[params.sort], { ascending, nullsFirst: false })
      }
      const first = (params.page - 1) * QUOTES_PAGE_SIZE
      const { data, error, count } = await query
        .order('id', { ascending: false })
        .range(first, first + QUOTES_PAGE_SIZE - 1)
      // PostgREST refuses a range that starts past the last row; the page goes back to 1.
      if (error?.code === 'PGRST103') return { rows: [], count: 0, outOfRange: true }
      if (error) throw toAppError(error)
      return { rows: data as QuoteListRow[], count: count ?? 0, outOfRange: false }
    },
    // Keep the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  })
}
