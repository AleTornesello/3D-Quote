import { assert, assertEquals, assertMatch } from './deps.ts'
import {
  adminClient,
  callFunction,
  must,
  OPERATOR_EMAIL,
  OPERATOR_ID,
  OWNER_EMAIL,
  OWNER_ID,
  preflight,
  signIn,
} from './helpers.ts'
import type { SupabaseClient } from '../_shared/supabase.ts'

const FN = 'manage-staff'
const unique = () => crypto.randomUUID().slice(0, 8)

/** Deletes the login (and with it the staff row) of a test invitation. */
async function cleanup(admin: SupabaseClient, userId: string | undefined) {
  if (userId) await admin.auth.admin.deleteUser(userId)
}

async function staffRow(admin: SupabaseClient, userId: string) {
  return await must<
    { display_name: string; role: string; language: string; active: boolean } | null
  >(
    admin.from('staff').select('display_name, role, language, active').eq('user_id', userId)
      .maybeSingle(),
  )
}

Deno.test('manage-staff answers the CORS preflight', async () => {
  const response = await preflight(FN)
  assertEquals(response.status, 200)
})

Deno.test('manage-staff needs a signed-in owner', async () => {
  const anonymous = await callFunction(FN, { action: 'invite' })
  assertEquals([anonymous.status, anonymous.body.code], [401, 'not_authenticated'])

  const operator = await callFunction(FN, { action: 'invite' }, await signIn(OPERATOR_EMAIL))
  assertEquals([operator.status, operator.body.code], [403, 'not_owner'])
})

Deno.test('manage-staff refuses bad bodies and unknown actions', async () => {
  const token = await signIn(OWNER_EMAIL)
  for (
    const body of [
      '{not json',
      '[]',
      { action: 'explode' },
      { action: 'invite', email: 'nope', display_name: 'X', role: 'operator' },
      { action: 'invite', email: 'a@example.test', display_name: ' ', role: 'operator' },
      { action: 'invite', email: 'a@example.test', display_name: 'X', role: 'admin' },
      { action: 'resend' },
      { action: 'link', user_id: 'not-a-uuid' },
      { action: 'cancel', user_id: 42 },
    ]
  ) {
    const response = await callFunction(FN, body, token)
    assertEquals(
      [response.status, response.body.code],
      [400, 'invalid_request'],
      JSON.stringify(body),
    )
  }
})

Deno.test('invite creates a pending person; link, resend and cancel work on them', async () => {
  const admin = await adminClient()
  const token = await signIn(OWNER_EMAIL)
  const email = `itest-${unique()}@example.test`
  let userId: string | undefined
  try {
    const invited = await callFunction(
      FN,
      {
        action: 'invite',
        email: `  ${email.toUpperCase()} `,
        display_name: ' Dora Itest ',
        role: 'operator',
      },
      token,
    )
    assertEquals(invited.status, 201)
    userId = invited.body.user_id
    assert(userId)
    assertEquals(typeof invited.body.email_sent, 'boolean')

    assertEquals(await staffRow(admin, userId), {
      display_name: 'Dora Itest',
      role: 'operator',
      language: 'it',
      active: true,
    })
    const { data } = await admin.auth.admin.getUserById(userId)
    assertEquals(data.user?.email, email)
    assertEquals(data.user?.last_sign_in_at ?? null, null)

    const link = await callFunction(FN, { action: 'link', user_id: userId }, token)
    assertEquals(link.status, 200)
    assertMatch(link.body.link ?? '', /^https?:\/\/.+\/verify\?/)

    const resent = await callFunction(FN, { action: 'resend', user_id: userId }, token)
    assertEquals(resent.status, 200)
    assertEquals(typeof resent.body.email_sent, 'boolean')

    const again = await callFunction(
      FN,
      { action: 'invite', email, display_name: 'Dora Again', role: 'owner' },
      token,
    )
    assertEquals([again.status, again.body.code], [409, 'email_already_registered'])
    assertEquals((await staffRow(admin, userId))?.display_name, 'Dora Itest')

    const cancelled = await callFunction(FN, { action: 'cancel', user_id: userId }, token)
    assertEquals(cancelled.status, 200)
    assertEquals(await staffRow(admin, userId), null)
    const gone = await admin.auth.admin.getUserById(userId)
    assert(gone.error || !gone.data.user)
    userId = undefined
  } finally {
    await cleanup(admin, userId)
  }
})

Deno.test('inviting someone who already has an account is refused', async () => {
  const token = await signIn(OWNER_EMAIL)
  const response = await callFunction(
    FN,
    { action: 'invite', email: OPERATOR_EMAIL, display_name: 'Copy', role: 'operator' },
    token,
  )
  assertEquals([response.status, response.body.code], [409, 'email_already_registered'])
})

Deno.test('resend, link and cancel refuse someone who has signed in, and unknown ids', async () => {
  const token = await signIn(OWNER_EMAIL)
  await signIn(OPERATOR_EMAIL) // the operator has now signed in
  for (const action of ['resend', 'link', 'cancel']) {
    const signedIn = await callFunction(FN, { action, user_id: OPERATOR_ID }, token)
    assertEquals([signedIn.status, signedIn.body.code], [409, 'not_pending'], action)
    const unknown = await callFunction(
      FN,
      { action, user_id: '00000000-0000-4000-8000-00000000dead' },
      token,
    )
    assertEquals([unknown.status, unknown.body.code], [404, 'staff_not_found'], action)
  }
  const admin = await adminClient()
  assertEquals((await staffRow(admin, OWNER_ID))?.active, true)
  // the not_pending guard must have kept the signed-in operator's row
  assert((await staffRow(admin, OPERATOR_ID)) !== null)
})
