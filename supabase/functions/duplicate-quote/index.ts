// POST { quote_id } → 201 { quote_id } of the new draft. See docs/supabase/edge-functions.md.
import { requireStaff } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/clients.ts'
import { createHandler, json, readQuoteId } from '../_shared/http.ts'
import { priceQuote } from '../_shared/price-quote.ts'
import { duplicateQuote } from './duplicate.ts'

Deno.serve(createHandler(async (req) => {
  const admin = serviceClient()
  const callerId = await requireStaff(req, admin)
  const sourceId = await readQuoteId(req)
  const newId = await duplicateQuote(admin, sourceId, callerId)
  try {
    await priceQuote(admin, newId)
  } catch (error) {
    // The copy is complete; it gets priced on the next change or Recalculate.
    console.error(`Pricing the copy ${newId} failed`, error)
  }
  return json(201, { quote_id: newId })
}))
