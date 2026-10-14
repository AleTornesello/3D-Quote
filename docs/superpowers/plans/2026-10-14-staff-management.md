# Staff Invites and Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner invite people by email, resend / copy / revoke invitations, deactivate and reactivate staff, and
see who is Invited, Active or Inactive, all from the Staff screen.

**Architecture:**
- `list_staff` also returns `last_sign_in_at`; the web app derives a status from it and `active`.
- One owner-only Edge Function, `manage-staff` (actions `invite`, `resend`, `link`, `cancel`), does what needs the
  service role. Deactivate, reactivate and role changes stay plain `staff` updates under the existing owner policy.
- The Staff page is split into small components under `src/pages/staff/`.

**Tech Stack:**
- Deno + `@supabase/supabase-js` 2.117.3 (Edge Function, tests with `deno test`), Supabase local stack with pgTAP;
- React 19, TypeScript 6, TanStack Query 5, react-hook-form + zod 4, react-i18next, sonner;
- Vitest 5 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-14-staff-management-design.md`

## Global Constraints

- Work on branch `develop`, one commit per task. Never push, merge to `main`, deploy the function, or apply
  migrations to the cloud Supabase project (that happens only when the user asks, through the Supabase MCP).
- Run npm only from the repo root (`C:\Progetti\3D-Quote`), with `--workspace @3d-quote/web` where a workspace is
  needed. Never run npm in a folder without a `package.json`.
- Removing people = **Deactivate / Reactivate** (`staff.active`). No hard delete of anyone who has signed in. The
  auth user is not banned.
- Status: not active → `inactive`; active and `last_sign_in_at` null → `invited`; otherwise `active`.
- `manage-staff` is owner only (`403 not_owner` for other staff, `403 not_staff` for inactive / no staff row).
  Body `{ action, ... }`; invite answers `201 { user_id, email_sent }`, resend `200 { email_sent }`, link
  `200 { link }`, cancel `200 {}`. Error codes: `invalid_request` 400, `not_authenticated` 401, `not_staff` 403,
  `not_owner` 403, `staff_not_found` 404, `email_already_registered` 409, `not_pending` 409, `internal_error` 500.
- `email` is trimmed and lower-cased; `display_name` trimmed and non-empty; `role` is `owner` or `operator`; the new
  person's language is `it`.
- Invitation and copied links open `<origin>/account?reset=1` (`<origin>` from the request's `Origin` header; omit
  `redirectTo` when it is missing or invalid so Supabase falls back to the Site URL).
- If the invitation email can't be sent, the person and staff row are kept and the answer has `email_sent: false`.
- `resend`, `link` and `cancel` apply only to a pending person (never signed in): others get `409 not_pending`.
- UI wording: the row action / dialog that deletes a pending invitation says **Revoke invitation** (not "Cancel", which
  would clash with the dialogs' Cancel button); the function action stays `cancel`.
- Your own row has no actions; its role select is disabled. The last active owner can't be demoted or deactivated
  (the database refuses with `last_owner`).
- Texts go in both `it.json` and `en.json` (a test fails when the key sets differ). Tests run in Italian.
- Docs in English. Code style: no semicolons, single quotes, `@/` imports, 100-column Prettier; Deno files follow
  `supabase/functions/deno.json` (no semicolons, single quotes, width 100).

## Review Focus

Inputs and conditions the spec implies but the obvious tests might miss; each has a test in the task named.

- An email typed with capitals or spaces (`  Dora@Example.COM `) → stored trimmed and lower-cased; two invites that
  differ only by case don't create two accounts (Task 3, Task 4, Task 7 sends the trimmed value).
- Inviting an email that already belongs to an active person or to a pending invitation → `email_already_registered`,
  no second staff row, and no auth user deleted (Task 3, Task 4; shown next to the email field in Task 7).
- The invitation email can't be sent → the person exists, `email_sent: false`, and the owner is offered the link
  (Task 3, Task 7).
- Resend / link / cancel for someone who has already signed in, or for an unknown id → `not_pending` / `staff_not_found`,
  and the list refreshes (Task 3, Task 4, Task 7).
- Deactivating the last active owner, or yourself → refused with a message / no button (Task 6).
- An operator calling `manage-staff` directly, and an inactive owner → refused (Task 2, Task 4).
- The clipboard is unavailable when copying the link → the link dialog opens instead of failing silently (Task 7).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `supabase/schemas/01_staff.sql` | modify | `list_staff` returns `last_sign_in_at` |
| `supabase/migrations/<ts>_staff_last_sign_in.sql`, `<ts>_staff_last_sign_in_setup.sql` | create | drop/recreate `list_staff`; re-grant execute |
| `supabase/tests/database/10_list_staff.test.sql` | modify | the new column |
| `supabase/functions/_shared/auth.ts` | modify | `requireOwner` |
| `supabase/functions/_shared/http.ts` | modify | `readJsonObject` |
| `supabase/functions/manage-staff/staff.ts` | create | the four actions against the admin client |
| `supabase/functions/manage-staff/index.ts` | create | handler: auth, body, dispatch |
| `supabase/functions/tests/*` | modify / create | unit and integration tests |
| `supabase/config.toml` | modify | register the function |
| `apps/web/src/data/{edge-functions,errors,staff}.ts`, `staff-rules.ts` | modify / create | function name, error mapping, hooks, `staffStatus` |
| `apps/web/src/pages/StaffPage.tsx`, `pages/staff/*` | modify / create | list, actions, invite sheet, link dialog |
| `apps/web/src/i18n/locales/{it,en}.json` | modify | texts |
| `docs/**` | modify | see Task 8 |

---

### Task 1: `list_staff` returns `last_sign_in_at`

**Files:**
- Modify: `supabase/schemas/01_staff.sql`
- Create: `supabase/migrations/<ts>_staff_last_sign_in.sql` (generated, then edited), `supabase/migrations/<ts>_staff_last_sign_in_setup.sql`
- Modify: `supabase/tests/database/10_list_staff.test.sql`
- Regenerate: `apps/web/src/lib/database.types.ts`
- Modify: `docs/supabase/data-model.md`

**Interfaces:**
- Produces: `public.list_staff()` returns
  `(user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamptz, last_sign_in_at timestamptz)`;
  generated `StaffMember` gains `last_sign_in_at: string | null`.

The local stack must be running (`supabase start`). Docker Desktop may need starting first.

- [ ] **Step 1: Write the failing pgTAP checks**

In `supabase/tests/database/10_list_staff.test.sql`:

1. Change `select plan(8);` to `select plan(10);`.
2. Replace the `insert into auth.users` statement with:

```sql
insert into auth.users (id, email, last_sign_in_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'owner.ls@test.local', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'operator.ls@test.local', null),
  ('00000000-0000-4000-8000-0000000000b3', 'outsider.ls@test.local', null),
  ('00000000-0000-4000-8000-0000000000b4', 'inactive.ls@test.local', null);
```

3. After the `'rows are ordered by display name'` test (still in the owner section) add:

```sql
select is(
  (select last_sign_in_at is not null from public.list_staff() where user_id = '00000000-0000-4000-8000-0000000000b1'),
  true,
  'a person who has signed in has a last sign-in time'
);
select is(
  (select last_sign_in_at from public.list_staff() where user_id = '00000000-0000-4000-8000-0000000000b2'),
  null::timestamptz,
  'a person who never signed in has none'
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db supabase/tests/database/10_list_staff.test.sql`
Expected: FAIL (`column "last_sign_in_at" does not exist`).

- [ ] **Step 3: Declare the new column**

In `supabase/schemas/01_staff.sql`, replace both `list_staff` functions (from `create or replace function private.list_staff()`
to the end of the file) with:

```sql
-- The staff list with login emails and last sign-in, for the owner's Staff screen. auth.users isn't exposed through
-- the API.
create or replace function private.list_staff()
returns table (
  user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_owner() then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  return query
  select s.user_id, s.display_name, u.email::text, s.role, s.language, s.active, s.created_at, u.last_sign_in_at
  from public.staff s
  join auth.users u on u.id = s.user_id
  order by s.display_name, s.user_id;
end;
$$;

create or replace function public.list_staff()
returns table (
  user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_staff();
$$;
```

(Keep whatever comment text precedes the functions in the file; the point is the new column in both signatures and
the `select`.)

- [ ] **Step 4: Generate the migration and write the setup migration**

Run: `supabase db diff -f staff_last_sign_in`

The generated file must contain `drop function` for both `list_staff` functions and `create function` for both with
the new column. It will also contain the known, unrelated `quotes_list` noise (`drop view` / `create or replace view`
for `public.quotes_list`: migra loses the view's `security_invoker`). **Delete that noise by hand** and keep only the
two `list_staff` drops and creates. Order: drop `public.list_staff()` first, then `private.list_staff()`; create
`private.list_staff()` first, then `public.list_staff()`.

Run: `supabase migration new staff_last_sign_in_setup` and put this in the created file (dropping a function drops its
grants, and function grants are not captured by the diff):

```sql
-- Function privileges are not captured by the generated migration; list_staff was dropped and recreated.
revoke execute on function public.list_staff(), private.list_staff() from public, anon;
grant execute on function public.list_staff(), private.list_staff() to authenticated;
```

- [ ] **Step 5: Rebuild and run the tests**

Run: `supabase db reset` then `supabase test db`
Expected: all 14 files pass, including `10_list_staff.test.sql` (10 tests).

- [ ] **Step 6: Regenerate the web types**

Run: `npm run gen:types` (repo root). Expected: `Functions.list_staff.Returns` gains `last_sign_in_at: string | null`.
Then `npm run check:types-fresh`, `npm run build` and `npm test` pass. In `apps/web/src/pages/StaffPage.test.tsx` the
`member(...)` helper builds rows by hand; it is updated in Task 6, so if `build` complains about it, add
`last_sign_in_at: '2026-01-02T09:00:00Z',` to that helper now.

- [ ] **Step 7: Document and commit**

In `docs/supabase/data-model.md`, find the `list_staff` row (`grep -n "list_staff" docs/supabase/data-model.md`) and add
`last_sign_in_at` to the columns it returns, noting it is `auth.users.last_sign_in_at` (null = never signed in, which
the app shows as Invited).

```bash
git add supabase docs/supabase apps/web
git commit -m "feat(db): list_staff also returns the last sign-in time"
```

---

### Task 2: `requireOwner` and `readJsonObject`

**Files:**
- Modify: `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/http.ts`
- Modify: `supabase/functions/tests/auth.test.ts`, `supabase/functions/tests/http.test.ts`

**Interfaces:**
- Produces:
  - `requireOwner(req: Request, admin: SupabaseClient): Promise<string>`: the caller's user id; throws `HttpError(401, 'not_authenticated')`, `HttpError(403, 'not_staff')` or `HttpError(403, 'not_owner')`.
  - `readJsonObject(req: Request): Promise<Record<string, unknown>>`: throws `HttpError(400, 'invalid_request')` for a body that is not a JSON object.

Deno tests run with `npm run functions:test` (needs the local stack for the integration tests only; run a single unit
file with `deno test --config supabase/functions/deno.json supabase/functions/tests/auth.test.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/tests/auth.test.ts` (it already imports `assertEquals`, `assertRejects`, `requireStaff`,
`HttpError`, `AuthApiError`, `SupabaseClient`, and defines `USER_ID` and `request`). Add `requireOwner` to the import
from `'../_shared/auth.ts'`, then:

```ts
/** An admin client for a signed-in user whose staff row is `staff` (null = no row). */
function adminWithStaff(staff: { active: boolean; role: string } | null): SupabaseClient {
  const staffQuery = {
    select: () => staffQuery,
    eq: () => staffQuery,
    maybeSingle: () => Promise.resolve({ data: staff, error: null }),
  }
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: () => staffQuery,
  } as unknown as SupabaseClient
}

