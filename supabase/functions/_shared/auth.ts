import { isAuthApiError, type SupabaseClient } from './supabase.ts'
import { HttpError } from './http.ts'

/** The caller's user id and staff role, if the bearer token is a valid session of an active staff member. */
async function authenticate(
  req: Request,
  admin: SupabaseClient,
): Promise<{ id: string; role: string | undefined }> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'not_authenticated')

  const { data, error } = await admin.auth.getUser(token)
  if (error) {
    // Only Auth's verdict on the token means "not authenticated". An outage or a rate limit surfaces as a 500, so
    // the web app doesn't sign the user out over it.
    if (isAuthApiError(error) && [400, 401, 403, 404].includes(error.status)) {
      throw new HttpError(401, 'not_authenticated')
    }
    throw error
  }
  if (!data.user) throw new HttpError(401, 'not_authenticated')

  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('active, role')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (staffError) throw staffError
  if (!staff?.active) throw new HttpError(403, 'not_staff')
  return { id: data.user.id, role: staff.role }
}

/** The caller's user id, if the bearer token is a valid session of an active staff member. */
export async function requireStaff(req: Request, admin: SupabaseClient): Promise<string> {
  return (await authenticate(req, admin)).id
}

/** Like requireStaff, and the caller must be an owner. */
export async function requireOwner(req: Request, admin: SupabaseClient): Promise<string> {
  const { id, role } = await authenticate(req, admin)
  if (role !== 'owner') throw new HttpError(403, 'not_owner')
  return id
}
