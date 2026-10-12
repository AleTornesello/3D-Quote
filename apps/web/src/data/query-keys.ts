/** TanStack Query keys. Invalidating a prefix (e.g. `queryKeys.clientsAll`) refreshes everything under it. */
export const queryKeys = {
  printers: ['printers'] as const,
  materials: ['materials'] as const,
  clientsAll: ['clients'] as const,
  clientLists: ['clients', 'list'] as const,
  clients: (search: string) => ['clients', 'list', search] as const,
  client: (id: number) => ['clients', 'detail', id] as const,
  clientQuotes: (id: number) => ['clients', 'quotes', id] as const,
  settings: ['settings'] as const,
  logoUrl: (path: string) => ['settings', 'logo', path] as const,
  staffAll: ['staff'] as const,
  ownStaff: (userId: string) => ['staff', 'own', userId] as const,
  staffList: ['staff', 'list'] as const,
}
