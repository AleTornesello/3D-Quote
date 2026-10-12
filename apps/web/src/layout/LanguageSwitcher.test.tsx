import { screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { STORAGE_KEY } from '@/i18n'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

afterEach(() => vi.restoreAllMocks())

test('switches the UI language and remembers it', async () => {
  const { user } = renderApp('/login')
  expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Lingua'), 'en')
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  expect(document.documentElement.lang).toBe('en')
  expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en')
})

test('switching works when localStorage throws', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const { user } = renderApp('/login')
  await user.selectOptions(await screen.findByLabelText('Lingua'), 'en')
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
})

test('signed in, the choice is saved on the staff record', async () => {
  const { db, user } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  await user.selectOptions(within(nav).getByLabelText('Lingua'), 'en')
  expect(await screen.findByRole('heading', { level: 1, name: 'Quotes' })).toBeInTheDocument()
  expect(db.calls('staff')).toContainEqual({
    op: 'update',
    values: { language: 'en' },
    filters: [['eq', 'user_id', 'user-1']],
  })
})

test('a failed save keeps the new language and says so', async () => {
  const { db, user } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  db.failNext('staff', NETWORK_FAILURE)
  await user.selectOptions(within(nav).getByLabelText('Lingua'), 'en')
  expect(await within(nav).findByRole('alert')).toHaveTextContent(
    'Language changed on this device only',
  )
  expect(screen.getByRole('heading', { level: 1, name: 'Quotes' })).toBeInTheDocument()
})