Deno.test('requireOwner accepts an active owner', async () => {
  const id = await requireOwner(request, adminWithStaff({ active: true, role: 'owner' }))
  assertEquals(id, USER_ID)
})

Deno.test('requireOwner refuses an operator with not_owner', async () => {
  const error = await assertRejects(
    () => requireOwner(request, adminWithStaff({ active: true, role: 'operator' })),
    HttpError,
  )
  assertEquals([error.status, error.code], [403, 'not_owner'])
})

Deno.test('requireOwner refuses an inactive owner with not_staff', async () => {
  const error = await assertRejects(
    () => requireOwner(request, adminWithStaff({ active: false, role: 'owner' })),
    HttpError,
  )
  assertEquals([error.status, error.code], [403, 'not_staff'])
})

Deno.test('requireOwner refuses a user without a staff row with not_staff', async () => {
  const error = await assertRejects(() => requireOwner(request, adminWithStaff(null)), HttpError)
  assertEquals([error.status, error.code], [403, 'not_staff'])
})

Deno.test('requireOwner refuses a request without a token', async () => {
  const error = await assertRejects(
    () =>
      requireOwner(
        new Request('http://localhost/functions/v1/test', { method: 'POST' }),
        adminWithStaff({ active: true, role: 'owner' }),
      ),
    HttpError,
  )
  assertEquals([error.status, error.code], [401, 'not_authenticated'])
})
```

Append to `supabase/functions/tests/http.test.ts` (add `readJsonObject` to its import from `'../_shared/http.ts'`;
the file already imports `assertEquals`/`assertRejects` and `HttpError`, otherwise add them):

```ts
const post = (body: string) => new Request('http://localhost/f', { method: 'POST', body })

Deno.test('readJsonObject returns a JSON object', async () => {
  assertEquals(await readJsonObject(post('{"action":"invite","n":1}')), { action: 'invite', n: 1 })
})

