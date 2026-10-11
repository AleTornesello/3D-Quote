import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { SupabaseEnv } from './env'

let cached: { key: string; client: SupabaseClient } | null = null

/**
 * One client per configuration: StrictMode runs state initialisers twice in development, and two
 * clients would share the same auth storage key.
 */
export function getSupabaseClient(env: SupabaseEnv): SupabaseClient {
  const key = `${env.url}|${env.publishableKey}`
  if (cached?.key !== key) cached = { key, client: createClient(env.url, env.publishableKey) }
  return cached.client
}

export const SupabaseContext = createContext<SupabaseClient | null>(null)

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext)
  if (!client) throw new Error('useSupabase must be used inside <SupabaseContext>')
  return client
}
