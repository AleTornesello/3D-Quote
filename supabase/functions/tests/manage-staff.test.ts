import { assert, assertEquals, assertRejects } from './deps.ts'
import { HttpError } from '../_shared/http.ts'
import { AuthApiError, type SupabaseClient } from '../_shared/supabase.ts'
import {
  cancelInvitation,
  invitationLink,
  inviteStaff,
  parseInvite,
  parseUserId,
  redirectUrl,
  resendInvitation,
} from '../manage-staff/staff.ts'

const USER_ID = '00000000-0000-4000-8000-0000000000c1'

interface Calls {
  generateLink: unknown[]
  invite: unknown[]
  inserts: unknown[]
  deleted: string[]
}

/** A scripted admin client. `staff` is the staff row lookup result; `lastSignIn` the auth user's last sign-in. */
function fakeAdmin(
  options: {
    generateError?: Error
    inviteError?: Error
    inviteThrows?: Error
    insertError?: { code: string; message: string }
    staff?: { user_id: string } | null
    lastSignIn?: string | null
    getUserError?: Error
  } = {},
) {
  const calls: Calls = { generateLink: [], invite: [], inserts: [], deleted: [] }
  const staffQuery = {
    select: () => staffQuery,
    eq: () => staffQuery,
    maybeSingle: () =>
      Promise.resolve({
        data: options.staff === undefined ? { user_id: USER_ID } : options.staff,
        error: null,
      }),
  }
  const admin = {
    auth: {
      admin: {
        generateLink: (args: unknown) => {
          calls.generateLink.push(args)
          return Promise.resolve(
            options.generateError ? { data: null, error: options.generateError } : {
              data: {
                user: { id: USER_ID },
                properties: { action_link: 'https://auth.test/verify?token=abc' },
              },
              error: null,
            },
          )
        },
        inviteUserByEmail: (email: string, opts: unknown) => {
          calls.invite.push([email, opts])
          if (options.inviteThrows) return Promise.reject(options.inviteThrows)
          return Promise.resolve({ data: null, error: options.inviteError ?? null })
        },
        getUserById: () =>
          Promise.resolve(
            options.getUserError ? { data: { user: null }, error: options.getUserError } : {
              data: {
                user: {
                  id: USER_ID,
                  email: 'pending@example.com',
                  last_sign_in_at: options.lastSignIn ?? null,
                },
              },
              error: null,
            },
          ),
        deleteUser: (id: string) => {
          calls.deleted.push(id)
          return Promise.resolve({ data: null, error: null })
        },
      },
    },
    from: (table: string) => {
      assertEquals(table, 'staff')
      return {
        ...staffQuery,
        insert: (row: unknown) => {
          calls.inserts.push(row)
          return Promise.resolve({ error: options.insertError ?? null })
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, calls }
}

function assertNothingMutated(calls: Calls) {
  assertEquals(calls.deleted, [])
  assertEquals(calls.invite, [])
  assertEquals(calls.generateLink, [])
}

const input = { email: 'dora@example.com', display_name: 'Dora Bianchi', role: 'operator' as const }

Deno.test('parseInvite trims, lower-cases the email and accepts both roles', () => {
  assertEquals(
    parseInvite({ email: '  Dora@Example.COM ', display_name: '  Dora Bianchi ', role: 'owner' }),
    { email: 'dora@example.com', display_name: 'Dora Bianchi', role: 'owner' },
  )
})

Deno.test('parseInvite refuses bad input', () => {
  const good = { email: 'dora@example.com', display_name: 'Dora', role: 'operator' }
  const bad: Record<string, unknown>[] = [
    { ...good, email: 'not-an-email' },
    { ...good, email: '' },
    { ...good, email: 42 },
    { ...good, display_name: '   ' },
    { ...good, display_name: undefined },
    { ...good, role: 'admin' },
    { ...good, role: undefined },
  ]
  for (const body of bad) {
    try {
      parseInvite(body)
      throw new Error(`accepted ${JSON.stringify(body)}`)
    } catch (error) {
      assert(error instanceof HttpError, String(error))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
    }
  }
})

Deno.test('parseUserId accepts a UUID and refuses anything else', () => {
  assertEquals(parseUserId({ user_id: USER_ID }), USER_ID)
  for (const value of [undefined, 42, '', 'abc', "x'; drop table staff;--"]) {
    try {
      parseUserId({ user_id: value })
      throw new Error(`accepted ${String(value)}`)
    } catch (error) {
      assert(error instanceof HttpError, String(error))
      assertEquals(error.code, 'invalid_request')
    }
  }
})

Deno.test('inviteStaff creates the user without email, inserts the staff row, then sends the email', async () => {
  const { admin, calls } = fakeAdmin()
  const result = await inviteStaff(admin, input, 'http://localhost:5173/account?reset=1')
  assertEquals(result, { user_id: USER_ID, email_sent: true })
  assertEquals(calls.generateLink, [{
    type: 'invite',
    email: 'dora@example.com',
    options: {
      redirectTo: 'http://localhost:5173/account?reset=1',
      data: { display_name: 'Dora Bianchi' },
    },
  }])
  assertEquals(calls.inserts, [
    { user_id: USER_ID, display_name: 'Dora Bianchi', role: 'operator', language: 'it' },
  ])
  assertEquals(calls.invite, [[
    'dora@example.com',
    { redirectTo: 'http://localhost:5173/account?reset=1' },
  ]])
})

Deno.test('inviteStaff keeps the person and says email_sent false when the email fails', async () => {
  const { admin, calls } = fakeAdmin({ inviteError: new Error('smtp down') })
  const result = await inviteStaff(admin, input, undefined)
  assertEquals(result, { user_id: USER_ID, email_sent: false })
  assertEquals(calls.inserts.length, 1)
  assertEquals(calls.deleted, [])
})

Deno.test('inviteStaff and resend say email_sent false when sending throws', async () => {
  const { admin } = fakeAdmin({ inviteThrows: new Error('network down') })
  assertEquals(await inviteStaff(admin, input, undefined), { user_id: USER_ID, email_sent: false })
  assertEquals(await resendInvitation(admin, USER_ID, undefined), { email_sent: false })
})

Deno.test('inviteStaff passes on a 422 that is not email_exists', async () => {
  const other = new AuthApiError('weak', 422, 'weak_password')
  const { admin } = fakeAdmin({ generateError: other })
  assertEquals(await assertRejects(() => inviteStaff(admin, input, undefined)), other)
})

Deno.test('inviteStaff refuses an email that already has an account', async () => {
  const taken = new AuthApiError('exists', 422, 'email_exists')
  const { admin, calls } = fakeAdmin({ generateError: taken })
  const error = await assertRejects(() => inviteStaff(admin, input, undefined), HttpError)
  assertEquals([error.status, error.code], [409, 'email_already_registered'])
  assertEquals(calls.inserts, [])
})

Deno.test('inviteStaff refuses an email that already has a staff row and deletes nothing', async () => {
  const { admin, calls } = fakeAdmin({ insertError: { code: '23505', message: 'duplicate key' } })
  const error = await assertRejects(() => inviteStaff(admin, input, undefined), HttpError)
  assertEquals([error.status, error.code], [409, 'email_already_registered'])
  assertEquals(calls.deleted, [])
  assertEquals(calls.invite, [])
})

Deno.test('inviteStaff passes other failures on', async () => {
  const { admin } = fakeAdmin({ insertError: { code: '57014', message: 'timeout' } })
  await assertRejects(() => inviteStaff(admin, input, undefined))
})

Deno.test('resendInvitation emails a pending person again', async () => {
  const { admin, calls } = fakeAdmin()
  assertEquals(await resendInvitation(admin, USER_ID, 'http://x/account?reset=1'), {
    email_sent: true,
  })
  assertEquals(calls.invite, [['pending@example.com', { redirectTo: 'http://x/account?reset=1' }]])
})

Deno.test('resendInvitation reports a failed email', async () => {
  const { admin } = fakeAdmin({ inviteError: new Error('smtp down') })
  assertEquals(await resendInvitation(admin, USER_ID, undefined), { email_sent: false })
})

Deno.test('invitationLink returns the action link of a pending person', async () => {
  const { admin, calls } = fakeAdmin()
  assertEquals(await invitationLink(admin, USER_ID, 'http://x/account?reset=1'), {
    link: 'https://auth.test/verify?token=abc',
  })
  assertEquals(calls.generateLink, [{
    type: 'invite',
    email: 'pending@example.com',
    options: { redirectTo: 'http://x/account?reset=1' },
  }])
})

Deno.test('resend, link and cancel refuse someone who has signed in', async () => {
  const { admin, calls } = fakeAdmin({ lastSignIn: '2026-10-01T10:00:00Z' })
  for (
    const run of [
      () => resendInvitation(admin, USER_ID, undefined),
      () => invitationLink(admin, USER_ID, undefined),
      () => cancelInvitation(admin, USER_ID),
    ]
  ) {
    const error = await assertRejects(run, HttpError)
    assertEquals([error.status, error.code], [409, 'not_pending'])
    assertNothingMutated(calls)
  }
})

Deno.test('resend, link and cancel refuse an unknown id', async () => {
  const { admin, calls } = fakeAdmin({ staff: null })
  for (
    const run of [
      () => resendInvitation(admin, USER_ID, undefined),
      () => invitationLink(admin, USER_ID, undefined),
      () => cancelInvitation(admin, USER_ID),
    ]
  ) {
    const error = await assertRejects(run, HttpError)
    assertEquals([error.status, error.code], [404, 'staff_not_found'])
    assertNothingMutated(calls)
  }
})

Deno.test('resend, link and cancel treat a login that is gone as an unknown id', async () => {
  const { admin, calls } = fakeAdmin({
    getUserError: new AuthApiError('User not found', 404, 'user_not_found'),
  })
  for (
    const run of [
      () => resendInvitation(admin, USER_ID, undefined),
      () => invitationLink(admin, USER_ID, undefined),
      () => cancelInvitation(admin, USER_ID),
    ]
  ) {
    const error = await assertRejects(run, HttpError)
    assertEquals([error.status, error.code], [404, 'staff_not_found'])
    assertNothingMutated(calls)
  }
})

Deno.test('resend, link and cancel rethrow other lookup failures', async () => {
  const failure = new AuthApiError('boom', 500, 'unexpected_failure')
  const { admin, calls } = fakeAdmin({ getUserError: failure })
  for (
    const run of [
      () => resendInvitation(admin, USER_ID, undefined),
      () => invitationLink(admin, USER_ID, undefined),
      () => cancelInvitation(admin, USER_ID),
    ]
  ) {
    const error = await assertRejects(run)
    assertEquals(error, failure)
    assertNothingMutated(calls)
  }
})

Deno.test('cancelInvitation deletes a pending person', async () => {
  const { admin, calls } = fakeAdmin()
  await cancelInvitation(admin, USER_ID)
  assertEquals(calls.deleted, [USER_ID])
})

Deno.test('redirectUrl points at the account page of an http(s) Origin and nothing else', () => {
  const from = (origin?: string) =>
    redirectUrl(
      new Request('http://x/', origin === undefined ? {} : { headers: { Origin: origin } }),
    )
  assertEquals(from(), undefined)
  assertEquals(from('http://localhost:5173'), 'http://localhost:5173/account?reset=1')
  assertEquals(from('https://app.example.com'), 'https://app.example.com/account?reset=1')
  assertEquals(from('https://user:pw@app.example.com/x'), 'https://app.example.com/account?reset=1')
  assertEquals(from('javascript:alert(1)'), undefined)
  assertEquals(from('data:text/html,x'), undefined)
  assertEquals(from('null'), undefined)
  assertEquals(from('not a url'), undefined)
})