Deno.test('readJsonObject refuses anything that is not a JSON object', async () => {
  for (const body of ['', 'not json', '[1,2]', '"text"', '42', 'null']) {
    const error = await assertRejects(() => readJsonObject(post(body)), HttpError)
    assertEquals([error.status, error.code], [400, 'invalid_request'])
  }
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `deno test --config supabase/functions/deno.json supabase/functions/tests/auth.test.ts supabase/functions/tests/http.test.ts`
Expected: FAIL (`requireOwner` / `readJsonObject` is not exported).

- [ ] **Step 3: Implement**

Replace `supabase/functions/_shared/auth.ts` with:

```ts
import { isAuthApiError, type SupabaseClient } from './supabase.ts'
import { HttpError } from './http.ts'

/** The caller's user id and staff role, if the bearer token is a valid session of an active staff member. */
async function authenticate(
  req: Request,
  admin: SupabaseClient,
): Promise<{ id: string; role: string | undefined }> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'not_authenticated')

  const { data, error } = await admin.auth.getUser(token)
  if (error) {
    // Only Auth's verdict on the token means "not authenticated". An outage or a rate limit surfaces as a 500, so
    // the web app doesn't sign the user out over it.
    if (isAuthApiError(error) && [400, 401, 403, 404].includes(error.status)) {
      throw new HttpError(401, 'not_authenticated')
    }
    throw error
  }
  if (!data.user) throw new HttpError(401, 'not_authenticated')

  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('active, role')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (staffError) throw staffError
  if (!staff?.active) throw new HttpError(403, 'not_staff')
  return { id: data.user.id, role: staff.role }
}

/** The caller's user id, if the bearer token is a valid session of an active staff member. */
export async function requireStaff(req: Request, admin: SupabaseClient): Promise<string> {
  return (await authenticate(req, admin)).id
}

/** Like requireStaff, and the caller must be an owner. */
export async function requireOwner(req: Request, admin: SupabaseClient): Promise<string> {
  const { id, role } = await authenticate(req, admin)
  if (role !== 'owner') throw new HttpError(403, 'not_owner')
  return id
}
```

Append to `supabase/functions/_shared/http.ts`:

```ts
/** The request body as a JSON object; anything else is `invalid_request`. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, 'invalid_request')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_request')
  }
  return body as Record<string, unknown>
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `deno test --config supabase/functions/deno.json supabase/functions/tests/auth.test.ts supabase/functions/tests/http.test.ts`
Expected: PASS (the existing `requireStaff` tests still pass: their fake returns a staff row without a role).

- [ ] **Step 5: Check and commit**

Run: `npm run functions:check` (Expected: no errors; if `deno fmt --check` complains, run
`deno fmt --config supabase/functions/deno.json supabase/functions`).

```bash
git add supabase/functions
git commit -m "feat(functions): requireOwner and readJsonObject"
```

---

### Task 3: The staff actions (`staff.ts`) with unit tests

**Files:**
- Create: `supabase/functions/manage-staff/staff.ts`, `supabase/functions/tests/manage-staff.test.ts`

**Interfaces:**
- Consumes: `HttpError` (`../_shared/http.ts`), `SupabaseClient`, `isAuthApiError` (`../_shared/supabase.ts`).
- Produces (all from `manage-staff/staff.ts`):
  - `type StaffRole = 'owner' | 'operator'`
  - `type InviteInput = { email: string; display_name: string; role: StaffRole }`
  - `parseInvite(body: Record<string, unknown>): InviteInput` (throws `HttpError(400, 'invalid_request')`)
  - `parseUserId(body: Record<string, unknown>): string` (a UUID string, else `HttpError(400, 'invalid_request')`)
  - `inviteStaff(admin, input: InviteInput, redirectTo: string | undefined): Promise<{ user_id: string; email_sent: boolean }>`
  - `resendInvitation(admin, userId: string, redirectTo: string | undefined): Promise<{ email_sent: boolean }>`
  - `invitationLink(admin, userId: string, redirectTo: string | undefined): Promise<{ link: string }>`
  - `cancelInvitation(admin, userId: string): Promise<void>`

Design notes the code below relies on (confirm them in Task 4's integration tests against the real GoTrue, and adapt
the code if a call behaves differently):
- `auth.admin.generateLink({ type: 'invite', ... })` creates an unconfirmed (invited) user and returns its
  `properties.action_link` **without sending any email**; for a confirmed existing user it fails with `email_exists`.
- `auth.admin.inviteUserByEmail(email, { redirectTo })` sends the invitation email (and re-sends it to a user who has
  not confirmed yet).
- A pending person is one whose auth user has `last_sign_in_at` null.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/tests/manage-staff.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from './deps.ts'
import { HttpError } from '../_shared/http.ts'
import { AuthApiError, type SupabaseClient } from '../_shared/supabase.ts'
import {
  cancelInvitation,
  invitationLink,
  inviteStaff,
  parseInvite,
  parseUserId,
  resendInvitation,
} from '../manage-staff/staff.ts'

const USER_ID = '00000000-0000-4000-8000-0000000000c1'

interface Calls {
  generateLink: unknown[]
  invite: unknown[]
  inserts: unknown[]
  deleted: string[]
}

/** A scripted admin client. `staff` is the staff row lookup result; `lastSignIn` the auth user's last sign-in. */
function fakeAdmin(
  options: {
    generateError?: Error
    inviteError?: Error
    insertError?: { code: string; message: string }
    staff?: { user_id: string } | null
    lastSignIn?: string | null
    getUserError?: Error
  } = {},
) {
  const calls: Calls = { generateLink: [], invite: [], inserts: [], deleted: [] }
  const staffQuery = {
    select: () => staffQuery,
    eq: () => staffQuery,
    maybeSingle: () =>
      Promise.resolve({
        data: options.staff === undefined ? { user_id: USER_ID } : options.staff,
        error: null,
      }),
  }
  const admin = {
    auth: {
      admin: {
        generateLink: (args: unknown) => {
          calls.generateLink.push(args)
          return Promise.resolve(
            options.generateError
              ? { data: null, error: options.generateError }
              : {
                data: {
                  user: { id: USER_ID },
                  properties: { action_link: 'https://auth.test/verify?token=abc' },
                },
                error: null,
              },
          )
        },
        inviteUserByEmail: (email: string, opts: unknown) => {
          calls.invite.push([email, opts])
          return Promise.resolve({ data: null, error: options.inviteError ?? null })
        },
        getUserById: () =>
          Promise.resolve(
            options.getUserError
              ? { data: { user: null }, error: options.getUserError }
              : {
                data: {
                  user: {
                    id: USER_ID,
                    email: 'pending@example.com',
                    last_sign_in_at: options.lastSignIn ?? null,
                  },
                },
                error: null,
              },
          ),
        deleteUser: (id: string) => {
          calls.deleted.push(id)
          return Promise.resolve({ data: null, error: null })
        },
      },
    },
    from: (table: string) => {
      assertEquals(table, 'staff')
      return {
        ...staffQuery,
        insert: (row: unknown) => {
          calls.inserts.push(row)
          return Promise.resolve({ error: options.insertError ?? null })
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, calls }
}

const input = { email: 'dora@example.com', display_name: 'Dora Bianchi', role: 'operator' as const }

Deno.test('parseInvite trims, lower-cases the email and accepts both roles', () => {
  assertEquals(
    parseInvite({ email: '  Dora@Example.COM ', display_name: '  Dora Bianchi ', role: 'owner' }),
    { email: 'dora@example.com', display_name: 'Dora Bianchi', role: 'owner' },
  )
})

Deno.test('parseInvite refuses bad input', () => {
  const good = { email: 'dora@example.com', display_name: 'Dora', role: 'operator' }
  const bad: Record<string, unknown>[] = [
    { ...good, email: 'not-an-email' },
    { ...good, email: '' },
    { ...good, email: 42 },
    { ...good, display_name: '   ' },
    { ...good, display_name: undefined },
    { ...good, role: 'admin' },
    { ...good, role: undefined },
  ]
  for (const body of bad) {
    try {
      parseInvite(body)
      throw new Error(`accepted ${JSON.stringify(body)}`)
    } catch (error) {
      assert(error instanceof HttpError, String(error))
      assertEquals([error.status, error.code], [400, 'invalid_request'])
    }
  }
})

Deno.test('parseUserId accepts a UUID and refuses anything else', () => {
  assertEquals(parseUserId({ user_id: USER_ID }), USER_ID)
  for (const value of [undefined, 42, '', 'abc', "x'; drop table staff;--"]) {
    try {
      parseUserId({ user_id: value })
      throw new Error(`accepted ${String(value)}`)
    } catch (error) {
      assert(error instanceof HttpError, String(error))
      assertEquals(error.code, 'invalid_request')
    }
  }
})

Deno.test('inviteStaff creates the user without email, inserts the staff row, then sends the email', async () => {
  const { admin, calls } = fakeAdmin()
  const result = await inviteStaff(admin, input, 'http://localhost:5173/account?reset=1')
  assertEquals(result, { user_id: USER_ID, email_sent: true })
  assertEquals(calls.generateLink, [{
    type: 'invite',
    email: 'dora@example.com',
    options: {
      redirectTo: 'http://localhost:5173/account?reset=1',
      data: { display_name: 'Dora Bianchi' },
    },
  }])
  assertEquals(calls.inserts, [
    { user_id: USER_ID, display_name: 'Dora Bianchi', role: 'operator', language: 'it' },
  ])
  assertEquals(calls.invite, [[
    'dora@example.com',
    { redirectTo: 'http://localhost:5173/account?reset=1' },
  ]])
})

Deno.test('inviteStaff keeps the person and says email_sent false when the email fails', async () => {
  const { admin, calls } = fakeAdmin({ inviteError: new Error('smtp down') })
  const result = await inviteStaff(admin, input, undefined)
  assertEquals(result, { user_id: USER_ID, email_sent: false })
  assertEquals(calls.inserts.length, 1)
  assertEquals(calls.deleted, [])
})

Deno.test('inviteStaff refuses an email that already has an account', async () => {
  const taken = new AuthApiError('exists', 422, 'email_exists')
  const { admin, calls } = fakeAdmin({ generateError: taken })
  const error = await assertRejects(() => inviteStaff(admin, input, undefined), HttpError)
  assertEquals([error.status, error.code], [409, 'email_already_registered'])
  assertEquals(calls.inserts, [])
})

Deno.test('inviteStaff refuses an email that already has a staff row and deletes nothing', async () => {
  const { admin, calls } = fakeAdmin({ insertError: { code: '23505', message: 'duplicate key' } })
  const error = await assertRejects(() => inviteStaff(admin, input, undefined), HttpError)
  assertEquals([error.status, error.code], [409, 'email_already_registered'])
  assertEquals(calls.deleted, [])
  assertEquals(calls.invite, [])
})

Deno.test('inviteStaff passes other failures on', async () => {
  const { admin } = fakeAdmin({ insertError: { code: '57014', message: 'timeout' } })
  await assertRejects(() => inviteStaff(admin, input, undefined))
})

Deno.test('resendInvitation emails a pending person again', async () => {
  const { admin, calls } = fakeAdmin()
  assertEquals(await resendInvitation(admin, USER_ID, 'http://x/account?reset=1'), {
    email_sent: true,
  })
  assertEquals(calls.invite, [['pending@example.com', { redirectTo: 'http://x/account?reset=1' }]])
})

Deno.test('resendInvitation reports a failed email', async () => {
  const { admin } = fakeAdmin({ inviteError: new Error('smtp down') })
  assertEquals(await resendInvitation(admin, USER_ID, undefined), { email_sent: false })
})

Deno.test('invitationLink returns the action link of a pending person', async () => {
  const { admin, calls } = fakeAdmin()
  assertEquals(await invitationLink(admin, USER_ID, 'http://x/account?reset=1'), {
    link: 'https://auth.test/verify?token=abc',
  })
  assertEquals(calls.generateLink, [{
    type: 'invite',
    email: 'pending@example.com',
    options: { redirectTo: 'http://x/account?reset=1' },
  }])
})

Deno.test('resend, link and cancel refuse someone who has signed in', async () => {
  const { admin } = fakeAdmin({ lastSignIn: '2026-10-01T10:00:00Z' })
  for (
    const run of [
      () => resendInvitation(admin, USER_ID, undefined),
      () => invitationLink(admin, USER_ID, undefined),
      () => cancelInvitation(admin, USER_ID),
    ]
  ) {
    const error = await assertRejects(run, HttpError)
    assertEquals([error.status, error.code], [409, 'not_pending'])
  }
})

Deno.test('resend, link and cancel refuse an unknown id', async () => {
  const { admin } = fakeAdmin({ staff: null })
  for (
    const run of [
      () => resendInvitation(admin, USER_ID, undefined),
      () => invitationLink(admin, USER_ID, undefined),
      () => cancelInvitation(admin, USER_ID),
    ]
  ) {
    const error = await assertRejects(run, HttpError)
    assertEquals([error.status, error.code], [404, 'staff_not_found'])
  }
})

Deno.test('cancelInvitation deletes a pending person', async () => {
  const { admin, calls } = fakeAdmin()
  await cancelInvitation(admin, USER_ID)
  assertEquals(calls.deleted, [USER_ID])
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `deno test --config supabase/functions/deno.json supabase/functions/tests/manage-staff.test.ts`
Expected: FAIL (module `../manage-staff/staff.ts` not found).

- [ ] **Step 3: Implement**

Create `supabase/functions/manage-staff/staff.ts`:

```ts
import { HttpError } from '../_shared/http.ts'
import { isAuthApiError, type SupabaseClient } from '../_shared/supabase.ts'

export type StaffRole = 'owner' | 'operator'
export type InviteInput = { email: string; display_name: string; role: StaffRole }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseInvite(body: Record<string, unknown>): InviteInput {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  const role = body.role
  if (!EMAIL.test(email) || displayName === '' || (role !== 'owner' && role !== 'operator')) {
    throw new HttpError(400, 'invalid_request')
  }
  return { email, display_name: displayName, role }
}

export function parseUserId(body: Record<string, unknown>): string {
  const id = body.user_id
  if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(400, 'invalid_request')
  return id
}

/** Sends the invitation email; a failure is reported, not thrown, so the owner can fall back to the link. */
async function sendInvitation(
  admin: SupabaseClient,
  email: string,
  redirectTo: string | undefined,
): Promise<boolean> {
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (error) {
    console.error('The invitation email could not be sent', error)
    return false
  }
  return true
}

/**
 * Creates the login (invited, no email yet) and the staff row, then sends the email. An email that already has a
 * confirmed account, or a staff row, is refused. Nothing is deleted on failure: a login left without a staff row is
 * harmless and is reused by the next invite.
 */
export async function inviteStaff(
  admin: SupabaseClient,
  input: InviteInput,
  redirectTo: string | undefined,
): Promise<{ user_id: string; email_sent: boolean }> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { redirectTo, data: { display_name: input.display_name } },
  })
  if (error) {
    if (isAuthApiError(error) && (error.code === 'email_exists' || error.status === 422)) {
      throw new HttpError(409, 'email_already_registered')
    }
    throw error
  }
  const userId = data.user.id
  const { error: insertError } = await admin.from('staff').insert({
    user_id: userId,
    display_name: input.display_name,
    role: input.role,
    language: 'it',
  })
  if (insertError) {
    if (insertError.code === '23505') throw new HttpError(409, 'email_already_registered')
    throw insertError
  }
  return { user_id: userId, email_sent: await sendInvitation(admin, input.email, redirectTo) }
}

