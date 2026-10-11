import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

async function logIn(email = 'staff@example.com', password = 'secret') {
  await userEvent.type(await screen.findByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Accedi' }))
}

test('redirects to login when signed out', async () => {
  const { router } = renderApp('/clients')
  expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/login')
})

test('shows loading, not login, while the session loads', async () => {
  const { router } = renderApp('/clients', { pendingSession: true })
  expect(await screen.findByRole('status')).toHaveTextContent('Caricamento…')
  expect(router.state.location.pathname).toBe('/clients')
})

test('logs in with email and password and lands on the remembered path', async () => {
  const { auth, router } = renderApp('/clients')
  await logIn('anna@example.com', 'pw-123')
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'anna@example.com',
    password: 'pw-123',
  })
  expect(await screen.findByRole('heading', { name: 'Clienti' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/clients')
})

test('shows an error and stays on login when sign-in fails', async () => {
  const { router } = renderApp('/login', { signInError: 'Invalid login credentials' })
  await logIn()
  expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corretti.')
  expect(router.state.location.pathname).toBe('/login')
})

test('a signed-in user visiting login goes to quotes', async () => {
  const { router } = renderApp('/login', { session: fakeSession() })
  expect(await screen.findByRole('heading', { name: 'Preventivi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes')
})
