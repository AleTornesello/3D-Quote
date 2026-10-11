import { useEffect, useState, type ReactNode } from 'react'
import { useSupabase } from '@/lib/supabase'
import { AuthContext, toAuthState, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase()
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState(toAuthState(data.session))
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(toAuthState(session))
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [supabase])

  return <AuthContext value={state}>{children}</AuthContext>
}
