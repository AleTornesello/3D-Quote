import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { operatorStaff, ownerStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

test('a user without a staff record sees no access and can log out', async () => {
  const { auth, user } = renderApp('/quotes', { session, staff: null })
  expect(await screen.findByRole('heading', { name: 'Nessun accesso' })).toBeInTheDocument()
  expect(
    screen.getByText('Il tuo account non ha accesso a 3D-Quote: chiedi al titolare.'),
  ).toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Esci' }))
  expect(auth.signOut).toHaveBeenCalled()
  expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument()
})

test('an inactive staff row is treated as no access', async () => {
  renderApp('/quotes', { session, staff: { ...operatorStaff, active: false } })
  expect(await screen.findByRole('heading', { name: 'Nessun accesso' })).toBeInTheDocument()
})

test('a failed profile load offers Retry instead of saying no access', async () => {
  const { db, user } = renderApp('/quotes', { session })
  db.failNext('staff', NETWORK_FAILURE)
  expect(
    await screen.findByRole('heading', { name: 'Impossibile caricare il profilo' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  expect(screen.queryByRole('heading', { name: 'Nessun accesso' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Preventivi' })).toBeInTheDocument()
})

test('the language on the staff record is applied after sign-in', async () => {
  renderApp('/quotes', { session, staff: { ...ownerStaff, language: 'en' } })
  expect(await screen.findByRole('heading', { level: 1, name: 'Quotes' })).toBeInTheDocument()
})

test('the sidebar shows the display name and hides Staff from operators', async () => {
  renderApp('/quotes', { session, staff: operatorStaff })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  expect(within(nav).getByText('Otto Bianchi')).toBeInTheDocument()
  expect(within(nav).queryByRole('link', { name: 'Personale' })).not.toBeInTheDocument()
})

test('owners see Staff in the sidebar', async () => {
  renderApp('/quotes', { session })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  expect(within(nav).getByRole('link', { name: 'Personale' })).toBeInTheDocument()
})
