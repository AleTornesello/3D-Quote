import { supabaseCorsHeaders } from './supabase.ts'

// The allowed headers come from supabase-js, so headers it adds later (retries, tracing) keep passing the preflight.
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': supabaseCorsHeaders['Access-Control-Allow-Headers'],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** An error the caller sees as `{ code }` with this status. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Answers the preflight, allows only POST, and turns every error into `{ code }` with CORS headers. */
export function createHandler(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    try {
      if (req.method !== 'POST') throw new HttpError(400, 'invalid_request')
      return await handler(req)
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { code: error.code })
      console.error(error)
      return json(500, { code: 'internal_error' })
    }
  }
}

export async function readQuoteId(req: Request): Promise<number> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, 'invalid_request')
  }
  const id = typeof body === 'object' && body !== null
    ? (body as { quote_id?: unknown }).quote_id
    : undefined
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, 'invalid_request')
  }
  return id
}
