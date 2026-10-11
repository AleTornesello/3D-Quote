import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

test('desktop sidebar stays in view while the page scrolls', async () => {
  renderApp('/quotes', { session: fakeSession() })
  const sidebar = await screen.findByRole('complementary')
  expect(sidebar).toHaveClass('lg:sticky', 'lg:top-0', 'lg:h-svh', 'lg:overflow-y-auto')
})

test('drawer has a translated close button and closes on navigation', async () => {
  const { router } = renderApp('/quotes', { session: fakeSession() })
  await userEvent.click(await screen.findByRole('button', { name: 'Menu' }))
  const drawer = await screen.findByRole('dialog')
  expect(within(drawer).getByRole('button', { name: 'Chiudi' })).toBeInTheDocument()

  await userEvent.click(within(drawer).getByRole('link', { name: 'Clienti' }))

  expect(router.state.location.pathname).toBe('/clients')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('controls are at least 44px tall on touch screens', async () => {
  renderApp('/login')
  expect(await screen.findByLabelText('Email')).toHaveClass('pointer-coarse:h-11')
  expect(screen.getByRole('button', { name: 'Accedi' })).toHaveClass('pointer-coarse:h-11')
  expect(screen.getByLabelText('Lingua')).toHaveClass('pointer-coarse:h-11')
})