/** The email of a person who has a staff row and has never signed in. */
async function requirePending(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: staff, error } = await admin
    .from('staff')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!staff) throw new HttpError(404, 'staff_not_found')

  const { data, error: userError } = await admin.auth.admin.getUserById(userId)
  if (userError) {
    if (isAuthApiError(userError) && userError.status === 404) {
      throw new HttpError(404, 'staff_not_found')
    }
    throw userError
  }
  if (data.user.last_sign_in_at) throw new HttpError(409, 'not_pending')
  return data.user.email as string
}

export async function resendInvitation(
  admin: SupabaseClient,
  userId: string,
  redirectTo: string | undefined,
): Promise<{ email_sent: boolean }> {
  const email = await requirePending(admin, userId)
  return { email_sent: await sendInvitation(admin, email, redirectTo) }
}

/** A link that opens the app signed in so the person can set a password; sends nothing. */
export async function invitationLink(
  admin: SupabaseClient,
  userId: string,
  redirectTo: string | undefined,
): Promise<{ link: string }> {
  const email = await requirePending(admin, userId)
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })
  if (error) throw error
  return { link: data.properties.action_link }
}

/** Deletes a pending login; its staff row goes with it (on delete cascade). */
export async function cancelInvitation(admin: SupabaseClient, userId: string): Promise<void> {
  await requirePending(admin, userId)
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw error
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `deno test --config supabase/functions/deno.json supabase/functions/tests/manage-staff.test.ts`
Expected: PASS. If `deno check` reports a type problem with the fake or with `generateLink`'s return type (its `data`
is a union over link types), fix the code with the narrowest cast; do not change what the tests assert.

- [ ] **Step 5: Check and commit**

Run: `npm run functions:check` (fix formatting with `deno fmt --config supabase/functions/deno.json supabase/functions`).

```bash
git add supabase/functions
git commit -m "feat(functions): staff invitation actions with unit tests"
```

---

### Task 4: The `manage-staff` handler, registration, integration tests and function docs

**Files:**
- Create: `supabase/functions/manage-staff/index.ts`, `supabase/functions/tests/manage-staff.integration.test.ts`
- Modify: `supabase/config.toml`, `supabase/functions/tests/helpers.ts`, `docs/supabase/edge-functions.md`

**Interfaces:**
- Consumes: everything produced in Tasks 2 and 3.
- Produces: `POST /functions/v1/manage-staff` as specified in Global Constraints.

- [ ] **Step 1: Write the handler**

Create `supabase/functions/manage-staff/index.ts`:

```ts
// POST { action, ... } → invite / resend / link / cancel. See docs/supabase/edge-functions.md.
import { requireOwner } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/clients.ts'
import { createHandler, HttpError, json, readJsonObject } from '../_shared/http.ts'
import {
  cancelInvitation,
  invitationLink,
  inviteStaff,
  parseInvite,
  parseUserId,
  resendInvitation,
} from './staff.ts'

/** `<origin>/account?reset=1` from the request's Origin header; undefined lets Supabase use its Site URL. */
function redirectUrl(req: Request): string | undefined {
  const origin = req.headers.get('Origin')
  if (!origin) return undefined
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return `${url.origin}/account?reset=1`
  } catch {
    return undefined
  }
}

Deno.serve(createHandler(async (req) => {
  const admin = serviceClient()
  await requireOwner(req, admin)
  const body = await readJsonObject(req)
  const redirectTo = redirectUrl(req)

  switch (body.action) {
    case 'invite':
      return json(201, await inviteStaff(admin, parseInvite(body), redirectTo))
    case 'resend':
      return json(200, await resendInvitation(admin, parseUserId(body), redirectTo))
    case 'link':
      return json(200, await invitationLink(admin, parseUserId(body), redirectTo))
    case 'cancel':
      await cancelInvitation(admin, parseUserId(body))
      return json(200, {})
    default:
      throw new HttpError(400, 'invalid_request')
  }
}))
```

In `supabase/config.toml`, after `[functions.duplicate-quote]` add:

```toml
[functions.manage-staff]
verify_jwt = false
```

In `supabase/functions/tests/helpers.ts`, widen `FunctionResponse.body` to
`{ code?: string; priced?: number; skipped?: number; quote_id?: number; user_id?: string; email_sent?: boolean; link?: string }`.

- [ ] **Step 2: Write the integration tests**

Create `supabase/functions/tests/manage-staff.integration.test.ts` (they run against the local stack and its functions
runtime; see `docs/supabase/edge-functions.md` → local testing for how the runtime is served):

```ts
import { assert, assertEquals, assertMatch } from './deps.ts'
import {
  adminClient,
  callFunction,
  must,
  OPERATOR_EMAIL,
  OPERATOR_ID,
  OWNER_EMAIL,
  OWNER_ID,
  preflight,
  signIn,
} from './helpers.ts'
import type { SupabaseClient } from '../_shared/supabase.ts'

const FN = 'manage-staff'
const unique = () => crypto.randomUUID().slice(0, 8)

/** Deletes the login (and with it the staff row) of a test invitation. */
async function cleanup(admin: SupabaseClient, userId: string | undefined) {
  if (userId) await admin.auth.admin.deleteUser(userId)
}

async function staffRow(admin: SupabaseClient, userId: string) {
  return await must<{ display_name: string; role: string; language: string; active: boolean } | null>(
    admin.from('staff').select('display_name, role, language, active').eq('user_id', userId)
      .maybeSingle(),
  )
}

Deno.test('manage-staff answers the CORS preflight', async () => {
  const response = await preflight(FN)
  assertEquals(response.status, 200)
})

Deno.test('manage-staff needs a signed-in owner', async () => {
  const anonymous = await callFunction(FN, { action: 'invite' })
  assertEquals([anonymous.status, anonymous.body.code], [401, 'not_authenticated'])

  const operator = await callFunction(FN, { action: 'invite' }, await signIn(OPERATOR_EMAIL))
  assertEquals([operator.status, operator.body.code], [403, 'not_owner'])
})

Deno.test('manage-staff refuses bad bodies and unknown actions', async () => {
  const token = await signIn(OWNER_EMAIL)
  for (
    const body of [
      '{not json',
      '[]',
      { action: 'explode' },
      { action: 'invite', email: 'nope', display_name: 'X', role: 'operator' },
      { action: 'invite', email: 'a@example.test', display_name: ' ', role: 'operator' },
      { action: 'invite', email: 'a@example.test', display_name: 'X', role: 'admin' },
      { action: 'resend' },
      { action: 'link', user_id: 'not-a-uuid' },
      { action: 'cancel', user_id: 42 },
    ]
  ) {
    const response = await callFunction(FN, body, token)
    assertEquals([response.status, response.body.code], [400, 'invalid_request'], JSON.stringify(body))
  }
})

Deno.test('invite creates a pending person; link, resend and cancel work on them', async () => {
  const admin = await adminClient()
  const token = await signIn(OWNER_EMAIL)
  const email = `itest-${unique()}@example.test`
  let userId: string | undefined
  try {
    const invited = await callFunction(
      FN,
      { action: 'invite', email: `  ${email.toUpperCase()} `, display_name: ' Dora Itest ', role: 'operator' },
      token,
    )
    assertEquals(invited.status, 201)
    userId = invited.body.user_id
    assert(userId)
    assertEquals(typeof invited.body.email_sent, 'boolean')

    assertEquals(await staffRow(admin, userId), {
      display_name: 'Dora Itest',
      role: 'operator',
      language: 'it',
      active: true,
    })
    const { data } = await admin.auth.admin.getUserById(userId)
    assertEquals(data.user?.email, email)
    assertEquals(data.user?.last_sign_in_at ?? null, null)

    const link = await callFunction(FN, { action: 'link', user_id: userId }, token)
    assertEquals(link.status, 200)
    assertMatch(link.body.link ?? '', /^https?:\/\/.+\/verify\?/)

    const resent = await callFunction(FN, { action: 'resend', user_id: userId }, token)
    assertEquals(resent.status, 200)
    assertEquals(typeof resent.body.email_sent, 'boolean')

    const again = await callFunction(
      FN,
      { action: 'invite', email, display_name: 'Dora Again', role: 'owner' },
      token,
    )
    assertEquals([again.status, again.body.code], [409, 'email_already_registered'])
    assertEquals((await staffRow(admin, userId))?.display_name, 'Dora Itest')

    const cancelled = await callFunction(FN, { action: 'cancel', user_id: userId }, token)
    assertEquals(cancelled.status, 200)
    assertEquals(await staffRow(admin, userId), null)
    const gone = await admin.auth.admin.getUserById(userId)
    assert(gone.error || !gone.data.user)
    userId = undefined
  } finally {
    await cleanup(admin, userId)
  }
})

Deno.test('inviting someone who already has an account is refused', async () => {
  const token = await signIn(OWNER_EMAIL)
  const response = await callFunction(
    FN,
    { action: 'invite', email: OPERATOR_EMAIL, display_name: 'Copy', role: 'operator' },
    token,
  )
  assertEquals([response.status, response.body.code], [409, 'email_already_registered'])
})

Deno.test('resend, link and cancel refuse someone who has signed in, and unknown ids', async () => {
  const token = await signIn(OWNER_EMAIL)
  await signIn(OPERATOR_EMAIL) // the operator has now signed in
  for (const action of ['resend', 'link', 'cancel']) {
    const signedIn = await callFunction(FN, { action, user_id: OPERATOR_ID }, token)
    assertEquals([signedIn.status, signedIn.body.code], [409, 'not_pending'], action)
    const unknown = await callFunction(
      FN,
      { action, user_id: '00000000-0000-4000-8000-00000000dead' },
      token,
    )
    assertEquals([unknown.status, unknown.body.code], [404, 'staff_not_found'], action)
  }
  assertEquals((await staffRow(await adminClient(), OWNER_ID))?.active, true)
})
```

