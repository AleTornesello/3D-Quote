import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toAppError } from '@/data/errors'
import { useCachedQuotePlates, type QuotePlate } from '@/data/quote-plates'
import { unpricedPlates } from '@/data/quote-rules'
import { usePriceQuote, useRefreshQuote, type Quote } from '@/data/quotes'

/**
 * Calls price-quote when a draft has plates that are complete and have no price. One call at a time; a trigger
 * during a call queues one more. If plates are still unpriced after a call that skipped some, it retries once, then
 * gives up on those plates (by id and updated_at) until they change. A saved quantity, printer, print time, material
 * or markup clears priced_at and changes updated_at, so it needs no call of its own.
 */
export function useAutoPrice(quote: Quote, plates: QuotePlate[] | undefined) {
  const { t } = useTranslation()
  const price = usePriceQuote()
  const refreshQuote = useRefreshQuote()
  const cachedPlates = useCachedQuotePlates()
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
    const unpriced = () => unpricedPlates(cachedPlates(quote.id))
    const eligible = () =>
      unpriced().filter((plate) => gaveUpRef.current.get(plate.id) !== plate.updated_at)
    try {
      let force = forced
      for (;;) {
        // Only the plates pending now count for the retry and the give-up, not ones given up earlier.
        const start = force ? unpriced() : eligible()
        if (!force && start.length === 0) break
        const ids = new Set(start.map((plate) => plate.id))
        const stillPending = () => unpriced().filter((plate) => ids.has(plate.id))
        const result = await price.mutateAsync(quote.id)
        if (result.skipped > 0 && stillPending().length > 0) await price.mutateAsync(quote.id)
        const left = stillPending()
        if (left.length > 0) {
          for (const plate of left) gaveUpRef.current.set(plate.id, plate.updated_at)
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
      ? unpricedPlates(plates ?? [])
          .filter((plate) => gaveUp.get(plate.id) !== plate.updated_at)
          .map((plate) => `${plate.id}@${plate.updated_at}`)
          .join(',')
      : ''
  useEffect(() => {
    if (candidates) void runRef.current()
  }, [candidates])

  return {
    recalculate: () => void run(true),
    pricing: price.isPending,
    notCalculated: (plate: QuotePlate) => gaveUp.get(plate.id) === plate.updated_at,
  }
}
