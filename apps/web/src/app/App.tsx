import type { EnvResult } from '@/lib/env'
import { ConfigErrorPage } from '@/pages/ConfigErrorPage'

export default function App({ env }: { env: EnvResult }) {
  if (!env.ok) return <ConfigErrorPage missing={env.missing} />
  return null
}
