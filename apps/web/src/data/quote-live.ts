import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSupabase } from '@/lib/supabase'
import { queryKeys } from './query-keys'

let channelSeq = 0

/**
 * Refetches the quote's items whenever Realtime reports a change to them or to their slicing jobs. Events only
 * trigger a refetch (debounced 250 ms); their payloads are never merged, so the database stays the source.
 */
export function useQuoteLiveUpdates(quoteId: number, itemIds: number[]) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const ids = [...itemIds].sort((a, b) => a - b).join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) })
      }, 250)
    }
    // A fresh topic per subscription: supabase-js reuses a channel with the same topic, and the old one may still
    // be closing.
    let channel = supabase
      .channel(`quote-${quoteId}-${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_items', filter: `quote_id=eq.${quoteId}` },
        refresh,
      )
    if (ids) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'slicing_jobs',
          filter: `quote_item_id=in.(${ids})`,
        },
        refresh,
      )
    }
    let subscribedBefore = false
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      // Back after a drop: changes made meanwhile were never delivered.
      if (subscribedBefore) refresh()
      subscribedBefore = true
    })
    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [supabase, queryClient, quoteId, ids])
}
