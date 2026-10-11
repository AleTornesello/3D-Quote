import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import { vi } from 'vitest'

type Listener = (event: AuthChangeEvent, session: Session | null) => void

export function fakeSession(email = 'staff@example.com'): Session {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  } as Session
}

/** How a fake sign-in fails: wrong credentials, a network error result, or a rejected promise. */
export type SignInFailure = 'credentials' | 'network' | 'reject'

const signInErrors = {
  credentials: {
    name: 'AuthApiError',
    status: 400,
    code: 'invalid_credentials',
    message: 'Invalid login credentials',
  },
  network: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
}

/** A stand-in for supabase.auth with controllable outcomes. `pendingSession` keeps getSession unresolved. */
export function createFakeSupabase(
  opts: { session?: Session | null; signInError?: SignInFailure; pendingSession?: boolean } = {},
) {
  let current = opts.session ?? null
  const listeners = new Set<Listener>()
  const emit = (event: AuthChangeEvent) => listeners.forEach((l) => l(event, current))

  const auth = {
    getSession: vi.fn(() =>
      opts.pendingSession
        ? new Promise<never>(() => {})
        : Promise.resolve({ data: { session: current }, error: null }),
    ),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.add(listener)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    }),
    signInWithPassword: vi.fn(async ({ email }: { email: string; password: string }) => {
      if (opts.signInError === 'reject') throw new TypeError('Failed to fetch')
      if (opts.signInError) {
        return { data: { session: null, user: null }, error: signInErrors[opts.signInError] }
      }
      current = fakeSession(email)
      emit('SIGNED_IN')
      return { data: { session: current, user: current.user }, error: null }
    }),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => {
      current = null
      emit('SIGNED_OUT')
      return { error: null }
    }),
  }

  return { client: { auth } as unknown as SupabaseClient, auth }
}
