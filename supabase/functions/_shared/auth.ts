import type { SupabaseClient } from './supabase.ts'
import { HttpError } from './http.ts'

/** The caller's user id, if the bearer token is a valid session of an active staff member. */
export async function requireStaff(req: Request, admin: SupabaseClient): Promise<string> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'not_authenticated')

  const { data, error } = await admin.auth.getUser(token)
  // An Auth outage is not the caller's fault: let it surface as a 500.
  if (error && (error.status ?? 0) >= 500) throw error
  if (error || !data.user) throw new HttpError(401, 'not_authenticated')

  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('active')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (staffError) throw staffError
  if (!staff?.active) throw new HttpError(403, 'not_staff')
  return data.user.id
}
