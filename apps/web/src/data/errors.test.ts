import { describe, expect, test } from 'vitest'
import { AppError, toAppError } from './errors'

describe('toAppError', () => {
  test.each([
    [{ code: '23503', message: 'fk' }, 'inUse'],
    [{ code: '23514', message: 'check' }, 'invalid'],
    [{ code: '22P02', message: 'invalid input syntax' }, 'invalid'],
    [{ code: '42501', message: 'owner_required' }, 'forbidden'],
    [{ code: 'P0001', message: 'last_owner' }, 'lastOwner'],
    [{ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }, 'notFound'],
    [{ code: '', message: 'TypeError: Failed to fetch' }, 'network'],
    [{ code: 'P0001', message: 'quote_not_draft' }, 'unknown'],
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