- [ ] **Step 3: Run the tests**

Run: `npm run functions:check`, then (local stack running and the functions runtime serving)
`npm run functions:test`.
Expected: all pass. This is where the GoTrue behaviours assumed in Task 3 are confirmed. If one differs, adapt
`staff.ts` and its unit tests together, keeping the contract in Global Constraints:
- if `generateLink({ type: 'invite' })` is refused for an existing *pending* user, `invitationLink` may use
  `type: 'recovery'` instead (and the test for it is unchanged);
- if `inviteUserByEmail` is refused for an existing pending user, `resend` is `email_sent: false` + the link path;
- if the returned `action_link` does not carry the `redirect_to` of `<origin>/account?reset=1` locally, add
  `http://localhost:5173/account**` to `additional_redirect_urls` in `supabase/config.toml` (and note it in Task 8's
  docs).
Report any such adaptation in your task report.

- [ ] **Step 4: Document the function**

In `docs/supabase/edge-functions.md`:
1. Add the new codes to the error table: `403 not_owner` (active staff but not an owner), `404 staff_not_found`
   (`resend`, `link` or `cancel` for an id with no staff row), `409 email_already_registered` (`invite` for an email
   that already has an account), `409 not_pending` (`resend`, `link` or `cancel` for someone who has already signed
   in).
2. After the `duplicate-quote` section add a `manage-staff` section: owner only; the four actions with their bodies
   and answers (from Global Constraints); the redirect rule; the `email_sent: false` behaviour; that invitations use
   Supabase's built-in email sender, which only reaches organisation members and is rate-limited until custom SMTP is
   configured, which is why the app also offers the link.
3. In **Calling them**, change "Only active staff may call them" to "Only active staff may call them (`manage-staff`:
   only owners)".

- [ ] **Step 5: Commit**

```bash
git add supabase docs/supabase/edge-functions.md
git commit -m "feat(functions): manage-staff Edge Function to invite, resend, link and cancel"
```

---

### Task 5: Web data layer — function name, error mapping, hooks and `staffStatus`

**Files:**
- Modify: `apps/web/src/data/edge-functions.ts`, `apps/web/src/data/errors.ts`, `apps/web/src/data/staff.ts`
- Create: `apps/web/src/data/staff-rules.ts`, `apps/web/src/data/staff-rules.test.ts`
- Modify: `apps/web/src/data/errors.test.ts`
- Modify: `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Produces:
  - `type StaffStatus = 'invited' | 'active' | 'inactive'`; `staffStatus(member: { active: boolean; last_sign_in_at: string | null }): StaffStatus` (`@/data/staff-rules`)
  - `EdgeFunctionName` includes `'manage-staff'`
  - `fromFunctionCode` maps `not_owner` → `forbidden`, `staff_not_found` → `notFound`, `email_already_registered` →
    `AppError('duplicate', { field: 'email', messageKey: 'staff.errors.emailRegistered' })`, `not_pending` →
    `AppError('invalid', { messageKey: 'staff.errors.notPending' })`
  - hooks in `@/data/staff`:
    - `type StaffRole = 'owner' | 'operator'`; `type InviteValues = { email: string; display_name: string; role: StaffRole }`
    - `useInviteStaff()`: mutation `(values: InviteValues) => Promise<{ user_id: string; email_sent: boolean }>`
    - `useResendInvitation()`: mutation `({ userId }: { userId: string }) => Promise<{ email_sent: boolean }>`
    - `useInvitationLink()`: mutation `({ userId }: { userId: string }) => Promise<{ link: string }>`
    - `useCancelInvitation()`: mutation `({ userId }: { userId: string }) => Promise<void>`
    - `useSetStaffActive()`: mutation `({ userId, active }: { userId: string; active: boolean }) => Promise<void>`
    - the first four invalidate `queryKeys.staffAll` on success **and on error** (a `not_pending` means the list is stale)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/data/staff-rules.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { staffStatus } from './staff-rules'

describe('staffStatus', () => {
  test('a deactivated person is inactive, whether or not they ever signed in', () => {
    expect(staffStatus({ active: false, last_sign_in_at: '2026-10-01T10:00:00Z' })).toBe('inactive')
    expect(staffStatus({ active: false, last_sign_in_at: null })).toBe('inactive')
  })
  test('an active person who never signed in is invited', () => {
    expect(staffStatus({ active: true, last_sign_in_at: null })).toBe('invited')
  })
  test('an active person who has signed in is active', () => {
    expect(staffStatus({ active: true, last_sign_in_at: '2026-10-01T10:00:00Z' })).toBe('active')
  })
})
```

Append to `apps/web/src/data/errors.test.ts` (it already imports `describe, expect, test`; add `fromFunctionCode` to its
import from `./errors` if it is not there):

```ts
describe('fromFunctionCode: manage-staff', () => {
  test('not_owner is a permission problem', () => {
    expect(fromFunctionCode('not_owner').kind).toBe('forbidden')
  })
  test('staff_not_found is not found', () => {
    expect(fromFunctionCode('staff_not_found').kind).toBe('notFound')
  })
  test('email_already_registered is a duplicate on the email field', () => {
    const error = fromFunctionCode('email_already_registered')
    expect(error.kind).toBe('duplicate')
    expect(error.field).toBe('email')
    expect(error.messageKey).toBe('staff.errors.emailRegistered')
  })
  test('not_pending explains that the person already signed in', () => {
    const error = fromFunctionCode('not_pending')
    expect(error.kind).toBe('invalid')
    expect(error.messageKey).toBe('staff.errors.notPending')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/data/staff-rules.test.ts src/data/errors.test.ts`
Expected: FAIL (`./staff-rules` not found; unmapped codes give `unknown`).

- [ ] **Step 3: Implement**

Create `apps/web/src/data/staff-rules.ts`:

```ts
export type StaffStatus = 'invited' | 'active' | 'inactive'

/** Inactive wins; an active person who has never signed in has only been invited. */
export function staffStatus(member: {
  active: boolean
  last_sign_in_at: string | null
}): StaffStatus {
  if (!member.active) return 'inactive'
  return member.last_sign_in_at === null ? 'invited' : 'active'
}
```

`apps/web/src/data/edge-functions.ts`: change the type to
`export type EdgeFunctionName = 'price-quote' | 'duplicate-quote' | 'manage-staff'`.

`apps/web/src/data/errors.ts`: in `fromFunctionCode`, before `default:`, add

```ts
    case 'not_owner':
      return new AppError('forbidden', { cause })
    case 'staff_not_found':
      return new AppError('notFound', { cause })
    case 'email_already_registered':
      return new AppError('duplicate', {
        field: 'email',
        messageKey: 'staff.errors.emailRegistered',
        cause,
      })
    case 'not_pending':
      return new AppError('invalid', { messageKey: 'staff.errors.notPending', cause })
```

`apps/web/src/data/staff.ts`: add the import `import { invokeFunction } from './edge-functions'`, then replace
`useSetStaffRole` with itself unchanged and append:

