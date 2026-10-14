import { assertEquals, assertRejects } from './deps.ts'
import { requireOwner, requireStaff } from '../_shared/auth.ts'
import { HttpError } from '../_shared/http.ts'
import { AuthApiError, AuthRetryableFetchError, type SupabaseClient } from '../_shared/supabase.ts'

const USER_ID = '00000000-0000-4000-8000-0000000000f1'

/** An admin client whose getUser answers with `error` (or the user) and whose staff row is active. */
function fakeAdmin(error: Error | null): SupabaseClient {
  const staffQuery = {
    select: () => staffQuery,
    eq: () => staffQuery,
    maybeSingle: () => Promise.resolve({ data: { active: true }, error: null }),
  }
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          error
            ? { data: { user: null }, error }
            : { data: { user: { id: USER_ID } }, error: null },
        ),
    },
    from: () => staffQuery,
  } as unknown as SupabaseClient
}

const request = new Request('http://localhost/functions/v1/test', {
  method: 'POST',
  headers: { Authorization: 'Bearer some.jwt.token' },
})

Deno.test('a valid session of active staff passes', async () => {
  assertEquals(await requireStaff(request, fakeAdmin(null)), USER_ID)
})

Deno.test('a token Auth rejects is not_authenticated', async () => {
  for (const status of [400, 401, 403, 404]) {
    const error = await assertRejects(
      () => requireStaff(request, fakeAdmin(new AuthApiError('invalid JWT', status, 'bad_jwt'))),
      HttpError,
    )
    assertEquals([error.status, error.code], [401, 'not_authenticated'], String(status))
  }
})

Deno.test('an Auth outage is not reported as not_authenticated', async () => {
  for (
    const error of [
      new AuthRetryableFetchError('fetch failed', 0),
      new AuthApiError('Too many requests', 429, 'over_request_rate_limit'),
      new AuthApiError('Internal error', 500, 'unexpected_failure'),
    ]
  ) {
    const thrown = await assertRejects(() => requireStaff(request, fakeAdmin(error)))
    assertEquals(thrown instanceof HttpError, false, error.message)
  }
})

/** An admin client for a signed-in user whose staff row is `staff` (null = no row). */
function adminWithStaff(staff: { active: boolean; role: string } | null): SupabaseClient {
  const staffQuery = {
    select: () => staffQuery,
    eq: () => staffQuery,
    maybeSingle: () => Promise.resolve({ data: staff, error: null }),
  }
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: () => staffQuery,
  } as unknown as SupabaseClient
}

Deno.test('requireOwner accepts an active owner', async () => {
  const id = await requireOwner(request, adminWithStaff({ active: true, role: 'owner' }))
  assertEquals(id, USER_ID)
})

Deno.test('requireOwner refuses an operator with not_owner', async () => {
  const error = await assertRejects(
    () => requireOwner(request, adminWithStaff({ active: true, role: 'operator' })),
    HttpError,
  )
  assertEquals([error.status, error.code], [403, 'not_owner'])
})

Deno.test('requireOwner refuses an inactive owner with not_staff', async () => {
  const error = await assertRejects(
    () => requireOwner(request, adminWithStaff({ active: false, role: 'owner' })),
    HttpError,
  )
  assertEquals([error.status, error.code], [403, 'not_staff'])
})

Deno.test('requireOwner refuses a user without a staff row with not_staff', async () => {
  const error = await assertRejects(() => requireOwner(request, adminWithStaff(null)), HttpError)
  assertEquals([error.status, error.code], [403, 'not_staff'])
})

Deno.test('requireOwner refuses a request without a token', async () => {
  const error = await assertRejects(
    () =>
      requireOwner(
        new Request('http://localhost/functions/v1/test', { method: 'POST' }),
        adminWithStaff({ active: true, role: 'owner' }),
      ),
    HttpError,
  )
  assertEquals([error.status, error.code], [401, 'not_authenticated'])
})
