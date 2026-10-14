# Staff Invites and Management — Design

- **Date:** 2026-10-14
- **Status:** Implemented
- **Branch:** `develop`

## Goal

Let an owner manage staff from the app instead of the Supabase dashboard
([functional analysis](../../frontend/functional-analysis.md) §3.9):

- invite a person by email with a name and a role;
- see who is Invited, Active or Inactive;
- resend an invitation, copy its link, or revoke it;
- deactivate and reactivate people;
- change roles (already built).

Today the Staff screen lists people and changes roles; inviting and removing happen in the dashboard.

## Decisions

| Concern | Choice |
|---|---|
| Removing people | **Deactivate / Reactivate** (`staff.active`). No hard delete of people who have signed in: quotes keep pointing at their creator |
| Revoking access | `active = false` makes `is_staff()` false, which stops every table, storage and Edge Function call. The auth user is not banned |
| Pending invitations | Can be **revoked**: the auth user and the staff row are deleted. Only for people who never signed in |
| Who needs the service role | Invite, resend, link and cancel go through one Edge Function, `manage-staff`. Deactivate, reactivate and role changes stay plain updates under the existing owner policy |
| Invitation delivery | The standard Supabase invitation email, plus a link the owner can copy and send by hand (Supabase's built-in email sender is rate-limited and only delivers to organisation members until SMTP is configured) |
| Accepting an invitation | The email and the copied link both open `<origin>/account?reset=1`, the page that already lets a user with a recovery session set a password |
| Name, role, language | Chosen by the owner at invite time (language defaults to Italian); the invitee only sets a password |
| Status | Computed: not active → Inactive; never signed in → Invited; otherwise Active |

## Database changes

Declared in `supabase/schemas/01_staff.sql`; the migration is generated with `supabase db diff`.

### `list_staff`

`private.list_staff` and `public.list_staff` gain a `last_sign_in_at timestamptz` column (from
`auth.users.last_sign_in_at`). The function's return type changes, so the generated migration must drop and recreate
both functions; check that their grants (owner-only execute for `authenticated`) survive, and repeat them in the
setup migration if the diff does not carry them.

Nothing else in the schema changes. The existing pieces already do what the screen needs:

- the `staff_update` policy lets owners change `role` and `active`;
- `staff_guard` refuses to demote or deactivate the last active owner (`last_owner`);
- `staff` rows cascade away when their auth user is deleted, which is what Revoke relies on. Revoke (action `cancel`) is
  refused for anyone who has signed in, and a person who has never signed in cannot have created quotes.

### Tests (pgTAP)

Extend `10_list_staff.test.sql`: the new column is returned, null for a user who never signed in and set for one who
did; an operator is still refused.

## The `manage-staff` Edge Function

`POST /functions/v1/manage-staff` with a JSON body and the caller's JWT, like the other functions. New shared helper
`requireOwner(req, admin)` in `supabase/functions/_shared/auth.ts`: the same checks as `requireStaff`, then the
staff row must also have `role = 'owner'` (`403 not_owner`).

### Actions

| Body | Does | Answers |
|---|---|---|
| `{ action: "invite", email, display_name, role }` | Creates the auth user and sends the invitation email, redirecting to `<origin>/account?reset=1`; inserts the staff row (`display_name`, `role`, language `it`, active) | `201 { user_id, email_sent }` |
| `{ action: "resend", user_id }` | Sends the invitation email again | `200 { email_sent }` |
| `{ action: "link", user_id }` | Generates a one-time link that opens `<origin>/account?reset=1` (an invite-type link, generated with `generateLink`; sends nothing) | `200 { link }` |
| `{ action: "cancel", user_id }` | Deletes the auth user (the staff row goes with it) | `200 {}` |

- `<origin>` is taken from the request's `Origin` header; if it is missing the function falls back to the project's
  Site URL.
- `email` is trimmed and lower-cased; `display_name` is trimmed and must not be empty; `role` is `owner` or
  `operator`. Anything else is `400 invalid_request`.
- **Email failure.** If the invitation email can't be sent after the user was created, the function keeps the user
  and the staff row and answers `email_sent: false`, so the owner can use *Copy link* or *Resend*.
- `resend`, `link` and `cancel` apply only to a pending person: one who has never signed in. For anyone else the
  answer is `409 not_pending`.

### Errors

Added to the existing table in `docs/supabase/edge-functions.md`:

| Status | Code | When |
|---|---|---|
| 403 | `not_owner` | The caller is active staff but not an owner |
| 404 | `staff_not_found` | `resend`, `link` or `cancel` for a `user_id` with no staff row |
| 409 | `email_already_registered` | `invite` for an email that already has an account |
| 409 | `not_pending` | `resend`, `link` or `cancel` for someone who has already signed in |

`invalid_request`, `not_authenticated` and `internal_error` are as before. An unknown `action` is `invalid_request`.

### Files

```
supabase/functions/manage-staff/index.ts     handler: auth, body parsing, dispatch
supabase/functions/manage-staff/staff.ts     invite / resend / link / cancel against the admin client
supabase/functions/_shared/auth.ts           + requireOwner
supabase/functions/tests/manage-staff.*      tests (see Testing)
```

`supabase/config.toml`: register `[functions.manage-staff]` with `verify_jwt = false`, like the others (the function
checks the JWT itself).

## The Staff screen

### List

Columns: Name, Email, Role, Status, Actions. Status is a badge: **Invited**, **Active** or **Inactive**
(`status` is worked out by a pure `staffStatus(member)` in `src/data/staff-rules.ts`).

| Status | Role select | Actions |
|---|---|---|
| Invited | enabled | Resend invitation · Copy link · Revoke |
| Active | enabled | Deactivate |
| Inactive | disabled | Reactivate |

Your own row has no actions and its role select stays disabled, as today. The last active owner can't be demoted or
deactivated: the database refuses and the screen shows the existing "last owner" message.

### Invite

An **Invite** button in the page header opens a `FormSheet` with name, email and role (default Operator). On submit:

- success with `email_sent: true`: a toast "Invitation sent to {{email}}.";
- success with `email_sent: false`: the new person is in the list, and a dialog says the email couldn't be sent and
  shows the invitation link (fetched with the `link` action) with a **Copy** button;
- `email_already_registered`: shown next to the email field.

### Row actions

- **Resend invitation:** toast "Invitation sent." (or the same copy-link dialog when `email_sent` is false).
- **Copy link:** fetches the link and copies it to the clipboard with a toast; if the clipboard is unavailable the
  link dialog opens instead.
- **Revoke:** confirm dialog, then the person disappears.
- **Deactivate:** confirm dialog ("{{name}} won't be able to use 3D-Quote. Their quotes stay."); **Reactivate**
  needs no confirmation.
- A change that finds the person already signed in (`not_pending`) refreshes the list and shows the error.

### Code

- `src/data/staff.ts`: `useInviteStaff`, `useResendInvitation`, `useInvitationLink`, `useCancelInvitation`,
  `useSetStaffActive`; all but the last go through `invokeFunction('manage-staff', body)` (add `'manage-staff'` to
  `EdgeFunctionName`) and invalidate `queryKeys.staffAll`.
- `src/data/staff-rules.ts`: `staffStatus`.
- `src/data/errors.ts`: map the new function codes to `AppError` kinds and message keys.
- `src/pages/StaffPage.tsx` is split as it grows: `src/pages/staff/InviteSheet.tsx`, `StaffActions.tsx` (row
  actions and their dialogs) and `InvitationLinkDialog.tsx`.
- `StaffMember` gains `last_sign_in_at` through the regenerated types (`npm run gen:types`).

## Languages and accessibility

All texts in `it.json` and `en.json` (a test fails when the key sets differ). Row actions are buttons with the
person's name in their accessible label ("Deactivate Otto Bianchi"). Dialogs use the existing alert-dialog and sheet
components.

## Testing

- **pgTAP:** as above.
- **Deno** (`supabase/functions/tests/`, following the existing integration tests): `requireOwner` refuses an
  operator (`not_owner`) and a missing token; `invite` creates the auth user and the staff row with the right name
  and role, lower-cases the email, refuses a duplicate email (`email_already_registered`) and bad bodies
  (`invalid_request`); the email-failure path answers `email_sent: false` and keeps the user; `resend` and `link`
  work for a pending person and give `not_pending` for one who signed in; `cancel` deletes a pending person and
  refuses one who signed in; unknown action and unknown `user_id`.
- **Vitest:** `staffStatus` (Invited/Active/Inactive); page tests with `renderApp(path, { functions })` handlers:
  the invite sheet (fields, validation, success toast, `email_sent: false` link dialog, duplicate email error);
  status badges and the actions shown per status; Resend, Copy link (clipboard stubbed) and Revoke (confirmation
  needed); Deactivate (confirmation) and Reactivate update `staff.active`; the last-owner error is shown; no
  actions on your own row; operators still can't reach the page.

## Docs

- `docs/frontend/functional-analysis.md` §3.9: Deactivate / Reactivate replace Remove; statuses Active / Invited /
  Inactive; resend, copy link and cancel for invitations; name, role and language are set by the owner.
- `docs/supabase/edge-functions.md`: the `manage-staff` section and the new error codes.
- `docs/supabase/data-model.md`: `list_staff` returns `last_sign_in_at`.
- `docs/frontend/web-app.md`: a Staff section; remove "Inviting, removing and deactivating staff" from *Not done
  yet*; the redirect URL note now also covers invitations; a note that Supabase's built-in email sender only reaches
  organisation members, so custom SMTP is needed for ordinary addresses.
- This spec: status to Implemented when done.

## Out of scope

- Changing a person's email, or letting people change their own role or email;
- banning the auth user on deactivation;
- configuring custom SMTP or customising the invitation email template;
- deploying the function or applying the migration to the cloud project (done on request);
- deleting people who have signed in.

## Git

Work on `develop`, one commit per plan task.
