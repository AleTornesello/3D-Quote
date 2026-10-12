import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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

test('switching to English and straight back saves the last choice', async () => {
  const { db } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  const select = within(nav).getByLabelText('Lingua')
  // Both changes land before the first save resolves.
  fireEvent.change(select, { target: { value: 'en' } })
  fireEvent.change(select, { target: { value: 'it' } })
  expect(await screen.findByRole('heading', { level: 1, name: 'Preventivi' })).toBeInTheDocument()
  await waitFor(() => {
    const updates = db.calls('staff').filter((call) => call.op === 'update')
    expect(updates.at(-1)?.values).toEqual({ language: 'it' })
  })
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(screen.getByRole('heading', { level: 1, name: 'Preventivi' })).toBeInTheDocument()
})

test('a later successful switch clears the failed-save notice', async () => {
  const { db, user } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  db.failNext('staff', NETWORK_FAILURE)
  await user.selectOptions(within(nav).getByLabelText('Lingua'), 'en')
  expect(await within(nav).findByRole('alert')).toBeInTheDocument()
  await user.selectOptions(within(nav).getByLabelText('Language'), 'it')
  await waitFor(() => expect(within(nav).queryByRole('alert')).not.toBeInTheDocument())
})
