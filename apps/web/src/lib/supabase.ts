import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'

export type AppSupabaseClient = SupabaseClient<Database>

let cached: { key: string; client: AppSupabaseClient } | null = null

/**
 * One client per configuration: StrictMode runs state initialisers twice in development, and two
 * clients would share the same auth storage key.
 */
export function getSupabaseClient(env: SupabaseEnv): AppSupabaseClient {
  const key = `${env.url}|${env.publishableKey}`
  if (cached?.key !== key) {
    cached = { key, client: createClient<Database>(env.url, env.publishableKey) }
  }
  return cached.client
}

export const SupabaseContext = createContext<AppSupabaseClient | null>(null)

export function useSupabase(): AppSupabaseClient {
  const client = useContext(SupabaseContext)
  if (!client) throw new Error('useSupabase must be used inside <SupabaseContext>')
  return client
}
