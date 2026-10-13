import { useEffect, useState } from 'react'

/**
 * The current time in ms, refreshed every second while `active`. Components read time through this hook because
 * calling Date.now() while rendering is impure (and the React Compiler lint rejects it).
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
