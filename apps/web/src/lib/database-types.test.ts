import { expectTypeOf, test } from 'vitest'
import type { Database, Tables } from './database.types'
import type { AppSupabaseClient } from './supabase'

// Checked by `tsc -b` (npm run build); at runtime these assertions are no-ops.
test('the client is typed from the generated schema', () => {
  expectTypeOf<Tables<'printers'>['hourly_rate']>().toEqualTypeOf<number>()
  expectTypeOf<
    Database['public']['Functions']['list_staff']['Returns'][number]['email']
  >().toEqualTypeOf<string>()
  expectTypeOf<AppSupabaseClient>().toHaveProperty('rpc')
})
