import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; session: Session }

export const AuthContext = createContext<AuthState>({ status: 'loading' })

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export function toAuthState(session: Session | null): AuthState {
  return session ? { status: 'signedIn', session } : { status: 'signedOut' }
}
