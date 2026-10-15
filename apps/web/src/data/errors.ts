export type AppErrorKind =
  | 'duplicate'
  | 'inUse'
  | 'invalid'
  | 'forbidden'
  | 'lastOwner'
  | 'notFound'
  | 'notDraft'
  | 'notSendable'
  | 'sessionExpired'
  | 'network'
  | 'unknown'

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

/** Messages raised with errcode 22023 (invalid parameter) that have their own text. */
const INVALID_MESSAGES: Record<string, string> = {
  printer_inactive: 'errors.printerInactive',
  material_inactive: 'errors.materialInactive',
  consumable_inactive: 'errors.consumableInactive',
  invalid_override: 'errors.invalidOverride',
  invalid_markup: 'errors.invalidMarkup',
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
      if (message === 'quote_not_draft') return new AppError('notDraft', { cause: error })
      if (message === 'quote_not_sendable') return new AppError('notSendable', { cause: error })
      if (message === 'quote_not_sent') {
        return new AppError('invalid', { messageKey: 'errors.quoteNotSent', cause: error })
      }
      if (message === 'retry_not_allowed') {
        return new AppError('invalid', { messageKey: 'errors.retryNotAllowed', cause: error })
      }
      break
    case 'P0002':
      return new AppError('notFound', {
        messageKey: message === 'model_not_found' ? 'errors.modelNotFound' : undefined,
        cause: error,
      })
    case '22023':
      return new AppError('invalid', { messageKey: INVALID_MESSAGES[message], cause: error })
  }
  if (NETWORK_MESSAGE.test(message)) return new AppError('network', { cause: error })
  return new AppError('unknown', { cause: error })
}

/** The `{ code }` an Edge Function answers with (docs/supabase/edge-functions.md). */
export function fromFunctionCode(code: string, cause?: unknown): AppError {
  switch (code) {
    case 'not_authenticated':
      return new AppError('sessionExpired', { cause })
    case 'not_staff':
      return new AppError('forbidden', { cause })
    case 'quote_not_found':
      return new AppError('notFound', { cause })
    case 'quote_not_draft':
      return new AppError('notDraft', { cause })
    case 'duplicate_failed':
      return new AppError('unknown', { messageKey: 'errors.duplicateFailed', cause })
    case 'not_owner':
      return new AppError('forbidden', { cause })
    case 'staff_not_found':
      return new AppError('notFound', { cause })
    case 'email_already_registered':
      return new AppError('duplicate', {
        field: 'email',
        messageKey: 'staff.errors.emailRegistered',
        cause,
      })
    case 'not_pending':
      return new AppError('invalid', { messageKey: 'staff.errors.notPending', cause })
    default:
      return new AppError('unknown', { cause })
  }
}

/**
 * A failed resumable upload. `status` is null when no response arrived. Storage reports a policy refusal (the quote
 * left draft) and an oversized file in the body as well as the status, so both are checked.
 */
export function fromUploadResponse(status: number | null, body: string, cause?: unknown): AppError {
  if (status === null) return new AppError('network', { cause })
  if (status === 403 || /row-level security/i.test(body)) {
    return new AppError('notDraft', { messageKey: 'errors.uploadNotAllowed', cause })
  }
  if (status === 413 || /maximum allowed size|too large/i.test(body)) {
    return new AppError('invalid', { messageKey: 'errors.fileTooLarge', cause })
  }
  return new AppError('unknown', { cause })
}
