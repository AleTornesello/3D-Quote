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
  const { router } = renderApp('/login', { signInError: 'credentials' })
  await logIn()
  expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corretti.')
  expect(router.state.location.pathname).toBe('/login')
})

test('a network failure says the server could not be reached, not that the password is wrong', async () => {
  renderApp('/login', { signInError: 'network' })
  await logIn()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Impossibile contattare il server. Controlla la connessione e riprova.',
  )
})

test('a rejected sign-in call re-enables the form', async () => {
  renderApp('/login', { signInError: 'reject' })
  await logIn()
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  expect(screen.getByRole('button', { name: 'Accedi' })).toBeEnabled()
})

test('login shows loading, not the form, while the session loads', async () => {
  renderApp('/login', { pendingSession: true })
  expect(await screen.findByRole('status')).toHaveTextContent('Caricamento…')
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
})

test('a signed-in user visiting login goes to quotes', async () => {
  const { router } = renderApp('/login', { session: fakeSession() })
  expect(await screen.findByRole('heading', { name: 'Preventivi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes')
})
