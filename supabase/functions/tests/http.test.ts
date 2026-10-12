// The local gateway answers preflights and adds CORS headers itself, so only these tests show what the hosted
// functions send.
import { assertEquals } from './deps.ts'
import { createHandler, HttpError, json } from '../_shared/http.ts'
import { supabaseCorsHeaders } from '../_shared/supabase.ts'

const URL = 'http://localhost/functions/v1/test'

function assertCors(response: Response) {
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
  assertEquals(
    response.headers.get('access-control-allow-headers'),
    supabaseCorsHeaders['Access-Control-Allow-Headers'],
  )
  assertEquals(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
}

Deno.test('answers the preflight with every header supabase-js may send', async () => {
  const handler = createHandler(() => Promise.reject(new Error('the handler must not run')))

  const response = await handler(new Request(URL, { method: 'OPTIONS' }))

  assertEquals(response.status, 200)
  assertCors(response)
  await response.body?.cancel()
})

Deno.test('adds CORS headers to a successful response', async () => {
  const response = await createHandler(() => Promise.resolve(json(200, { ok: true })))(
    new Request(URL, { method: 'POST' }),
  )

  assertEquals(response.status, 200)
  assertCors(response)
  assertEquals(await response.json(), { ok: true })
})

Deno.test('turns an HttpError into its status and code, with CORS headers', async () => {
  const response = await createHandler(() =>
    Promise.reject(new HttpError(401, 'not_authenticated'))
  )(new Request(URL, { method: 'POST' }))

  assertEquals(response.status, 401)
  assertCors(response)
  assertEquals(await response.json(), { code: 'not_authenticated' })
})

Deno.test('turns any other error into internal_error, with CORS headers', async () => {
  const errors: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => errors.push(args)
  try {
    const response = await createHandler(() => Promise.reject(new Error('boom')))(
      new Request(URL, { method: 'POST' }),
    )

    assertEquals(response.status, 500)
    assertCors(response)
    assertEquals(await response.json(), { code: 'internal_error' })
    assertEquals(errors.length, 1)
  } finally {
    console.error = original
  }
})

Deno.test('refuses methods other than POST, with CORS headers', async () => {
  const response = await createHandler(() => Promise.resolve(json(200, {})))(
    new Request(URL, { method: 'GET' }),
  )

  assertEquals(response.status, 400)
  assertCors(response)
  assertEquals(await response.json(), { code: 'invalid_request' })
})
