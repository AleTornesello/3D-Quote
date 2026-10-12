// POST { quote_id } → 200 { priced, skipped }. See docs/supabase/edge-functions.md.
import { requireStaff } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/clients.ts'
import { createHandler, json, readQuoteId } from '../_shared/http.ts'
import { priceQuote } from '../_shared/price-quote.ts'

Deno.serve(createHandler(async (req) => {
  const admin = serviceClient()
  await requireStaff(req, admin)
  const quoteId = await readQuoteId(req)
  return json(200, await priceQuote(admin, quoteId))
}))
