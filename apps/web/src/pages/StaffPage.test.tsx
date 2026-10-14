import { screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const SIGNED_IN = '2026-10-01T10:00:00Z'
const member = (
  userId: string,
  name: string,
  email: string,
  role: string,
  active = true,
  lastSignInAt: string | null = SIGNED_IN,
) => ({
  user_id: userId,
  display_name: name,
  email,
  role,
  language: 'it',
  active,
  created_at: '2026-01-01T09:00:00Z',
  last_sign_in_at: lastSignInAt,
})
const members = [
  member('user-1', 'Anna Rossi', 'anna@example.com', 'owner'),
  member('user-2', 'Bruno Verdi', 'bruno@example.com', 'owner'),
  member('user-3', 'Otto Bianchi', 'otto@example.com', 'operator', false),
  member('user-4', 'Carla Neri', 'carla@example.com', 'operator', true, null),
]
const rpc = { list_staff: () => members }
// The fake table holds only the signed-in person; updates (.single()) need the other rows to exist.
const tables = { staff: members.filter((m) => m.user_id !== 'user-1') }

test('lists staff with emails, roles and their status', async () => {
  const { db } = renderApp('/staff', { session, rpc })
  const row = await screen.findByRole('row', { name: /Otto Bianchi/ })
  expect(within(row).getByText('otto@example.com')).toBeInTheDocument()
  expect(within(row).getByRole('combobox', { name: 'Ruolo di Otto Bianchi' })).toHaveValue(
    'operator',
  )
  expect(within(row).getByText('Disattivato')).toBeInTheDocument()
  expect(
    within(screen.getByRole('row', { name: /Anna Rossi/ })).getByText('Attivo'),
  ).toBeInTheDocument()
  expect(
    within(screen.getByRole('row', { name: /Carla Neri/ })).getByText('Invitato'),
  ).toBeInTheDocument()
  expect(db.rpcCalls('list_staff')).toHaveLength(1)
})

test('changing a role updates the staff record', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Ruolo di Carla Neri' }),
    'owner',
  )
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { role: 'owner' },
      filters: [['eq', 'user_id', 'user-4']],
    }),
  )
})

test('demoting the last owner is refused and the role goes back', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  const select = await screen.findByRole('combobox', { name: 'Ruolo di Bruno Verdi' })
  db.failNext('staff', { code: 'P0001', message: 'last_owner' })
  await user.selectOptions(select, 'operator')
  expect(await screen.findByRole('alert')).toHaveTextContent('Deve esserci almeno un titolare.')
  expect(select).toHaveValue('owner')
})

test('owners cannot change their own role here', async () => {
  renderApp('/staff', { session, rpc })
  expect(await screen.findByRole('combobox', { name: 'Ruolo di Anna Rossi' })).toBeDisabled()
})

test('a failed load shows Retry', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  db.failNext('list_staff', NETWORK_FAILURE)
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(await screen.findByRole('row', { name: /Otto Bianchi/ })).toBeInTheDocument()
})

test('an inactive person’s role cannot be changed until they are reactivated', async () => {
  renderApp('/staff', { session, rpc })
  expect(await screen.findByRole('combobox', { name: 'Ruolo di Otto Bianchi' })).toBeDisabled()
})

