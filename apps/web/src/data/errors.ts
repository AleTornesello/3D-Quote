export type AppErrorKind =
  'duplicate' | 'inUse' | 'invalid' | 'forbidden' | 'lastOwner' | 'notFound' | 'network' | 'unknown'

/** A failed request reduced to what the UI needs to explain it. `messageKey` is an i18n key. */
export class AppError extends Error {
  readonly kind: AppErrorKind
  readonly field?: string
  readonly messageKey: string

  constructor(
    kind: AppErrorKind,
    options: { field?: string; messageKey?: string; cause?: unknown } = {},
  ) {
    super(kind, { cause: options.cause })
    this.name = 'AppError'
    this.kind = kind
    this.field = options.field
    this.messageKey = options.messageKey ?? `errors.${kind}`
  }
}

const NETWORK_MESSAGE = /failed to fetch|networkerror|fetch failed|load failed/i

/** `duplicate key value violates unique constraint "printers_name_key"` → `name`. */
function fieldFromConstraint(message: string): string | undefined {
  const constraint = /constraint "([a-z0-9_]+)_key"/.exec(message)?.[1]
  return constraint?.split('_').slice(1).join('_') || undefined
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof TypeError) return new AppError('network', { cause: error })
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''

  switch (code) {
    case '23505':
      return new AppError('duplicate', { field: fieldFromConstraint(message), cause: error })
    case '23503':
      return new AppError('inUse', { cause: error })
    case '23514':
    case '22P02':
    case '22003':
      return new AppError('invalid', { cause: error })
    case '42501':
      return new AppError('forbidden', { cause: error })
    case 'PGRST116':
      return new AppError('notFound', { cause: error })
    case 'P0001':
      if (message === 'last_owner') return new AppError('lastOwner', { cause: error })
      break
  }
  if (NETWORK_MESSAGE.test(message)) return new AppError('network', { cause: error })
  return new AppError('unknown', { cause: error })
}
