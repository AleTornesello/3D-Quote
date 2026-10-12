import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

async function fillPasswords(
  user: ReturnType<typeof renderApp>['user'],
  first: string,
  second: string,
) {
  const password = await screen.findByLabelText('Nuova password')
  const confirm = screen.getByLabelText('Conferma password')
  await user.clear(password)
  await user.type(password, first)
  await user.clear(confirm)
  await user.type(confirm, second)
  await user.click(screen.getByRole('button', { name: 'Cambia password' }))
}

test('saves the display name', async () => {
  const { db, user } = renderApp('/account', { session })
  const name = await screen.findByLabelText('Nome visualizzato')
  expect(name).toHaveValue('Anna Rossi')
  await user.clear(name)
  await user.type(name, 'Anna R.')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('staff')).toContainEqual({
    op: 'update',
    values: { display_name: 'Anna R.' },
    filters: [['eq', 'user_id', 'user-1']],
  })
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })
  expect(await within(nav).findByText('Anna R.')).toBeInTheDocument()
})

test('changing the language applies it at once and saves it', async () => {
  const { db, user } = renderApp('/account', { session })
  await user.selectOptions(await screen.findByLabelText("Lingua dell'interfaccia"), 'en')
  expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
  expect(db.calls('staff')).toContainEqual({
    op: 'update',
    values: { language: 'en' },
    filters: [['eq', 'user_id', 'user-1']],
  })
})

test('changes the password', async () => {
  const { auth, user } = renderApp('/account', { session })
  await fillPasswords(user, 'new-secret', 'new-secret')
  expect(await screen.findByText('Password aggiornata.')).toBeInTheDocument()
  expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-secret' })
  expect(screen.getByLabelText('Nuova password')).toHaveValue('')
})

test('checks length and confirmation before calling Supabase', async () => {
  const { auth, user } = renderApp('/account', { session })
  await fillPasswords(user, 'abc', 'abc')
  expect(await screen.findByText('Almeno 6 caratteri.')).toBeInTheDocument()
  await fillPasswords(user, 'abcdef', 'abcdeg')
  expect(await screen.findByText('Le password non coincidono.')).toBeInTheDocument()
  expect(auth.updateUser).not.toHaveBeenCalled()
})

test('a password Supabase rejects as weak is explained', async () => {
  const { auth, user } = renderApp('/account', { session })
  auth.updateUser.mockResolvedValueOnce({
    data: { user: null },
    error: { code: 'weak_password', message: 'Password is known to be weak' },
  })
  await fillPasswords(user, 'password1', 'password1')
  expect(await screen.findByText('La password è troppo debole.')).toBeInTheDocument()
})

test('the reset link asks for a new password and clears the flag when done', async () => {
  const { user, router } = renderApp('/account?reset=1', { session })
  expect(await screen.findByText('Scegli una nuova password.')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('Nuova password')).toHaveFocus())
  await fillPasswords(user, 'new-secret', 'new-secret')
  expect(await screen.findByText('Password aggiornata.')).toBeInTheDocument()
  expect(router.state.location.search).toBe('')
  await waitFor(() =>
    expect(screen.queryByText('Scegli una nuova password.')).not.toBeInTheDocument(),
  )
})
