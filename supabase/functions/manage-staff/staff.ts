import { HttpError } from '../_shared/http.ts'
import { isAuthApiError, type SupabaseClient } from '../_shared/supabase.ts'

export type StaffRole = 'owner' | 'operator'
export type InviteInput = { email: string; display_name: string; role: StaffRole }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseInvite(body: Record<string, unknown>): InviteInput {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  const role = body.role
  if (!EMAIL.test(email) || displayName === '' || (role !== 'owner' && role !== 'operator')) {
    throw new HttpError(400, 'invalid_request')
  }
  return { email, display_name: displayName, role }
}

export function parseUserId(body: Record<string, unknown>): string {
  const id = body.user_id
  if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(400, 'invalid_request')
  return id
}

/** Sends the invitation email; a failure is reported, not thrown, so the owner can fall back to the link. */
async function sendInvitation(
  admin: SupabaseClient,
  email: string,
  redirectTo: string | undefined,
): Promise<boolean> {
  try {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (error) {
      console.error('The invitation email could not be sent', error)
      return false
    }
    return true
  } catch (error) {
    console.error('The invitation email could not be sent', error)
    return false
  }
}

/**
 * Creates the login (invited, no email yet) and the staff row, then sends the email. An email that already has a
 * confirmed account, or a staff row, is refused. Nothing is deleted on failure: a login left without a staff row is
 * harmless and is reused by the next invite.
 */
export async function inviteStaff(
  admin: SupabaseClient,
  input: InviteInput,
  redirectTo: string | undefined,
): Promise<{ user_id: string; email_sent: boolean }> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { redirectTo, data: { display_name: input.display_name } },
  })
  if (error) {
    if (isAuthApiError(error) && error.code === 'email_exists') {
      throw new HttpError(409, 'email_already_registered')
    }
    throw error
  }
  const userId = data.user.id
  const { error: insertError } = await admin.from('staff').insert({
    user_id: userId,
    display_name: input.display_name,
    role: input.role,
    language: 'it',
  })
  if (insertError) {
    if (insertError.code === '23505') throw new HttpError(409, 'email_already_registered')
    throw insertError
  }
  return { user_id: userId, email_sent: await sendInvitation(admin, input.email, redirectTo) }
}

/** The email of a person who has a staff row and has never signed in. */
async function requirePending(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: staff, error } = await admin
    .from('staff')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!staff) throw new HttpError(404, 'staff_not_found')

  const { data, error: userError } = await admin.auth.admin.getUserById(userId)
  if (userError) {
    if (isAuthApiError(userError) && userError.status === 404) {
      throw new HttpError(404, 'staff_not_found')
    }
    throw userError
  }
  if (data.user.last_sign_in_at) throw new HttpError(409, 'not_pending')
  return data.user.email as string
}

export async function resendInvitation(
  admin: SupabaseClient,
  userId: string,
  redirectTo: string | undefined,
): Promise<{ email_sent: boolean }> {
  const email = await requirePending(admin, userId)
  return { email_sent: await sendInvitation(admin, email, redirectTo) }
}

/** A link that opens the app signed in so the person can set a password; sends nothing. */
export async function invitationLink(
  admin: SupabaseClient,
  userId: string,
  redirectTo: string | undefined,
): Promise<{ link: string }> {
  const email = await requirePending(admin, userId)
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })
  if (error) throw error
  return { link: data.properties.action_link }
}

/** Deletes a pending login; its staff row goes with it (on delete cascade). */
export async function cancelInvitation(admin: SupabaseClient, userId: string): Promise<void> {
  await requirePending(admin, userId)
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw error
}

/** `<origin>/account?reset=1` from the request's Origin header; undefined lets Supabase use its Site URL. */
export function redirectUrl(req: Request): string | undefined {
  const origin = req.headers.get('Origin')
  if (!origin) return undefined
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return `${url.origin}/account?reset=1`
  } catch {
    return undefined
  }
}
