import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { renderApp } from '@/test/render-app'

test('requests a reset email and always shows the same confirmation', async () => {
  const { auth } = renderApp('/forgot-password')
  await userEvent.type(await screen.findByLabelText('Email'), 'anna@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Invia link' }))
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('anna@example.com', {
    redirectTo: `${window.location.origin}/account`,
  })
  expect(await screen.findByRole('status')).toHaveTextContent(
    "Se l'indirizzo è registrato, riceverai a breve un'email con le istruzioni.",
  )
})
