import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const pages = [
  ['/quotes', 'Preventivi'],
  ['/clients', 'Clienti'],
  ['/settings', 'Impostazioni'],
  ['/staff', 'Personale'],
  ['/account', 'Account'],
] as const

test.each(pages)('%s shows its translated title', async (path, title) => {
  renderApp(path, { session: fakeSession() })
  expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  expect(screen.getByText('In arrivo.')).toBeInTheDocument()
})

test('root redirects to quotes', async () => {
  const { router } = renderApp('/', { session: fakeSession() })
  expect(await screen.findByRole('heading', { level: 1, name: 'Preventivi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes')
})

test('unknown paths show not found', async () => {
  renderApp('/nope', { session: fakeSession() })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Torna ai preventivi' })).toHaveAttribute(
    'href',
    '/quotes',
  )
})

test('sidebar navigates between sections and marks the active one', async () => {
  const { router } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  await userEvent.click(within(nav).getByRole('link', { name: 'Clienti' }))
  expect(router.state.location.pathname).toBe('/clients')
  expect(within(nav).getByRole('link', { name: 'Clienti' })).toHaveAttribute('aria-current', 'page')
})

test('log out signs out and returns to login', async () => {
  const { auth, router } = renderApp('/quotes', { session: fakeSession('anna@example.com') })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  expect(within(nav).getByText('Anna Rossi')).toBeInTheDocument()
  await userEvent.click(within(nav).getByRole('button', { name: 'Esci' }))
  expect(auth.signOut).toHaveBeenCalled()
  expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/login')
})

test('operators opening /staff are told it is not for their role', async () => {
  renderApp('/staff', { session: fakeSession(), staff: operatorStaff })
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Non disponibile per il tuo ruolo' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Torna ai preventivi' })).toHaveAttribute(
    'href',
    '/quotes',
  )
})
