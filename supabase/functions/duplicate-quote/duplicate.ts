import type { SupabaseClient } from '../_shared/supabase.ts'
import { HttpError } from '../_shared/http.ts'

interface SourceItem {
  id: number
  model_path: string
}

/**
 * Creates a draft copy of the quote: the quote row, then each file copied into the new quote's folder, then the
 * items in one transaction. Storage and SQL can't share a transaction, so a failure undoes the copy by hand.
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

  const { data: items, error: itemsError } = await admin
    .from('quote_items')
    .select('id, model_path')
    .eq('quote_id', sourceId)
    .order('id')
  if (itemsError) throw itemsError

  const { data: newId, error: createError } = await admin.rpc('service_create_quote_copy', {
    source_id: sourceId,
    created_by: callerId,
  })
  if (createError) throw createError

  const copied: string[] = []
  try {
    const files: { item_id: number; model_path: string }[] = []
    for (const item of items as SourceItem[]) {
      // The source key's file name is already a valid storage key; the original file name may not be.
      const fileName = item.model_path.split('/').pop()
      const path = `${newId}/${crypto.randomUUID()}/${fileName}`
      const { error: copyError } = await admin.storage.from('models').copy(item.model_path, path)
      if (copyError) throw copyError
      copied.push(path)
      files.push({ item_id: item.id, model_path: path })
    }
    const { error: copyItemsError } = await admin.rpc('service_copy_quote_items', {
      source_id: sourceId,
      new_id: newId,
      files,
    })
    if (copyItemsError) throw copyItemsError
  } catch (cause) {
    console.error(`Duplicating quote ${sourceId} failed`, cause)
    await undoCopy(admin, newId, copied)
    throw new HttpError(500, 'duplicate_failed')
  }
  return newId
}

async function undoCopy(admin: SupabaseClient, quoteId: number, paths: string[]): Promise<void> {
  if (paths.length > 0) {
    const { error } = await admin.storage.from('models').remove(paths)
    if (error) console.error(`Removing the files copied for quote ${quoteId} failed`, error)
  }
  // Allowed: the copy is a draft. Its items, if any, cascade.
  const { error } = await admin.from('quotes').delete().eq('id', quoteId)
  if (error) console.error(`Deleting the partial copy ${quoteId} failed`, error)
}
