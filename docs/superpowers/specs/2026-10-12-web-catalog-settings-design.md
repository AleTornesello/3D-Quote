# Web App: Catalog & Settings — Design

- **Date:** 2026-10-12
- **Status:** Draft — awaiting review
- **Branch:** `develop`

## Goal

Put the first real screens on the [Supabase schema](2026-10-11-supabase-schema-design.md):

- Printers, Materials, Clients (list + detail) and Settings;
- an Account page, which also completes the password-reset flow;
- a read-only Staff list where the owner can change roles;
- role-based UI for owner and operator;
- language stored on the staff record.

The Supabase client is typed from generated types, and data goes through TanStack Query.
The screens follow the [functional analysis](../../frontend/functional-analysis.md):

| Area | Section |
|---|---|
| Permission matrix | §1 |
| Common states | §2 |
| Clients | §3.5 |
| Printers | §3.6 |
| Materials | §3.7 |
| Settings | §3.8 |
| Staff | §3.9 |
| Account | §3.10 |
| Formatting | §8 |

## Decisions

| Concern | Choice |
|---|---|
| Types | `supabase gen types typescript --local` → `apps/web/src/lib/database.types.ts`, committed |
| Data access | One module per entity in `src/data/`, exporting TanStack Query hooks; pages never call Supabase directly |
| Forms | `react-hook-form` + `zod` + shadcn `field` components |
| Create and edit | A side sheet over the list (Clients detail edits in the page) |
| Test double | A chainable fake query builder in `src/test/fake-supabase.ts` |
| Staff emails | New `public.list_staff()` RPC, owner-only |
| Language | `staff.language` is the source of truth once signed in; `localStorage` still drives the login page |

## Schema change: `list_staff()`

Staff emails live in `auth.users`, which the Data API can't read. A new function returns them to owners only. It uses
the existing pattern: a `security invoker` wrapper in `public` over a `security definer` function in `private`.

- `private.list_staff()`:
  - is `security definer`, `stable`, `set search_path = ''`;
  - raises `42501` with message `owner_required` unless `private.is_owner()`;
  - returns `table (user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamptz)`;
  - selects from `public.staff` joined to `auth.users`, ordered by `display_name`.
- `public.list_staff()`: `security invoker`, same return type, returns `select * from private.list_staff()`.
- Both definitions go in `supabase/schemas/01_staff.sql`.
- Execute on both is granted to `authenticated`. The default privileges already revoke it from `public` and `anon`.
  The grant goes in `supabase/schemas/90_grants.sql` and in the hand-written migration.
- Two new migrations, both dated after `20261011120100`:
  - `<ts>_list_staff.sql`, generated with `supabase db diff`;
  - `<ts+100>_list_staff_setup.sql` (`supabase migration new list_staff_setup`, following the repo's `_setup`
    convention), hand-written, holding the function grants.

  The existing migrations stay unchanged, because they are already applied on the cloud project.
- New pgTAP file `supabase/tests/database/10_list_staff.test.sql`:
  - an owner gets every staff row, with the correct emails;
  - an operator gets `42501 owner_required`;
  - an authenticated user without a staff record gets `42501`;
  - an inactive owner gets `42501`;
  - `anon` lacks execute permission.
- Applying the migrations to the cloud project (`pzukbipwiupezwpvnazh`) is **not** part of this work. It is a separate
  step, confirmed with the user and done through the Supabase MCP.

## Foundations

### Generated types

- A root script `gen:types` runs `supabase gen types typescript --local > apps/web/src/lib/database.types.ts`, then
  Prettier on that file.
- `src/lib/supabase.ts` creates `SupabaseClient<Database>`; `useSupabase()` returns the typed client.
- Row types use the generated helpers (`Tables<'printers'>`, `TablesInsert<…>`, `TablesUpdate<…>`).
- `database.types.ts` is excluded from ESLint.
- A root script `check:types-fresh` regenerates the types to a temporary file and fails if they differ from the committed
  file. It is run by hand after schema changes and is not part of `npm test`.

### Data layer (`src/data/`)

| Module | Hooks |
|---|---|
| `printers.ts` | `usePrinters()`, `useSavePrinter()`, `useDeletePrinter()` |
| `materials.ts` | `useMaterials()`, `useSaveMaterial()`, `useDeleteMaterial()` |
| `clients.ts` | `useClients(search)`, `useClient(id)`, `useClientQuotes(id)`, `useSaveClient()`, `useDeleteClient()` |
| `settings.ts` | `useSettings()`, `useSaveSettings()`, `useUploadLogo()`, `useRemoveLogo()`, `useLogoUrl(path)` |
| `staff.ts` | `useOwnStaff(userId)`, `useStaffList()`, `useSetStaffRole()`, `useSaveOwnProfile()` |
| `query-keys.ts` | Shared query keys |

