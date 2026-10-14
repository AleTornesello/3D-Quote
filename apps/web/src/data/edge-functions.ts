import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import type { AppSupabaseClient } from '@/lib/supabase'
import { AppError, fromFunctionCode } from './errors'

export type EdgeFunctionName = 'price-quote' | 'duplicate-quote' | 'manage-staff'

async function codeOf(error: FunctionsHttpError): Promise<string> {
  try {
    const body: unknown = await (error.context as Response).json()
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string'
    ) {
      return body.code
    }
  } catch {
    // Not JSON (e.g. a gateway error page): no code.
  }
  return ''
}

/** Calls an Edge Function with the signed-in user's token; a failure becomes the AppError for its `{ code }`. */
export async function invokeFunction<T>(
  supabase: AppSupabaseClient,
  name: EdgeFunctionName,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) throw fromFunctionCode(await codeOf(error), error)
  if (error instanceof FunctionsFetchError) throw new AppError('network', { cause: error })
  throw new AppError('unknown', { cause: error })
}
