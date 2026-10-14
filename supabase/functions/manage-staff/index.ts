// POST { action, ... } → invite / resend / link / cancel. See docs/supabase/edge-functions.md.
import { requireOwner } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/clients.ts'
import { createHandler, HttpError, json, readJsonObject } from '../_shared/http.ts'
import {
  cancelInvitation,
  invitationLink,
  inviteStaff,
  parseInvite,
  parseUserId,
  resendInvitation,
} from './staff.ts'

/** `<origin>/account?reset=1` from the request's Origin header; undefined lets Supabase use its Site URL. */
function redirectUrl(req: Request): string | undefined {
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

Deno.serve(createHandler(async (req) => {
  const admin = serviceClient()
  await requireOwner(req, admin)
  const body = await readJsonObject(req)
  const redirectTo = redirectUrl(req)

  switch (body.action) {
    case 'invite':
      return json(201, await inviteStaff(admin, parseInvite(body), redirectTo))
    case 'resend':
      return json(200, await resendInvitation(admin, parseUserId(body), redirectTo))
    case 'link':
      return json(200, await invitationLink(admin, parseUserId(body), redirectTo))
    case 'cancel':
      await cancelInvitation(admin, parseUserId(body))
      return json(200, {})
    default:
      throw new HttpError(400, 'invalid_request')
  }
}))