How the hooks behave:

- Save hooks insert when there is no `id`, and otherwise update by `id`.
- Successful mutations invalidate the matching list and detail keys.
- Supabase `{ error }` results are thrown as an `AppError`, so TanStack Query treats them as failures.
- **Printer and material toggles:** the Active toggle is an update of `{ active }` through the save hook.
- **Clients list:**
  - selects `*, quote_count:quotes(count), last_quote:quotes(created_at)`;
  - the `last_quote` embed is ordered by `created_at` descending, with limit 1 (supabase-js `referencedTable` options);
  - the search term, trimmed and debounced 300 ms, applies `or(name.ilike.%t%,company.ilike.%t%,email.ilike.%t%)`;
  - PostgREST filter characters (`,` `(` `)` `%` `*`) are stripped from the term first.

  The implementation plan's first step that touches this query checks it against the local stack.
- **Client quotes:** `quotes` filtered by `client_id`, selecting `id, number, status, created_at, valid_until`, newest first.

### Error mapping (`src/data/errors.ts`)

`toAppError(e)` returns `{ kind, field?, messageKey }`:

| Source | `kind` | Notes |
|---|---|---|
| `23505` | `duplicate` | `field` from the constraint name (`printers_name_key` → `name`) |
| `23503` | `inUse` | |
| `23514` or `22P02` | `invalid` | |
| `42501` | `forbidden` | |
| `P0001` with message `last_owner` | `lastOwner` | |
| `PGRST116` (no row returned) | `notFound` | Saves end in `.select().single()`, so an update that RLS silently filters out is not mistaken for success; deletes with 0 rows raise it too |
| `TypeError` / fetch failure | `network` | |
| anything else | `unknown` | |

`messageKey` points to `errors.<kind>`. Screens may override the message for a context: for example, `inUse` on a printer
says "used by quote items — deactivate it instead".

### Staff profile and roles

- `StaffProvider` (`src/auth/StaffProvider.tsx`) renders inside `RequireAuth` and loads the user's own `staff` row with
  `useOwnStaff(session.user.id)`.
- RLS returns no row for users with no staff record and for inactive staff. The provider has three states:
  - **loading:** the same "Loading…" status line `RequireAuth` shows while the session loads;
  - **no access:** the page "Your account has no access to 3D-Quote — ask the owner", with only a Log out button;
  - **ready:** `useStaff()` returns `{ userId, displayName, role, isOwner, language }`.
- If loading fails, the provider shows a full-page error with Retry. A network error must not appear as "no access".
- `RequireOwner` wraps `/staff`. Operators get a "Not available for your role" page with a link to `/quotes`.
- **Navigation:**
  - shows `displayName` instead of the email;
  - hides Staff for operators.
- **Owner-only actions** are hidden, not disabled:
  - New, Edit, Delete and the Active toggle on Printers and Materials;
  - Save on Settings;
  - Delete on Clients;
  - role changes on Staff.

  Operators see Printers, Materials and Settings as plain read-only values.

### Language

- When the profile loads, the UI switches to `staff.language` and writes it to `localStorage`.
- **The sidebar switcher and the Account page:**
  - change the UI at once;
  - update `staff.language` for the current user;
  - write to `localStorage`.
- If the database update fails, the UI keeps the new language and shows a non-blocking error.
- **Before sign-in** (login and forgot-password pages), the existing `localStorage` and browser logic still applies.

### Forms

- Each form has a zod schema whose rules mirror the database checks.
- Numeric inputs are parsed in the UI locale, so both `0,40` and `0.40` are accepted.
- Messages are i18n keys.
- Field errors appear under their field. Database errors that carry a `field` attach to it; other database errors
  appear above the Save button.
- **Unsaved changes:** while the form is dirty, closing the sheet or navigating away asks to discard the changes:
  - in a sheet, the check runs in the close handler;
  - on full pages (Client detail, Settings, Account), it uses react-router `useBlocker`.
- Save is disabled while saving and while the form is unchanged.

### Shared UI

- **New shadcn components** (via `npx shadcn add … -c apps/web`): `field`, `table`, `alert-dialog`, `native-select`,
  `switch`, `textarea`, `badge`, `skeleton`, `alert`.
  - `field` replaces `form`, which is empty in the radix-nova registry.
  - `native-select` replaces the Radix `select`: it works with the phone's own picker and with `register`.
  - There are no toasts: `sonner` needs `next-themes`, so confirmations are inline status messages.
- **App components** in `src/components/`:
  - `DataTable`: loading skeleton, empty state, error with Retry;
  - `ConfirmDeleteDialog`: names the item;
  - `UnsavedChangesDialog`;
  - `ReadOnlyField`.
- **Formatting** (`src/lib/format.ts`): numbers, currency and dates use `Intl` with `it-IT` or `en-GB`. The currency
  comes from `settings.currency`, falling back to `EUR` while loading.

