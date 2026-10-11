import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { SupabaseEnv } from './env'

export function createSupabaseClient(env: SupabaseEnv): SupabaseClient {
  return createClient(env.url, env.publishableKey)
}

export const SupabaseContext = createContext<SupabaseClient | null>(null)

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext)
  if (!client) throw new Error('useSupabase must be used inside <SupabaseContext>')
  return client
}
