import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useCallback } from 'react'
import { useSupabase } from '@/lib/supabase'
import { sanitizeSearch } from './clients'
import type { ClientOption } from './clients'
import { invokeFunction } from './edge-functions'
import { AppError, toAppError } from './errors'
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

/** The quote's status changed under an action: reload it, its items, its send blockers and the lists. */
function refreshChangedQuote(queryClient: QueryClient, quoteId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sendBlockers(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
  ])
}

function isNotDraft(error: unknown) {
  return error instanceof AppError && error.kind === 'notDraft'
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
      // PostgREST refuses a range that starts past the last row, and answers an empty page for one starting right at
      // the end; either way the page goes back to 1.
      if (error?.code === 'PGRST103') return { rows: [], count: 0, outOfRange: true }
      if (error) throw toAppError(error)
      return {
        rows: data as QuoteListRow[],
        count: count ?? 0,
        outOfRange: data.length === 0 && first > 0,
      }
    },
    // Keep the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  })
}

export type QuoteValues = { client_id: number; valid_until: string; notes: string | null }

/** Inserts a draft; the database assigns its number. Resolves to the new id. */
export function useCreateQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: QuoteValues): Promise<number> => {
      // A trigger assigns number, number_year and number_seq; the generated Insert type still requires them, and
      // staff may only insert client_id, valid_until and notes.
      const { data, error } = await supabase
        .from('quotes')
        .insert(values as TablesInsert<'quotes'>)
        .select('id')
        .single()
      if (error) throw toAppError(error)
      return data.id
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
  })
}

/** Owner only. `pct` null removes the override; every item's price breakdown is cleared. */
export function useSetMarkupOverride() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ quoteId, pct }: { quoteId: number; pct: number | null }) => {
      // The generated Args type says number, but the function accepts null to clear the override.
      const { error } = await supabase.rpc('set_markup_override', {
        quote_id: quoteId,
        pct: pct as number,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quotesAll }),
    onError: (error, { quoteId }) => {
      if (isNotDraft(error)) void refreshChangedQuote(queryClient, quoteId)
    },
  })
}
export type Quote = Tables<'quotes'> & {
  client: ClientOption & { email: string | null; phone: string | null }
  creator: { display_name: string }
}

/** One quote with its client and creator, or null when it doesn't exist. `id` null disables the query. */
export function useQuote(id: number | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quote(id ?? 0),
    enabled: id !== null,
    queryFn: async (): Promise<Quote | null> => {
      const { data, error } = await supabase
        .from('quotes')
        .select('*, client:clients(id, name, company, email, phone), creator:staff(display_name)')
        .eq('id', id as number)
        .maybeSingle()
      if (error) throw toAppError(error)
      return data as Quote | null
    },
  })
}

/** Draft only: RLS hides other quotes from updates, so no row back means the quote left draft. */
export function useUpdateQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id: number; values: Partial<QuoteValues> }) => {
      const { data, error } = await supabase.from('quotes').update(values).eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quotesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
    onError: (error, { id }) => {
      if (isNotDraft(error)) void refreshChangedQuote(queryClient, id)
    },
  })
}

/** Owner, draft only. Removes the items' files afterwards, on a best-effort basis. */
export function useDeleteQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const items = await supabase.from('quote_items').select('model_path').eq('quote_id', id)
      if (items.error) throw toAppError(items.error)
      const { data, error } = await supabase.from('quotes').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      // RLS hides non-drafts from deletes; the usual cause is that someone has just sent it.
      if (data.length === 0) throw new AppError('notDraft')
      const paths = items.data.map((item) => item.model_path)
      // A file left behind is an orphan for the cleanup job, not a reason to report the delete as failed.
      if (paths.length > 0) {
        try {
          await supabase.storage.from('models').remove(paths)
        } catch {
          // Already deleted: see above.
        }
      }
    },
    // Only the lists: refetching the deleted quote would flash "not found" before leaving the page.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
    onError: (error, id) => {
      if (isNotDraft(error)) void refreshChangedQuote(queryClient, id)
    },
  })
}

export type SendBlocker = { quote_item_id: number | null; code: string }

/** Why the quote can't be sent yet; empty means it can. Always fetched fresh when the dialog opens. */
export function useSendBlockers(quoteId: number, enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.sendBlockers(quoteId),
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<SendBlocker[]> => {
      const { data, error } = await supabase.rpc('get_quote_send_blockers', { quote_id: quoteId })
      if (error) throw toAppError(error)
      // quote_item_id is null for quote-level blockers, though the generated type says number.
      return data as SendBlocker[]
    },
  })
}

export type QuoteOutcome = 'sent' | 'accepted' | 'rejected'

export function useMarkQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ quoteId, outcome }: { quoteId: number; outcome: QuoteOutcome }) => {
      const args = { quote_id: quoteId }
      const { error } =
        outcome === 'sent'
          ? await supabase.rpc('mark_quote_sent', args)
          : outcome === 'accepted'
            ? await supabase.rpc('mark_quote_accepted', args)
            : await supabase.rpc('mark_quote_rejected', args)
      if (error) throw toAppError(error)
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quotesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
    // quote_not_draft, quote_not_sent, quote_not_sendable: the status changed under us; anything else is cheap to
    // reload too.
    onError: (_error, { quoteId }) => void refreshChangedQuote(queryClient, quoteId),
  })
}

/** Copies the quote into a new priced draft (Edge Function). Resolves to the copy's id. */
export function useDuplicateQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (quoteId: number): Promise<number> => {
      const result = await invokeFunction<{ quote_id: number }>(supabase, 'duplicate-quote', {
        quote_id: quoteId,
      })
      return result.quote_id
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
  })
}

/** Reloads a quote and its items, e.g. after an action found that it is no longer a draft. */
export function useRefreshQuote() {
  const queryClient = useQueryClient()
  return useCallback(
    async (quoteId: number) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) }),
      ])
    },
    [queryClient],
  )
}

export type PriceResult = { priced: number; skipped: number }

/** Prices the draft's sliced items (Edge Function). Resolves once the items have been refetched. */
export function usePriceQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (quoteId: number) =>
      invokeFunction<PriceResult>(supabase, 'price-quote', { quote_id: quoteId }),
    onSuccess: (_result, quoteId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
      ]),
  })
}
