import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toAppError } from '@/data/errors'
import { useCachedQuoteItems, type QuoteItem } from '@/data/quote-items'
import { unpricedItems } from '@/data/quote-rules'
import { usePriceQuote, useRefreshQuote, type Quote } from '@/data/quotes'

/**
 * Calls price-quote when a draft has items with results and no price. One call at a time; a trigger during a call
 * queues one more. If items are still unpriced after a call that skipped some, it retries once, then gives up on
 * those items (by id and updated_at) until they change. A saved quantity or markup clears priced_at and changes
 * updated_at, so it needs no call of its own.
 */
export function useAutoPrice(quote: Quote, items: QuoteItem[] | undefined) {
  const { t } = useTranslation()
  const price = usePriceQuote()
  const refreshQuote = useRefreshQuote()
  const cachedItems = useCachedQuoteItems()
  const [gaveUp, setGaveUp] = useState<ReadonlyMap<number, string>>(() => new Map())
  // A ref mirror of gaveUp: run() reads it synchronously, while the state drives rendering.
  const gaveUpRef = useRef<Map<number, string>>(new Map())
  const flight = useRef({ running: false, again: false, forced: false })

  /** `forced` (Recalculate, the toast's Retry) always calls; otherwise it only does if something is eligible. */
  async function run(forced = false) {
    const state = flight.current
    if (state.running) {
      if (forced) state.forced = true
      else state.again = true
      return
    }
    state.running = true
    // The cache, not the last render: the refetch has landed by the time mutateAsync resolves.
    const unpriced = () => unpricedItems(cachedItems(quote.id))
    const eligible = () =>
      unpriced().filter((item) => gaveUpRef.current.get(item.id) !== item.updated_at)
    try {
      let force = forced
      for (;;) {
        // Only the items pending now count for the retry and the give-up, not ones given up earlier.
        const start = force ? unpriced() : eligible()
        if (!force && start.length === 0) break
        const ids = new Set(start.map((item) => item.id))
        const stillPending = () => unpriced().filter((item) => ids.has(item.id))
        const result = await price.mutateAsync(quote.id)
        if (result.skipped > 0 && stillPending().length > 0) await price.mutateAsync(quote.id)
        const left = stillPending()
        if (left.length > 0) {
          for (const item of left) gaveUpRef.current.set(item.id, item.updated_at)
          setGaveUp(new Map(gaveUpRef.current))
        }
        // Triggers that arrived during the call queue exactly one more iteration.
        force = state.forced
        if (!state.forced && !state.again) break
        state.forced = false
        state.again = false
      }
    } catch (caught) {
      const error = toAppError(caught)
      if (error.kind === 'notDraft') void refreshQuote(quote.id)
      else {
        toast.error(t(error.messageKey), {
          action: { label: t('common.retry'), onClick: () => void run(true) },
        })
      }
    } finally {
      state.running = false
      state.again = false
      state.forced = false
    }
  }

  // The effect below must call the latest run(); a ref keeps it out of the effect's dependencies.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  const candidates =
    quote.status === 'draft'
      ? unpricedItems(items ?? [])
          .filter((item) => gaveUp.get(item.id) !== item.updated_at)
          .map((item) => `${item.id}@${item.updated_at}`)
          .join(',')
      : ''
  useEffect(() => {
    if (candidates) void runRef.current()
  }, [candidates])

  return {
    recalculate: () => void run(true),
    pricing: price.isPending,
    notCalculated: (item: QuoteItem) => gaveUp.get(item.id) === item.updated_at,
  }
}