```ts
export type StaffRole = 'owner' | 'operator'
export type InviteValues = { email: string; display_name: string; role: StaffRole }

/** Invitations change who is on the list, and a refused call usually means the list is stale. */
function useStaffFunction<TVariables, TResult>(
  run: (supabase: ReturnType<typeof useSupabase>, variables: TVariables) => Promise<TResult>,
) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll })
  return useMutation({
    mutationFn: (variables: TVariables) => run(supabase, variables),
    onSuccess: refresh,
    onError: refresh,
  })
}

export function useInviteStaff() {
  return useStaffFunction((supabase, values: InviteValues) =>
    invokeFunction<{ user_id: string; email_sent: boolean }>(supabase, 'manage-staff', {
      action: 'invite',
      ...values,
    }),
  )
}

export function useResendInvitation() {
  return useStaffFunction((supabase, { userId }: { userId: string }) =>
    invokeFunction<{ email_sent: boolean }>(supabase, 'manage-staff', {
      action: 'resend',
      user_id: userId,
    }),
  )
}

export function useInvitationLink() {
  return useStaffFunction((supabase, { userId }: { userId: string }) =>
    invokeFunction<{ link: string }>(supabase, 'manage-staff', { action: 'link', user_id: userId }),
  )
}

export function useCancelInvitation() {
  return useStaffFunction(async (supabase, { userId }: { userId: string }) => {
    await invokeFunction<Record<string, never>>(supabase, 'manage-staff', {
      action: 'cancel',
      user_id: userId,
    })
  })
}

/** Deactivating ends the person's access at once (is_staff() turns false); their quotes keep their name. */
export function useSetStaffActive() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase
        .from('staff')
        .update({ active })
        .eq('user_id', userId)
        .select('user_id')
        .single()
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll }),
  })
}
```

`apps/web/src/i18n/locales/it.json` and `en.json` — under `"staff"` add an `"errors"` group (match the file's
indentation; keep the existing keys, they are reworked in Task 6):

```json
    "errors": {
      "emailRegistered": "Questa email ha già un account.",
      "notPending": "Questa persona ha già effettuato l'accesso: l'invito non può essere modificato."
    }
```

```json
    "errors": {
      "emailRegistered": "This email already has an account.",
      "notPending": "This person has already signed in; the invitation can't be changed."
    }
```

(Italian first, English second, in their own files.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web`
Expected: PASS, including the i18n key-set test.

- [ ] **Step 5: Format, lint, build and commit**

Run: `npm run format && npm run lint && npm run build`

```bash
git add apps/web
git commit -m "feat(web): staff status rule, manage-staff error mapping and invitation hooks"
```

---

### Task 6: The Staff list — status, Deactivate and Reactivate

**Files:**
- Modify: `apps/web/src/pages/StaffPage.tsx`, `apps/web/src/pages/StaffPage.test.tsx`
- Create: `apps/web/src/pages/staff/StaffActions.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `staffStatus`, `useSetStaffActive`, `StaffMember` (now with `last_sign_in_at`).
- Produces: `StaffActions({ member, isSelf }: { member: StaffMember; isSelf: boolean })` (extended in Task 7).

- [ ] **Step 1: Texts**

`it.json`, under `"staff"`: replace the `note` text with
`"note": "Disattivare una persona ne blocca subito l'accesso; i preventivi che ha creato restano."`; in `columns`
replace `"active": "Attivo"` (whatever it currently says) with `"status": "Stato"` and add `"actions": "Azioni"`; add:

```json
    "status": {
      "invited": "Invitato",
      "active": "Attivo",
      "inactive": "Disattivato"
    },
    "actions": {
      "deactivate": "Disattiva",
      "reactivate": "Riattiva",
      "deactivateFor": "Disattiva {{name}}",
      "reactivateFor": "Riattiva {{name}}"
    },
    "deactivate": {
      "title": "Disattivare {{name}}?",
      "body": "{{name}} non potrà più usare 3D-Quote. I suoi preventivi restano."
    },
```

`en.json`: `"note": "Deactivating someone stops their access at once; the quotes they created stay."`, columns
`"status": "Status"` and `"actions": "Actions"` (replacing `active`), and:

```json
    "status": {
      "invited": "Invited",
      "active": "Active",
      "inactive": "Inactive"
    },
    "actions": {
      "deactivate": "Deactivate",
      "reactivate": "Reactivate",
      "deactivateFor": "Deactivate {{name}}",
      "reactivateFor": "Reactivate {{name}}"
    },
    "deactivate": {
      "title": "Deactivate {{name}}?",
      "body": "{{name}} won't be able to use 3D-Quote. Their quotes stay."
    },
```

Check nothing else uses `staff.columns.active` (`grep -rn "staff.columns.active" apps/web/src`).

- [ ] **Step 2: Write the failing tests**

Replace `apps/web/src/pages/StaffPage.test.tsx` with (the first test and the shared setup change; the role,
last-owner, own-role and retry tests are kept as they were and the new ones appended):

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
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
  const { db, user } = renderApp('/staff', { session, rpc })
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
  const { db, user } = renderApp('/staff', { session, rpc })
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/StaffPage.test.tsx`
Expected: FAIL (no status badges, no Disattiva buttons).

- [ ] **Step 4: Implement**

Create `apps/web/src/pages/staff/StaffActions.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useSetStaffActive, type StaffMember } from '@/data/staff'
import { staffStatus } from '@/data/staff-rules'
import { ConfirmActionDialog } from '@/pages/quote-editor/ConfirmActionDialog'