## Screens

### Printers (`/printers`)

- **Columns:** name, model, build volume (`250 × 210 × 220 mm`), nozzle (mm), hourly rate (currency), power (W), active.
- **Form rules:**
  - name: required, 1–200;
  - model: required;
  - build X/Y/Z: each > 0, one decimal;
  - nozzle: > 0, two decimals, default 0.40;
  - hourly rate: ≥ 0;
  - power: integer > 0;
  - active: default on.
- A duplicate name shows "A printer with this name already exists" under the name field.
- **Delete:**
  - asks "Delete printer *name*?";
  - on `inUse`, the dialog explains that the printer is used and offers **Deactivate instead**, which sets
    `active = false`.

### Materials (`/materials`)

- **Columns:** name, type, colour, cost/kg (currency), density (g/cm³), active.
- **Form rules:**
  - name: required;
  - type: a select of PLA, PETG, ABS, ASA, TPU, PA, PC, Other (stored as `other`);
  - colour: optional;
  - cost/kg: ≥ 0;
  - density: > 0, two decimals;
  - active.
- **Density pre-fill:**

  | Type | Density (g/cm³) |
  |---|---|
  | PLA | 1.24 |
  | PETG | 1.27 |
  | ABS | 1.04 |
  | ASA | 1.07 |
  | TPU | 1.21 |
  | PA | 1.14 |
  | PC | 1.20 |
  | Other | leaves the field as is |

  Choosing a type pre-fills density only while the user hasn't edited density by hand.
- **Delete:** the same pattern as Printers, including Deactivate instead.

### Clients (`/clients`, `/clients/:id`)

- **List:**
  - **Columns:** name, company, email, phone, number of quotes, last quote date (`—` when there is none).
  - Search box above the table.
  - **New** is available to owners and operators and opens the sheet. After creating, the app navigates to the new
    client's detail page.
  - Clicking a row opens the detail page. Rows are links, so they are keyboard reachable.
- **Form rules:**
  - name: required, 1–200;
  - company: optional;
  - email: optional, valid when present;
  - phone: optional;
  - notes: optional, labelled internal.

  Empty strings are saved as `null`.
- **Detail:**
  - the form edited in place, with Save and the unsaved-changes guard;
  - a read-only quotes table: number, status badge, created, valid until;
  - an empty state "No quotes yet";
  - **New quote for this client**, which links to `/quotes/new?client=:id`.
- **Unknown or invalid id:** the Not found page.
- **Delete:** owner only, and shown only when the client has 0 quotes. A `23503` still shows the in-use message.
  After deleting, the app returns to `/clients`.
- `/quotes/new` is added as a placeholder route ("Coming soon") until the quotes sub-project.

### Settings (`/settings`)

- One form with three cards:
  - **Pricing:**
    - energy price per kWh: ≥ 0, four decimals;
    - failure allowance: 0–100 %;
    - setup fee: ≥ 0;
    - default markup: ≥ 0 %;
    - minimum item price: ≥ 0;
    - currency: three upper-case letters.
  - **Quotes:**
    - prefix: 1–10 letters or digits;
    - default validity: 1–365 days;
    - PDF terms in Italian and English (textareas).
  - **Shop details:** name, address (textarea), VAT number, email (valid when present), phone, logo.
- **Save:** one button, which updates only the changed columns on row `id = 1`.
- **Logo:**
  - accepts PNG, JPG or SVG of at most 1 MB, checked before upload;
  - uploads to the `branding` bucket as `logo-<timestamp>.<ext>`;
  - then updates `shop_logo_path` and deletes the previous file, if any;
  - **Remove** clears `shop_logo_path` and deletes the file;
  - the preview uses a signed URL valid for 1 hour.

  Logo changes save immediately and don't go through Save.
- **Operators:** the same cards as read-only values; the logo preview is shown, with no upload controls.

### Staff (`/staff`, owner only)

- **Data:** `useStaffList()` calls `rpc('list_staff')`.
- **Columns:** name, email, role, active (Yes/No, read-only).
- **Role:**
  - a select per row, whose change updates `staff.role` straight away;
  - `lastOwner` shows "There must be at least one owner" and puts the select back;
  - the select is disabled on the current user's own row.
- No invite, remove or deactivate.

### Account (`/account`)

