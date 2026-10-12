import { QueryClient } from '@tanstack/react-query'

/** Tests pass `retry: false` so a failed query shows its error at once. */
export function createQueryClient({ retry = 1 }: { retry?: number | false } = {}) {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry } },
  })
}
