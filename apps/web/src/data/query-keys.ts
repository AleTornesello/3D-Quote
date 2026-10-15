import type { QuoteListParams } from './quote-rules'

/** TanStack Query keys. Invalidating a prefix (e.g. `queryKeys.clientsAll`) refreshes everything under it. */
export const queryKeys = {
  printers: ['printers'] as const,
  materials: ['materials'] as const,
  consumables: ['consumables'] as const,
  clientsAll: ['clients'] as const,
  clientLists: ['clients', 'list'] as const,
  clients: (search: string) => ['clients', 'list', search] as const,
  client: (id: number) => ['clients', 'detail', id] as const,
  clientQuotes: (id: number) => ['clients', 'quotes', id] as const,
  clientOptions: ['clients', 'options'] as const,
  quotesAll: ['quotes'] as const,
  quoteLists: ['quotes', 'list'] as const,
  quotesList: (params: QuoteListParams) => ['quotes', 'list', params] as const,
  quote: (id: number) => ['quotes', 'detail', id] as const,
  quoteItems: (id: number) => ['quotes', 'items', id] as const,
  quoteConsumables: (id: number) => ['quotes', 'consumables', id] as const,
  sendBlockers: (id: number) => ['quotes', 'blockers', id] as const,
  settings: ['settings'] as const,
  logoUrl: (path: string) => ['settings', 'logo', path] as const,
  staffAll: ['staff'] as const,
  ownStaff: (userId: string) => ['staff', 'own', userId] as const,
  staffList: ['staff', 'list'] as const,
}