test('Deactivate asks first, then marks the person inactive', async () => {
  const { db, user } = renderApp('/staff', { session, rpc, tables })
  await user.click(await screen.findByRole('button', { name: 'Disattiva Bruno Verdi' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Disattivare Bruno Verdi?')).toBeInTheDocument()
  expect(db.calls('staff').filter((call) => call.op === 'update')).toHaveLength(0)
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva' }))
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { active: false },
      filters: [['eq', 'user_id', 'user-2']],
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

test('Reactivate needs no confirmation', async () => {
  const { db, user } = renderApp('/staff', { session, rpc, tables })
  await user.click(await screen.findByRole('button', { name: 'Riattiva Otto Bianchi' }))
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { active: true },
      filters: [['eq', 'user_id', 'user-3']],
    }),
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('deactivating the last owner is refused with a message and the dialog stays open', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  await user.click(await screen.findByRole('button', { name: 'Disattiva Bruno Verdi' }))
  const dialog = await screen.findByRole('alertdialog')
  db.failNext('staff', { code: 'P0001', message: 'last_owner' })
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Deve esserci almeno un titolare.',
  )
})

test('there are no actions on your own row', async () => {
  renderApp('/staff', { session, rpc })
  await screen.findByRole('row', { name: /Anna Rossi/ })
  expect(screen.queryByRole('button', { name: 'Disattiva Anna Rossi' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disattiva Bruno Verdi' })).toBeInTheDocument()
})

type Body = { action: string; [key: string]: unknown }
const manageStaff = (answers: Record<string, unknown>) => (body: unknown) => {
  const { action } = body as Body
  const answer = answers[action]
  if (answer && typeof answer === 'object' && 'status' in answer) return answer as never
  return { data: answer ?? {} }
}

test('Invite sends the trimmed name and email and confirms with a toast', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: {
      'manage-staff': manageStaff({ invite: { user_id: 'user-9', email_sent: true } }),
    },
  })
  await user.click(await screen.findByRole('button', { name: 'Invita' }))
  const sheet = await screen.findByRole('dialog', { name: 'Invita una persona' })
  await user.type(within(sheet).getByLabelText('Nome'), '  Dora Bianchi ')
  await user.type(within(sheet).getByLabelText('Email'), '  Dora@Example.com ')
  await user.selectOptions(within(sheet).getByLabelText('Ruolo'), 'owner')
  await user.click(within(sheet).getByRole('button', { name: 'Invia invito' }))
  expect(await screen.findByText('Invito inviato a dora@example.com.')).toBeInTheDocument()
  expect(db.functionCalls('manage-staff')).toEqual([
    { action: 'invite', email: 'dora@example.com', display_name: 'Dora Bianchi', role: 'owner' },
  ])
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('Invite checks the fields before calling the function', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({}) },
  })
  await user.click(await screen.findByRole('button', { name: 'Invita' }))
  const sheet = await screen.findByRole('dialog', { name: 'Invita una persona' })
  await user.type(within(sheet).getByLabelText('Email'), 'not-an-email')
  await user.click(within(sheet).getByRole('button', { name: 'Invia invito' }))
  expect(await within(sheet).findByText('Campo obbligatorio.')).toBeInTheDocument()
  expect(within(sheet).getByText('Inserisci un indirizzo email valido.')).toBeInTheDocument()
  expect(db.functionCalls('manage-staff')).toHaveLength(0)
})

test('Invite shows an email that already has an account next to the field', async () => {
  const { user } = renderApp('/staff', {
    session,
    rpc,
    functions: {
      'manage-staff': manageStaff({ invite: { status: 409, code: 'email_already_registered' } }),
    },
  })
  await user.click(await screen.findByRole('button', { name: 'Invita' }))
  const sheet = await screen.findByRole('dialog', { name: 'Invita una persona' })
  await user.type(within(sheet).getByLabelText('Nome'), 'Dora')
  await user.type(within(sheet).getByLabelText('Email'), 'anna@example.com')
  await user.click(within(sheet).getByRole('button', { name: 'Invia invito' }))
  expect(await within(sheet).findByText('Questa email ha già un account.')).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Invita una persona' })).toBeInTheDocument()
})

test('when the email cannot be sent the invitation link is offered to copy', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: {
      'manage-staff': manageStaff({
        invite: { user_id: 'user-9', email_sent: false },
        link: { link: 'https://auth.test/verify?token=abc' },
      }),
    },
  })
  await user.click(await screen.findByRole('button', { name: 'Invita' }))
  const sheet = await screen.findByRole('dialog', { name: 'Invita una persona' })
  await user.type(within(sheet).getByLabelText('Nome'), 'Dora Bianchi')
  await user.type(within(sheet).getByLabelText('Email'), 'dora@example.com')
  await user.click(within(sheet).getByRole('button', { name: 'Invia invito' }))
  const dialog = await screen.findByRole('dialog', { name: 'Link di invito' })
  expect(within(dialog).getByText(/Impossibile inviare l'email/)).toBeInTheDocument()
  expect(within(dialog).getByText('https://auth.test/verify?token=abc')).toBeInTheDocument()
  expect(db.functionCalls('manage-staff')).toContainEqual({ action: 'link', user_id: 'user-9' })
  await user.click(within(dialog).getByRole('button', { name: 'Copia' }))
  expect(await navigator.clipboard.readText()).toBe('https://auth.test/verify?token=abc')
})

