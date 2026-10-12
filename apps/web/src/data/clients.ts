import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Client = Tables<'clients'>
export type ClientValues = Pick<
  TablesInsert<'clients'>,
  'name' | 'company' | 'email' | 'phone' | 'notes'
>
export type ClientListRow = Client & { quoteCount: number; lastQuoteAt: string | null }

/** Drops characters that would break PostgREST's or() filter or act as wildcards. */
export function sanitizeSearch(term: string) {
  return term.replace(/[,()%*\\]/g, '').trim()
}

export function useClients(search: string) {
  const supabase = useSupabase()
  const term = sanitizeSearch(search)
  return useQuery({
    queryKey: queryKeys.clients(term),
    queryFn: async (): Promise<ClientListRow[]> => {
      let query = supabase
        .from('clients')
        .select('*, quote_count:quotes(count), last_quote:quotes(created_at)')
      if (term) {
        query = query.or(`name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%`)
      }
      const { data, error } = await query
        .order('created_at', { referencedTable: 'last_quote', ascending: false })
        .limit(1, { referencedTable: 'last_quote' })
        .order('name')
      if (error) throw toAppError(error)
      return data.map(({ quote_count, last_quote, ...client }) => ({
        ...client,
        quoteCount: quote_count[0]?.count ?? 0,
        lastQuoteAt: last_quote[0]?.created_at ?? null,
      }))
    },
    // Keep the current rows on screen while a new search loads.
    placeholderData: keepPreviousData,
  })
}

/** Inserts without `id`, otherwise updates that client. Resolves to the saved row. */
export function useSaveClient() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: ClientValues }) => {
      const { data, error } =
        id === undefined
          ? await supabase.from('clients').insert(values).select().single()
          : await supabase.from('clients').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
  })
}
