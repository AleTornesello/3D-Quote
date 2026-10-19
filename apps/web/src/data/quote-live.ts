import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useSupabase } from '@/lib/supabase'
import { queryKeys } from './query-keys'

let channelSeq = 0

/**
 * Refetches the quote's plates whenever Realtime reports a change to them or to their material rows. Events only
 * trigger a refetch (debounced 250 ms); their payloads are never merged, so the database stays the source. Material
 * rows carry no quote id, so every staff-visible material change refetches; the refetch is cheap and debounced.
 */
export function useQuoteLiveUpdates(quoteId: number) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  // Across rebuilds: changes made between the old channel's removal and the new one's subscription are never
  // delivered.
  const subscribedBefore = useRef(false)

  useEffect(() => {
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.quotePlates(quoteId) })
      }, 250)
    }
    // A fresh topic per subscription: supabase-js reuses a channel with the same topic, and the old one may still
    // be closing.
    const channel = supabase
      .channel(`quote-${quoteId}-${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_plates', filter: `quote_id=eq.${quoteId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_plate_materials' },
        refresh,
      )
    channel.subscribe((status) => {
      if (closed || status !== 'SUBSCRIBED') return
      // Back after a drop, or a rebuilt channel: changes made meanwhile were never delivered. Only the editor's first
      // subscription is skipped, right after the initial fetch.
      if (subscribedBefore.current) refresh()
      subscribedBefore.current = true
    })
    return () => {
      closed = true
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [supabase, queryClient, quoteId])
}
