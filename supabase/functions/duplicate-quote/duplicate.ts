import type { SupabaseClient } from '../_shared/supabase.ts'
import { HttpError } from '../_shared/http.ts'

/**
 * Creates a draft copy of the quote: the quote row, then its plates, their materials and the consumable lines in one
 * transaction. The two calls can't share a transaction, so a failed plate copy deletes the new quote.
 */
export async function duplicateQuote(
  admin: SupabaseClient,
  sourceId: number,
  callerId: string,
): Promise<number> {
  const { data: source, error } = await admin.from('quotes').select('id').eq('id', sourceId)
    .maybeSingle()
  if (error) throw error
  if (!source) throw new HttpError(404, 'quote_not_found')

  const { data: newId, error: createError } = await admin.rpc('service_create_quote_copy', {
    source_id: sourceId,
    created_by: callerId,
  })
  if (createError) throw createError

  const { error: copyError } = await admin.rpc('service_copy_quote_plates', {
    source_id: sourceId,
    new_id: newId,
  })
  if (copyError) {
    console.error(`Duplicating quote ${sourceId} failed`, copyError)
    // Allowed: the copy is a draft. Its plates, if any, cascade.
    const { error } = await admin.from('quotes').delete().eq('id', newId)
    if (error) console.error(`Deleting the partial copy ${newId} failed`, error)
    throw new HttpError(500, 'duplicate_failed')
  }
  return newId
}