test('an invited person has Resend, Copy link and Revoke, and no Deactivate', async () => {
  renderApp('/staff', { session, rpc })
  await screen.findByRole('row', { name: /Carla Neri/ })
  expect(
    screen.getByRole('button', { name: "Invia di nuovo l'invito a Carla Neri" }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Copia il link di invito di Carla Neri' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: "Revoca l'invito di Carla Neri" })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Disattiva Carla Neri' })).not.toBeInTheDocument()
})

test('Resend sends the invitation again', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({ resend: { email_sent: true } }) },
  })
  await user.click(
    await screen.findByRole('button', { name: "Invia di nuovo l'invito a Carla Neri" }),
  )
  expect(await screen.findByText('Invito inviato.')).toBeInTheDocument()
  expect(db.functionCalls('manage-staff')).toEqual([{ action: 'resend', user_id: 'user-4' }])
})

test('Resend offers the link when the email fails again', async () => {
  const { user } = renderApp('/staff', {
    session,
    rpc,
    functions: {
      'manage-staff': manageStaff({
        resend: { email_sent: false },
        link: { link: 'https://auth.test/verify?token=xyz' },
      }),
    },
  })
  await user.click(
    await screen.findByRole('button', { name: "Invia di nuovo l'invito a Carla Neri" }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'Link di invito' })
  expect(within(dialog).getByText('https://auth.test/verify?token=xyz')).toBeInTheDocument()
  expect(within(dialog).getByText(/Impossibile inviare l'email/)).toBeInTheDocument()
})

test('Copy link puts the link on the clipboard', async () => {
  const { user } = renderApp('/staff', {
    session,
    rpc,
    functions: {
      'manage-staff': manageStaff({ link: { link: 'https://auth.test/verify?token=abc' } }),
    },
  })
  await user.click(
    await screen.findByRole('button', { name: 'Copia il link di invito di Carla Neri' }),
  )
  expect(await screen.findByText('Link copiato.')).toBeInTheDocument()
  expect(await navigator.clipboard.readText()).toBe('https://auth.test/verify?token=abc')
})

test('Copy link opens the link dialog when the clipboard is unavailable', async () => {
  const { user } = renderApp('/staff', {
    session,
    rpc,
    functions: {
      'manage-staff': manageStaff({ link: { link: 'https://auth.test/verify?token=abc' } }),
    },
  })
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  await user.click(
    await screen.findByRole('button', { name: 'Copia il link di invito di Carla Neri' }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'Link di invito' })
  expect(within(dialog).getByText('https://auth.test/verify?token=abc')).toBeInTheDocument()
  expect(within(dialog).getByText(/Impossibile copiare in automatico/)).toBeInTheDocument()
  expect(within(dialog).queryByText(/Impossibile inviare l'email/)).not.toBeInTheDocument()
})

test('Revoke asks first, then deletes the invitation', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({ cancel: {} }) },
  })
  await user.click(await screen.findByRole('button', { name: "Revoca l'invito di Carla Neri" }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText("Revocare l'invito per Carla Neri?")).toBeInTheDocument()
  expect(db.functionCalls('manage-staff')).toHaveLength(0)
  await user.click(within(dialog).getByRole('button', { name: 'Revoca' }))
  expect(await screen.findByText('Invito revocato.')).toBeInTheDocument()
  expect(db.functionCalls('manage-staff')).toEqual([{ action: 'cancel', user_id: 'user-4' }])
})

test('a person who already signed in cannot be revoked: the error is shown and the list reloads', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({ cancel: { status: 409, code: 'not_pending' } }) },
  })
  await user.click(await screen.findByRole('button', { name: "Revoca l'invito di Carla Neri" }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Revoca' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    "Questa persona ha già effettuato l'accesso",
  )
  await waitFor(() => expect(db.rpcCalls('list_staff').length).toBeGreaterThan(1))
})