/** The actions a row allows for its status. Your own row has none. */
export function StaffActions({ member, isSelf }: { member: StaffMember; isSelf: boolean }) {
  const { t } = useTranslation()
  const setActive = useSetStaffActive()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (isSelf) return null
  const status = staffStatus(member)

  async function deactivate() {
    setError(null)
    try {
      await setActive.mutateAsync({ userId: member.user_id, active: false })
      setConfirming(false)
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  async function reactivate() {
    try {
      await setActive.mutateAsync({ userId: member.user_id, active: true })
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  return (
    <>
      {status === 'active' && (
        <Button
          variant="outline"
          size="sm"
          aria-label={t('staff.actions.deactivateFor', { name: member.display_name })}
          onClick={() => setConfirming(true)}
        >
          {t('staff.actions.deactivate')}
        </Button>
      )}
      {status === 'inactive' && (
        <Button
          variant="outline"
          size="sm"
          disabled={setActive.isPending}
          aria-label={t('staff.actions.reactivateFor', { name: member.display_name })}
          onClick={() => void reactivate()}
        >
          {t('staff.actions.reactivate')}
        </Button>
      )}
      {confirming && (
        <ConfirmActionDialog
          title={t('staff.deactivate.title', { name: member.display_name })}
          body={t('staff.deactivate.body', { name: member.display_name })}
          confirmLabel={t('staff.actions.deactivate')}
          pending={setActive.isPending}
          error={error}
          onConfirm={() => void deactivate()}
          onCancel={() => {
            setConfirming(false)
            setError(null)
          }}
        />
      )}
    </>
  )
}
```

Replace the columns in `apps/web/src/pages/StaffPage.tsx` (keep the imports it needs, add `Badge`, `staffStatus`,
`StaffActions`; remove the unused `common.yes/no` use):

```tsx
import { Badge } from '@/components/ui/badge'
import { staffStatus, type StaffStatus } from '@/data/staff-rules'
import { StaffActions } from './staff/StaffActions'

const STATUS_VARIANT: Record<StaffStatus, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  invited: 'secondary',
  inactive: 'outline',
}
```

and in `columns`, change the role select's `disabled` to
`m.user_id === me.userId || setRole.isPending || !m.active`, and replace the last (`active`) column with:

```tsx
    {
      key: 'status',
      header: t('staff.columns.status'),
      cell: (m) => {
        const status = staffStatus(m)
        return <Badge variant={STATUS_VARIANT[status]}>{t(`staff.status.${status}`)}</Badge>
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('staff.columns.actions')}</span>,
      cell: (m) => <StaffActions member={m} isSelf={m.user_id === me.userId} />,
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web`
Expected: PASS.

- [ ] **Step 6: Format, lint, build and commit**

Run: `npm run format && npm run lint && npm run build`

```bash
git add apps/web
git commit -m "feat(web): staff status badges, Deactivate and Reactivate"
```

---

### Task 7: Invite, and the actions on invitations

**Files:**
- Create: `apps/web/src/pages/staff/invite-form.ts`, `apps/web/src/pages/staff/InviteSheet.tsx`,
  `apps/web/src/pages/staff/InvitationLinkDialog.tsx`, `apps/web/src/pages/staff/use-invitation-link.ts`
- Modify: `apps/web/src/pages/staff/StaffActions.tsx`, `apps/web/src/pages/StaffPage.tsx`,
  `apps/web/src/pages/StaffPage.test.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: hooks from Task 5; `StaffActions` from Task 6.
- Produces:
  - `type ShownLink = { name: string; link: string }`
  - `useShowInvitationLink(show: (link: ShownLink) => void): (userId: string, name: string) => Promise<void>`
    (fetches the link and passes it on; a failure becomes an error toast)
  - `InviteSheet({ onClose, onShowLink }: { onClose: () => void; onShowLink: (userId: string, name: string) => Promise<void> })`
  - `InvitationLinkDialog({ name, link, onClose })`
  - `StaffActions` gains the prop `onShowLink: (link: ShownLink) => void`

- [ ] **Step 1: Texts**

`it.json`, under `"staff"`, add:

```json
    "invite": {
      "button": "Invita",
      "title": "Invita una persona",
      "name": "Nome",
      "email": "Email",
      "role": "Ruolo",
      "submit": "Invia invito"
    },
    "toasts": {
      "invited": "Invito inviato a {{email}}.",
      "resent": "Invito inviato.",
      "linkCopied": "Link copiato.",
      "revoked": "Invito revocato."
    },
    "linkDialog": {
      "title": "Link di invito",
      "body": "Impossibile inviare l'email. Copia questo link e invialo tu a {{name}}; funziona una sola volta.",
      "copy": "Copia",
      "copied": "Copiato"
    },
    "revoke": {
      "title": "Revocare l'invito per {{name}}?",
      "body": "Non potrà più registrarsi.",
      "confirm": "Revoca"
    },
```

and extend `"actions"` with
`"resendFor": "Invia di nuovo l'invito a {{name}}"`, `"resend": "Invia di nuovo"`,
`"linkFor": "Copia il link di invito di {{name}}"`, `"link": "Copia link"`,
`"revokeFor": "Revoca l'invito di {{name}}"`, `"revoke": "Revoca"`.

`en.json`:

```json
    "invite": {
      "button": "Invite",
      "title": "Invite someone",
      "name": "Name",
      "email": "Email",
      "role": "Role",
      "submit": "Send invitation"
    },
    "toasts": {
      "invited": "Invitation sent to {{email}}.",
      "resent": "Invitation sent.",
      "linkCopied": "Link copied.",
      "revoked": "Invitation revoked."
    },
    "linkDialog": {
      "title": "Invitation link",
      "body": "The email couldn't be sent. Copy this link and send it to {{name}} yourself; it works once.",
      "copy": "Copy",
      "copied": "Copied"
    },
    "revoke": {
      "title": "Revoke the invitation for {{name}}?",
      "body": "They won't be able to join.",
      "confirm": "Revoke"
    },
```

and in `"actions"`: `"resendFor": "Resend the invitation to {{name}}"`, `"resend": "Resend"`,
`"linkFor": "Copy the invitation link of {{name}}"`, `"link": "Copy link"`,
`"revokeFor": "Revoke the invitation of {{name}}"`, `"revoke": "Revoke"`.

- [ ] **Step 2: Write the failing tests**

Append to `apps/web/src/pages/StaffPage.test.tsx` (add `vi` to the vitest import):

```tsx
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
  const { db, user } = renderApp('/staff', { session, rpc, functions: { 'manage-staff': manageStaff({}) } })
  await user.click(await screen.findByRole('button', { name: 'Invita' }))
  const sheet = await screen.findByRole('dialog', { name: 'Invita una persona' })
  await user.type(within(sheet).getByLabelText('Email'), 'not-an-email')
  await user.click(within(sheet).getByRole('button', { name: 'Invia invito' }))
  expect(await within(sheet).findByText('Obbligatorio.')).toBeInTheDocument()
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
  expect(screen.getByRole('button', { name: 'Invia di nuovo l\'invito a Carla Neri' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copia il link di invito di Carla Neri' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Revoca l\'invito di Carla Neri' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Disattiva Carla Neri' })).not.toBeInTheDocument()
})

test('Resend sends the invitation again', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({ resend: { email_sent: true } }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Invia di nuovo l\'invito a Carla Neri' }))
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
  await user.click(await screen.findByRole('button', { name: 'Invia di nuovo l\'invito a Carla Neri' }))
  const dialog = await screen.findByRole('dialog', { name: 'Link di invito' })
  expect(within(dialog).getByText('https://auth.test/verify?token=xyz')).toBeInTheDocument()
})

test('Copy link puts the link on the clipboard', async () => {
  const { user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({ link: { link: 'https://auth.test/verify?token=abc' } }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Copia il link di invito di Carla Neri' }))
  expect(await screen.findByText('Link copiato.')).toBeInTheDocument()
  expect(await navigator.clipboard.readText()).toBe('https://auth.test/verify?token=abc')
})

test('Copy link opens the link dialog when the clipboard is unavailable', async () => {
  const { user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({ link: { link: 'https://auth.test/verify?token=abc' } }) },
  })
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  await user.click(await screen.findByRole('button', { name: 'Copia il link di invito di Carla Neri' }))
  const dialog = await screen.findByRole('dialog', { name: 'Link di invito' })
  expect(within(dialog).getByText('https://auth.test/verify?token=abc')).toBeInTheDocument()
})

test('Revoke asks first, then deletes the invitation', async () => {
  const { db, user } = renderApp('/staff', {
    session,
    rpc,
    functions: { 'manage-staff': manageStaff({ cancel: {} }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Revoca l\'invito di Carla Neri' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Revocare l\'invito per Carla Neri?')).toBeInTheDocument()
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
  await user.click(await screen.findByRole('button', { name: 'Revoca l\'invito di Carla Neri' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Revoca' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Questa persona ha già effettuato l\'accesso',
  )
  await waitFor(() => expect(db.rpcCalls('list_staff').length).toBeGreaterThan(1))
})
```

Check the Italian validation texts against `it.json` (`validation.required`, `validation.email`) and fix the expected
strings in the "checks the fields" test if they differ.

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/StaffPage.test.tsx`
Expected: FAIL (no Invita button, no invitation actions).

- [ ] **Step 4: Implement the form, the dialog and the link hook**

`apps/web/src/pages/staff/invite-form.ts`:

```ts
import { z } from 'zod'
import { requiredText } from '@/lib/forms'

export const inviteSchema = z.object({
  display_name: requiredText(),
  email: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .refine((value) => z.email().safeParse(value).success, 'validation.email'),
  role: z.enum(['operator', 'owner']),
})

export type InviteForm = z.infer<typeof inviteSchema>

export const INVITE_DEFAULTS: InviteForm = { display_name: '', email: '', role: 'operator' }
```

`apps/web/src/pages/staff/use-invitation-link.ts`:

```ts
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toAppError } from '@/data/errors'
import { useInvitationLink } from '@/data/staff'

export type ShownLink = { name: string; link: string }

/** Fetches a pending person's invitation link and hands it to `show`; a failure becomes an error toast. */
export function useShowInvitationLink(show: (link: ShownLink) => void) {
  const { t } = useTranslation()
  const getLink = useInvitationLink()
  return async (userId: string, name: string) => {
    try {
      const { link } = await getLink.mutateAsync({ userId })
      show({ name, link })
    } catch (error) {
      toast.error(t(toAppError(error).messageKey))
    }
  }
}
```

`apps/web/src/pages/staff/InvitationLinkDialog.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Shows an invitation link to copy and send by hand. */
export function InvitationLinkDialog({
  name,
  link,
  onClose,
}: {
  name: string
  link: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // The link is selectable in the dialog; copying by hand still works.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('staff.linkDialog.title')}</DialogTitle>
          <DialogDescription>{t('staff.linkDialog.body', { name })}</DialogDescription>
        </DialogHeader>
        <p className="rounded-md border bg-muted p-2 text-sm break-all select-all">{link}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => void copy()}>
            {copied ? t('staff.linkDialog.copied') : t('staff.linkDialog.copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

`apps/web/src/pages/staff/InviteSheet.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { AppError, toAppError } from '@/data/errors'
import { useInviteStaff } from '@/data/staff'
import { INVITE_DEFAULTS, inviteSchema, type InviteForm } from './invite-form'

/** Name, email and role of a new person. If the email can't be sent, `onShowLink` offers the link instead. */
export function InviteSheet({
  onClose,
  onShowLink,
}: {
  onClose: () => void
  onShowLink: (userId: string, name: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const invite = useInviteStaff()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: INVITE_DEFAULTS,
  })
  const {
    register,
    setError,
    formState: { errors, isDirty },
  } = form

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    const email = values.email.trim().toLowerCase()
    const name = values.display_name.trim()
    try {
      const result = await invite.mutateAsync({
        email,
        display_name: name,
        role: values.role,
      })
      if (result.email_sent) toast.success(t('staff.toasts.invited', { email }))
      else await onShowLink(result.user_id, name)
      onClose()
    } catch (error) {
      const appError = toAppError(error)
      if (appError instanceof AppError && appError.field === 'email') {
        setError('email', { message: appError.messageKey })
      } else {
        setFormError(appError.messageKey)
      }
    }
  })

  return (
    <FormSheet title={t('staff.invite.title')} dirty={isDirty} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormField
          id="invite-name"
          label={t('staff.invite.name')}
          error={errors.display_name?.message}
        >
          <Input
            id="invite-name"
            autoComplete="off"
            aria-invalid={!!errors.display_name}
            {...register('display_name')}
          />
        </FormField>
        <FormField id="invite-email" label={t('staff.invite.email')} error={errors.email?.message}>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
        </FormField>
        <FormField id="invite-role" label={t('staff.invite.role')}>
          <NativeSelect id="invite-role" {...register('role')}>
            <NativeSelectOption value="operator">{t('staff.roles.operator')}</NativeSelectOption>
            <NativeSelectOption value="owner">{t('staff.roles.owner')}</NativeSelectOption>
          </NativeSelect>
        </FormField>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={invite.isPending}>
          {t('staff.invite.submit')}
        </Button>
      </form>
    </FormSheet>
  )
}
```

(The Invite button stays enabled even when the form is pristine so an empty submit shows the validation messages;
`isDirty` is only used for the unsaved-changes prompt.)

- [ ] **Step 5: Extend `StaffActions` and wire the page**

In `apps/web/src/pages/staff/StaffActions.tsx`:

1. Imports: add `useCancelInvitation`, `useResendInvitation`, `useInvitationLink` to the `@/data/staff` import,
   `type ShownLink, useShowInvitationLink` from `./use-invitation-link`, and `useTranslation`'s existing `t`.
2. Change the signature to
   `({ member, isSelf, onShowLink }: { member: StaffMember; isSelf: boolean; onShowLink: (link: ShownLink) => void })`.
3. After `const setActive = ...` add:

```tsx
  const resend = useResendInvitation()
  const getLink = useInvitationLink()
  const cancel = useCancelInvitation()
  const showLinkFor = useShowInvitationLink(onShowLink)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
```

4. Before `return (` add:

```tsx
  async function resendInvitation() {
    try {
      const { email_sent } = await resend.mutateAsync({ userId: member.user_id })
      if (email_sent) toast.success(t('staff.toasts.resent'))
      else await showLinkFor(member.user_id, member.display_name)
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function copyLink() {
    try {
      const { link } = await getLink.mutateAsync({ userId: member.user_id })
      try {
        await navigator.clipboard.writeText(link)
        toast.success(t('staff.toasts.linkCopied'))
      } catch {
        onShowLink({ name: member.display_name, link })
      }
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function revoke() {
    setRevokeError(null)
    try {
      await cancel.mutateAsync({ userId: member.user_id })
      setRevoking(false)
      toast.success(t('staff.toasts.revoked'))
    } catch (caught) {
      setRevokeError(t(toAppError(caught).messageKey))
    }
  }
```

5. Inside the returned fragment, after the `status === 'inactive'` button add:

```tsx
      {status === 'invited' && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={resend.isPending}
            aria-label={t('staff.actions.resendFor', { name: member.display_name })}
            onClick={() => void resendInvitation()}
          >
            {t('staff.actions.resend')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={getLink.isPending}
            aria-label={t('staff.actions.linkFor', { name: member.display_name })}
            onClick={() => void copyLink()}
          >
            {t('staff.actions.link')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('staff.actions.revokeFor', { name: member.display_name })}
            onClick={() => setRevoking(true)}
          >
            {t('staff.actions.revoke')}
          </Button>
        </>
      )}
```

and after the deactivate `ConfirmActionDialog` block:

```tsx
      {revoking && (
        <ConfirmActionDialog
          title={t('staff.revoke.title', { name: member.display_name })}
          body={t('staff.revoke.body')}
          confirmLabel={t('staff.revoke.confirm')}
          pending={cancel.isPending}
          error={revokeError}
          onConfirm={() => void revoke()}
          onCancel={() => {
            setRevoking(false)
            setRevokeError(null)
          }}
        />
      )}
```

6. Wrap the actions in a flex container so the three buttons line up: change the outer fragment's first child
   wrapper to `<div className="flex flex-wrap gap-2">…buttons…</div>` and keep the dialogs outside it.

In `apps/web/src/pages/StaffPage.tsx`:

```tsx
import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InvitationLinkDialog } from './staff/InvitationLinkDialog'
import { InviteSheet } from './staff/InviteSheet'
import { useShowInvitationLink, type ShownLink } from './staff/use-invitation-link'
```

Inside `StaffPage()`: add

```tsx
  const [inviting, setInviting] = useState(false)
  const [shownLink, setShownLink] = useState<ShownLink | null>(null)
  const showLinkFor = useShowInvitationLink(setShownLink)
```

pass `onShowLink={setShownLink}` to `<StaffActions …/>`, give the header an action
`<PageHeader title={t('nav.staff')} actions={<Button onClick={() => setInviting(true)}><UserPlus aria-hidden />{t('staff.invite.button')}</Button>} />`,
and before the closing `</section>` add

```tsx
      {inviting && <InviteSheet onClose={() => setInviting(false)} onShowLink={showLinkFor} />}
      {shownLink && (
        <InvitationLinkDialog
          name={shownLink.name}
          link={shownLink.link}
          onClose={() => setShownLink(null)}
        />
      )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web`
Expected: PASS. If the sheet closing races the link dialog in "when the email cannot be sent…", keep the sheet open
until `onShowLink` resolves (as written) and fix the test, not the order.

- [ ] **Step 7: Format, lint, build and commit**

Run: `npm run format && npm run lint && npm run build`

```bash
git add apps/web
git commit -m "feat(web): invite staff, and resend, copy the link of or revoke an invitation"
```

---

### Task 8: Documentation and final verification

**Files:**
- Modify: `docs/frontend/functional-analysis.md`, `docs/frontend/web-app.md`, `docs/supabase/edge-functions.md` (if
  Task 4 left gaps), `docs/README.md` (only if it lists functions),
  `docs/superpowers/specs/2026-10-14-staff-management-design.md`

- [ ] **Step 1: Functional analysis**

Replace §3.9 **Staff** in `docs/frontend/functional-analysis.md` with:

```markdown
### 3.9 Staff

Owner only.

- **List:** name, email, role, status (Invited / Active / Inactive). Invited = invited and never signed in.
- **Invite:** name, email and role (the person's language starts as Italian). Sends the invitation email; the person
  follows the link, sets a password and is in. If the email can't be sent the app shows the link to send by hand.
- **Invitations:** Resend, Copy link, Revoke (deletes the invitation; only before the person has signed in).
- **Change role** between Operator and Owner.
- **Deactivate / Reactivate:** a deactivated person can no longer use the app, and the quotes they created keep
  showing them as creator. Your own row has no actions.
- The last remaining owner can't be demoted or deactivated.
```

- [ ] **Step 2: Web app guide**

In `docs/frontend/web-app.md`:
- Add a **Staff** section (near Quotes): the files in `src/pages/staff/` and what each does; `manage-staff` called
  through `invokeFunction`; statuses from `staffStatus` (`src/data/staff-rules.ts`); tests pass handlers with
  `renderApp(path, { functions: { 'manage-staff': … } })`; the clipboard comes from user-event in tests.
- Remove "Inviting, removing and deactivating staff" from **Not done yet**.
- In the **Redirect URLs** bullet, say invitations also land on `<origin>/account?reset=1`, so the same allow-list
  entry (`https://<host>/account**`) covers them, and add: Supabase's built-in email sender only delivers to members
  of your Supabase organisation and is rate-limited, so configure custom SMTP before inviting ordinary addresses;
  until then use **Copy link**.
- Add under a short **Deploying** note (next to the existing one for the VAT migrations): the `manage-staff` function
  and the `staff_last_sign_in` migrations must be deployed / applied to the cloud project together with this build.

- [ ] **Step 3: Spec**

In `docs/superpowers/specs/2026-10-14-staff-management-design.md`: set `- **Status:** Implemented`; change the
**Cancel invitation** wording to **Revoke invitation** wherever it describes the UI (the function action stays
`cancel`); in the `link` row replace "(recovery type; sends nothing)" with what was actually implemented in Task 3/4
(invite-type link, or recovery if Task 4 had to switch).

- [ ] **Step 4: Full verification**

Run, from the repo root:

```bash
npm run build && npm run lint && npm run format:check && npm test
npm run functions:check && npm run functions:test
supabase test db
npm run check:types-fresh
```

Expected: all pass; `supabase test db` passes 14 files. (`supabase db diff` still shows only the known, unrelated
`quotes_list` drop/recreate noise.)

- [ ] **Step 5: Manual smoke check**

With `supabase start` (and the functions runtime) running and `VITE_SUPABASE_URL` / key overridden to the local stack
on the dev command (the checked-in `.env` files point at the cloud project), run the web app and sign in as
`owner@3dquote.local` / `password123`:

1. Staff → **Invite**: name, email, role. The toast says it was sent; open the local Inbucket
   (`http://127.0.0.1:54324`) and find the email. The person shows **Invited**.
2. **Copy link** and paste it into a private window: it opens `/account?reset=1`; set a password; the person is in.
   Back in the owner window and after a reload: **Active**.
3. Invite a second person; **Resend**; **Revoke** (confirm): the row disappears.
4. **Deactivate** the first person (confirm): **Inactive**, their role select is disabled; in their window the next
   request shows the no-access screen. **Reactivate** brings them back.
5. Try to deactivate or demote the only other owner while you are the last: the message appears.

Note anything that differs from the spec in the report rather than fixing it silently. If a sub-step could not be run,
say so; never claim a check that was not run.

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: document staff invites and management"
```

## Not done yet

- Applying the `staff_last_sign_in` migrations and deploying `manage-staff` to the cloud project (on request, through
  the Supabase MCP).
- Custom SMTP, changing a person's email, banning the auth user on deactivation.
