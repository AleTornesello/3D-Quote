import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
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

export type ClientQuote = Pick<
  Tables<'quotes'>,
  'id' | 'number' | 'status' | 'created_at' | 'valid_until'
>

/** One client, or null when it doesn't exist. `id` null (an invalid URL) disables the query. */
export function useClient(id: number | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.client(id ?? 0),
    enabled: id !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id as number)
        .maybeSingle()
      if (error) throw toAppError(error)
      return data
    },
  })
}

export function useClientQuotes(clientId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.clientQuotes(clientId),
    queryFn: async (): Promise<ClientQuote[]> => {
      const { data, error } = await supabase
        .from('quotes')
        .select('id, number, status, created_at, valid_until')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw toAppError(error)
      return data
    },
  })
}

export function useDeleteClient() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('clients').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    // Only the lists: refetching the deleted client's own page would flash "not found" before leaving it.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.clientLists }),
  })
}
