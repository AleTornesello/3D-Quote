import { describe, expect, test } from 'vitest'
import { AppError, fromFunctionCode, fromUploadResponse, toAppError } from './errors'

describe('toAppError', () => {
  test.each([
    [{ code: '23503', message: 'fk' }, 'inUse'],
    [{ code: '23514', message: 'check' }, 'invalid'],
    [{ code: '22P02', message: 'invalid input syntax' }, 'invalid'],
    [{ code: '22003', message: 'numeric field overflow' }, 'invalid'],
    [{ code: '42501', message: 'owner_required' }, 'forbidden'],
    [{ code: 'P0001', message: 'last_owner' }, 'lastOwner'],
    [{ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }, 'notFound'],
    [{ code: '', message: 'TypeError: Failed to fetch' }, 'network'],
    [{ code: 'P0001', message: 'quote_not_draft' }, 'notDraft'],
    [{ code: 'P0001', message: 'quote_not_sendable' }, 'notSendable'],
    [{ code: 'P0001', message: 'something_else' }, 'unknown'],
    [{ code: 'P0002', message: 'quote_not_found' }, 'notFound'],
    [{ code: '22023', message: 'job_message_mismatch' }, 'invalid'],
    [{ code: 'XX000', message: 'boom' }, 'unknown'],
    ['not an error object', 'unknown'],
  ])('%o → %s', (error, kind) => {
    expect(toAppError(error).kind).toBe(kind)
  })

  test('a duplicate names the field from the constraint', () => {
    const error = toAppError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "printers_name_key"',
    })
    expect(error).toMatchObject({
      kind: 'duplicate',
      field: 'name',
      messageKey: 'errors.duplicate',
    })
  })

  test('a thrown TypeError is a network error', () => {
    expect(toAppError(new TypeError('Failed to fetch')).kind).toBe('network')
  })

  test('an AppError passes through unchanged', () => {
    const error = new AppError('invalid', { messageKey: 'account.password.weak' })
    expect(toAppError(error)).toBe(error)
  })
})

describe('messages for quote errors', () => {
  test.each([
    [{ code: 'P0001', message: 'quote_not_sent' }, 'invalid', 'errors.quoteNotSent'],
    [{ code: 'P0001', message: 'retry_not_allowed' }, 'invalid', 'errors.retryNotAllowed'],
    [{ code: 'P0002', message: 'item_not_found' }, 'notFound', 'errors.notFound'],
    [{ code: 'P0002', message: 'model_not_found' }, 'notFound', 'errors.modelNotFound'],
    [{ code: '22023', message: 'printer_inactive' }, 'invalid', 'errors.printerInactive'],
    [{ code: '22023', message: 'material_inactive' }, 'invalid', 'errors.materialInactive'],
    [{ code: '22023', message: 'invalid_override' }, 'invalid', 'errors.invalidOverride'],
    [{ code: '22023', message: 'invalid_markup' }, 'invalid', 'errors.invalidMarkup'],
    [{ code: 'P0001', message: 'quote_not_draft' }, 'notDraft', 'errors.notDraft'],
    [{ code: 'P0001', message: 'quote_not_sendable' }, 'notSendable', 'errors.notSendable'],
  ])('%o → %s, %s', (error, kind, messageKey) => {
    expect(toAppError(error)).toMatchObject({ kind, messageKey })
  })
})

describe('fromFunctionCode', () => {
  test.each([
    ['not_authenticated', 'sessionExpired', 'errors.sessionExpired'],
    ['not_staff', 'forbidden', 'errors.forbidden'],
    ['quote_not_found', 'notFound', 'errors.notFound'],
    ['quote_not_draft', 'notDraft', 'errors.notDraft'],
    ['duplicate_failed', 'unknown', 'errors.duplicateFailed'],
    ['invalid_request', 'unknown', 'errors.unknown'],
    ['internal_error', 'unknown', 'errors.unknown'],
    ['', 'unknown', 'errors.unknown'],
  ])('%s → %s, %s', (code, kind, messageKey) => {
    expect(fromFunctionCode(code)).toMatchObject({ kind, messageKey })
  })
})

describe('fromUploadResponse', () => {
  test.each([
    [null, '', 'network', 'errors.network'],
    [403, '', 'notDraft', 'errors.uploadNotAllowed'],
    [
      400,
      '{"message":"new row violates row-level security policy"}',
      'notDraft',
      'errors.uploadNotAllowed',
    ],
    [413, '', 'invalid', 'errors.fileTooLarge'],
    [
      400,
      '{"message":"The object exceeded the maximum allowed size"}',
      'invalid',
      'errors.fileTooLarge',
    ],
    [500, 'boom', 'unknown', 'errors.unknown'],
  ])('%s %s → %s, %s', (status, body, kind, messageKey) => {
    expect(fromUploadResponse(status, body)).toMatchObject({ kind, messageKey })
  })
})

describe('fromFunctionCode: manage-staff', () => {
  test('not_owner is a permission problem', () => {
    expect(fromFunctionCode('not_owner').kind).toBe('forbidden')
  })
  test('staff_not_found is not found', () => {
    expect(fromFunctionCode('staff_not_found').kind).toBe('notFound')
  })
  test('email_already_registered is a duplicate on the email field', () => {
    const error = fromFunctionCode('email_already_registered')
    expect(error.kind).toBe('duplicate')
    expect(error.field).toBe('email')
    expect(error.messageKey).toBe('staff.errors.emailRegistered')
  })
  test('not_pending explains that the person already signed in', () => {
    const error = fromFunctionCode('not_pending')
    expect(error.kind).toBe('invalid')
    expect(error.messageKey).toBe('staff.errors.notPending')
  })
})