- **Profile card:**
  - display name, required, saved with a Save button;
  - language select, which applies and saves at once, as described in [Language](#language).
- **Password card:**
  - new password and confirm, both required;
  - they must match;
  - minimum length 6, the Supabase default; the server error is mapped if the project's rule is stricter;
  - submit calls `supabase.auth.updateUser({ password })`;
  - success clears the fields and shows a confirmation.
- **Reset completion:**
  - `ForgotPasswordPage` uses `redirectTo` `${origin}/account?reset=1`;
  - on `/account?reset=1`, the password card shows the banner "Choose a new password" and its first field gets focus;
  - after a successful change, `?reset=1` is removed from the URL.

## i18n

- New key groups:

  | Group | Covers |
  |---|---|
  | `common.*` | save, cancel, delete, edit, new, retry, yes/no, empty states, unsaved-changes prompt, read-only labels |
  | `printers.*`, `materials.*`, `clients.*`, `settings.*`, `staff.*`, `account.*` | the screens |
  | `access.*` | no access, not available for your role |
  | `errors.*` | one key per error kind and per context-specific override |
  | `validation.*` | zod messages |

- Both catalogs keep identical key sets; the existing parity test enforces this.
- Material type names stay untranslated, except `other` (Altro / Other).

## Testing

### Fake query builder

- `src/test/fake-supabase.ts` gains `from(table)`, `rpc(fn, args)` and `storage.from(bucket)`. They share one
  in-memory store.
- **The `from()` builder supports:**
  - `select` (embedded selects are answered from seeded rows: `quote_count` and `last_quote` are seeded directly on
    client rows);
  - `insert`, `update`, `delete`;
  - `eq`, `or`, `ilike`, `order`, `limit`, `single`, `maybeSingle`;
  - awaiting the builder (it is a thenable).
- `insert` and `update` change the in-memory rows, so lists refresh after mutations.
- **Recording:**
  - every call is recorded as `{ table, op, values?, filters, options? }`;
  - `db.calls(table)` returns the calls for one table;
  - `db.rpcCalls(fn)` and `db.storageCalls(bucket)` work the same way.
- **Failures:** `db.failNext(table | rpcName, { code, message })` makes the next matching call return a PostgREST-shaped
  error.
- `renderApp(path, { session, staff, tables, rpc })`:
  - seeds the store;
  - `staff` seeds the user's own staff row; `staff: null` simulates no access;
  - returns `{ user, db }`.

### Tests

| File | Covers |
|---|---|
| `src/data/errors.test.ts` | Every row of the mapping table |
| `src/lib/format.test.ts` | Currency and number formatting in both locales |
| `src/auth/StaffProvider.test.tsx` | No-access page; load error with Retry; language from `staff.language`; display name shown in navigation; Staff hidden for operator |
| `src/app/routes.test.tsx` (updated) | Operator on `/staff` sees "Not available for your role"; owner sees Staff |
| `PrintersPage.test.tsx` | Rows render formatted; empty; error → Retry; owner sees actions, operator does not; create and edit send the right calls; duplicate name under the field; delete in use → Deactivate instead sends `update { active: false }`; unsaved-changes prompt when closing a dirty sheet |
| `MaterialsPage.test.tsx` | Rows; density pre-fill on type change, not after a manual edit; owner-only actions; delete in use |
| `ClientsPage.test.tsx` | Columns including quote count and `—`; search sends `or(...)`; create navigates to detail; operator can create |
| `ClientDetailPage.test.tsx` | Edit and save; client quotes table; New quote link; delete hidden when quotes exist and owner-only; not-found id |
| `SettingsPage.test.tsx` | Update only changed fields; validation (failure > 100, bad prefix); logo type and size rejected before upload; upload then path update; operator read-only |
| `StaffPage.test.tsx` | Emails from the `list_staff` RPC; role change sends an update; `last_owner` reverts with a message; own row disabled |
| `AccountPage.test.tsx` | Name save; language change updates `staff` and the UI; password mismatch; `updateUser` called; `?reset=1` banner and URL cleanup |
| `ForgotPasswordPage.test.tsx` (updated) | New `redirectTo` |
| `supabase/tests/database/10_list_staff.test.sql` | As listed under the schema change |

**Done means** all of the following pass from the repository root:

- `npm run build`;
- `npm run lint`;
- `npm run format:check`;
- `npm test`;
- `supabase test db`;
- `supabase db diff`, which must report no changes.

## Docs

- `docs/frontend/web-app.md`:
  - the data layer (`src/data/`, query keys, `AppError`), `useStaff()`, `RequireOwner`, forms, shared components, the
    fake query builder and how to write a page test, and `npm run gen:types`;
  - removes role-based UI, language on the staff record and reset completion from "Not done yet".
- `docs/supabase/data-model.md`: `list_staff()` in the functions list and its grant.
- `docs/development/getting-started.md`: regenerating types after schema changes; Site URL and redirect URLs must allow
  `/account`.

## Out of scope

- staff invite, remove and deactivate (needs an Edge Function);
- the quotes list and editor (`/quotes/new` stays a placeholder);
- pricing and `duplicate_quote`;
- bundle splitting;
- Playwright;
- CI;
- applying the new migrations to the cloud project.

## Git

All commits go on `develop`. Merging to `main` and pushing are separate steps, done only when asked.
