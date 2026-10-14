import { describe, expect, test } from 'vitest'
import { staffStatus } from './staff-rules'

describe('staffStatus', () => {
  test('a deactivated person is inactive, whether or not they ever signed in', () => {
    expect(staffStatus({ active: false, last_sign_in_at: '2026-10-01T10:00:00Z' })).toBe('inactive')
    expect(staffStatus({ active: false, last_sign_in_at: null })).toBe('inactive')
  })
  test('an active person who never signed in is invited', () => {
    expect(staffStatus({ active: true, last_sign_in_at: null })).toBe('invited')
  })
  test('an active person who has signed in is active', () => {
    expect(staffStatus({ active: true, last_sign_in_at: '2026-10-01T10:00:00Z' })).toBe('active')
  })
})
