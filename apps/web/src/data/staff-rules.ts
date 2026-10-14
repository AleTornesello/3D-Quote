export type StaffStatus = 'invited' | 'active' | 'inactive'

/** Inactive wins; an active person who has never signed in has only been invited. */
export function staffStatus(member: {
  active: boolean
  last_sign_in_at: string | null
}): StaffStatus {
  if (!member.active) return 'inactive'
  return member.last_sign_in_at === null ? 'invited' : 'active'
}
