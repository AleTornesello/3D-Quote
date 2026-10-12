# Web Catalog & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Printers, Materials, Clients (list + detail), Settings, Staff and Account screens on the real Supabase schema, with
generated types, role-based UI, language on the staff record and password-reset completion.

**Architecture:**
- A new owner-only `list_staff()` function (new migration pair) exposes staff emails.
- The web app gets a typed Supabase client (`SupabaseClient<Database>` from generated types) and one TanStack Query module per
  entity in `src/data/`. A `StaffProvider` loads the signed-in user's staff row and drives roles and language.
- Pages use react-hook-form + zod with shadcn `field` components.
- Tests render the real routes with a fake Supabase client whose in-memory query builder records every call.

**Tech Stack:** React 19, Vite 8, TypeScript ~6.0, TanStack Query 5, react-router 8, i18next, react-hook-form 7, zod 4,
@hookform/resolvers 5, shadcn (radix-nova), Vitest 5 + Testing Library, Supabase CLI 2.120 (local stack), pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-12-web-catalog-settings-design.md`

## Global Constraints

- Run every `npm` / `npx` command from the repository root `C:\Progetti\3D-Quote` (the parent folder `C:\Progetti` has an
  unrelated npm project that npm can escape into). Web test files are passed relative to `apps/web`:
  `npm test -- src/pages/PrintersPage.test.tsx`.
- **Git and cloud:**
  - Commit on `develop`. Never push, never merge to `main`.
  - Never touch any cloud Supabase project. The new migrations are applied to the local stack only.
- **Style:**
  - Prettier: no semicolons, single quotes, width 100 (`npm run format` before each commit).
  - ESLint, including `jsx-a11y`.
  - Comments are sparse and explain *why*.
- **Text and data access:**
  - Every user-visible string goes through `t()`, with each key in both `it.json` and `en.json` (a test enforces parity).
  - Supabase is reached only through `useSupabase()`.
  - Server data goes through the hooks in `src/data/`; pages never call Supabase directly.
- **Roles:** owner-only actions are **hidden** for operators, not disabled. The database (RLS) is the authority; the UI
  mirrors it.
- **Components:** add shadcn components with the workspace CLI: `npx shadcn add <names> -c apps/web`. If it would
  overwrite `button.tsx` or `label.tsx`, restore them afterwards with `git checkout -- <file>`, because they carry local
  touch-target tweaks.
- **Tests:**
  - They query by role and visible **Italian** text.
  - `renderApp(path, { session, staff, tables, rpc })` returns `{ db, user, auth, router }`.
  - Save hooks always `.select().single()` after `update`/`insert`, so a write that RLS silently filters (0 rows) surfaces
    as `PGRST116` → `notFound` instead of looking like success.
  - Delete hooks `.select('id')` and treat 0 rows as `notFound`.
- **Done means:** from the repo root, these all pass:
  - `npm run build`, `npm run lint`, `npm run format:check`, `npm test`;
  - `supabase test db`;
  - `supabase db diff`, which must print "No schema changes found".

## Review Focus

1. **A write that RLS silently drops** (0 rows, no error) must show an error, not close the form as if saved. Pinned in
   Task 7 (`a save that changes no row shows an error`).
2. **Italian decimal input:** `2,5` must save `2.5`, and `1.2.3` must be rejected. Pinned in Task 4 (`parseDecimal`) and
   Task 7 (`creates a printer` types `2,5`).
3. **A staff-profile load that fails on the network** must show Retry, never "no access". Pinned in Task 5.
4. **Search text with PostgREST syntax** (`,` `(` `)` `%` `*`) must not break the request. Pinned in Task 9.
5. **Leaving the client detail with unsaved edits** asks first, while deleting the client leaves without asking. Pinned
   in Task 10.

---

## File map

```
supabase/
├── schemas/01_staff.sql                 # + private.list_staff(), public.list_staff()
├── schemas/90_grants.sql                # + list_staff grants
├── migrations/<ts>_list_staff.sql       # generated (db diff)
├── migrations/<ts>_list_staff_setup.sql # hand-written grants
└── tests/database/10_list_staff.test.sql

apps/web/
├── scripts/gen-types.mjs                # gen:types / check:types-fresh
└── src/
    ├── lib/database.types.ts            # generated, committed
    ├── lib/supabase.ts                  # typed client (AppSupabaseClient)
    ├── lib/query-client.ts              # retry option
    ├── lib/format.ts, use-format.ts     # Intl formatting
    ├── lib/forms.ts                     # parseDecimal, numberField, text helpers
    ├── lib/use-debounced-value.ts
    ├── data/errors.ts                   # AppError, toAppError
    ├── data/query-keys.ts
    ├── data/printers.ts, materials.ts, clients.ts, settings.ts, staff.ts, account.ts
    ├── auth/staff-context.ts            # Staff type, useStaff, useOptionalStaff
    ├── auth/StaffProvider.tsx           # loading / error / no access / ready
    ├── auth/RequireOwner.tsx
    ├── auth/use-change-language.ts
    ├── components/                      # PageHeader, DataTable, QueryError, FormField, FormSheet,
    │                                    # ConfirmDeleteDialog, DeleteCatalogItemDialog, UnsavedChangesDialog,
    │                                    # use-leave-guard, ReadOnlyField
    ├── pages/PrintersPage.tsx + printers/{printer-form.ts, PrinterSheet.tsx}
    ├── pages/MaterialsPage.tsx + materials/{material-form.ts, MaterialSheet.tsx}
    ├── pages/ClientsPage.tsx, ClientDetailPage.tsx + clients/{client-form.ts, ClientFields.tsx, ClientSheet.tsx}
    ├── pages/SettingsPage.tsx + settings/{settings-form.ts, LogoField.tsx}
    ├── pages/StaffPage.tsx, AccountPage.tsx
    └── test/fake-db.ts, fixtures.ts     # + fake-supabase.ts, render-app.tsx updated
```

---

### Task 1: `list_staff()` database function

**Files:**
- Create: `supabase/tests/database/10_list_staff.test.sql`
- Modify: `supabase/schemas/01_staff.sql` (append), `supabase/schemas/90_grants.sql` (staff block)
- Create (generated): `supabase/migrations/<timestamp>_list_staff.sql`
- Create: `supabase/migrations/<timestamp>_list_staff_setup.sql`

**Interfaces:**
- Produces: `public.list_staff() returns table (user_id uuid, display_name text, email text, role text, language text,
  active boolean, created_at timestamptz)`, callable by `authenticated`. It raises `42501 owner_required` unless the
  caller is an active owner.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/10_list_staff.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'owner.ls@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'operator.ls@test.local'),
  ('00000000-0000-4000-8000-0000000000b3', 'outsider.ls@test.local'),
  ('00000000-0000-4000-8000-0000000000b4', 'inactive.ls@test.local');
insert into public.staff (user_id, display_name, role, active) values
  ('00000000-0000-4000-8000-0000000000b1', 'Ada Owner', 'owner', true),
  ('00000000-0000-4000-8000-0000000000b2', 'Bea Operator', 'operator', true),
  ('00000000-0000-4000-8000-0000000000b4', 'Cleo Inactive', 'owner', false);

-- Owner
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from public.list_staff()),
  (select count(*)::int from public.staff),
  'an owner gets every staff row'
);
select results_eq(
  $$select display_name, email, role, active from public.list_staff()
    where user_id in ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2',
                      '00000000-0000-4000-8000-0000000000b4')
    order by display_name$$,
  $$values ('Ada Owner'::text, 'owner.ls@test.local'::text, 'owner'::text, true),
           ('Bea Operator', 'operator.ls@test.local', 'operator', true),
           ('Cleo Inactive', 'inactive.ls@test.local', 'owner', false)$$,
  'rows carry the login email, role and active flag'
);
select is(
  array(select display_name from public.list_staff()),
  array(select display_name from public.staff order by display_name, user_id),
  'rows are ordered by display name'
);

-- Operator
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok($$select * from public.list_staff()$$, '42501', 'owner_required', 'operators cannot list staff');

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}';
select throws_ok(
  $$select * from public.list_staff()$$, '42501', 'owner_required', 'users without a staff row cannot list staff'
);

-- Inactive owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}';
select throws_ok($$select * from public.list_staff()$$, '42501', 'owner_required', 'inactive owners cannot list staff');

-- Anonymous
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select * from public.list_staff()$$, '42501', null, 'anon cannot call list_staff');
select ok(
  not has_function_privilege('anon', 'private.list_staff()', 'execute'),
  'anon cannot execute the private function'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db`
Expected: `10_list_staff.test.sql` FAILS with `function public.list_staff() does not exist`; every other file passes.

- [ ] **Step 3: Add the functions to the declarative schema**

Append to `supabase/schemas/01_staff.sql`:

```sql

-- The staff list with login emails, for the owner's Staff screen. auth.users isn't exposed through the API.
create or replace function private.list_staff()
returns table (
  user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamptz
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
  select s.user_id, s.display_name, u.email::text, s.role, s.language, s.active, s.created_at
  from public.staff s
  join auth.users u on u.id = s.user_id
  order by s.display_name, s.user_id;
end;
$$;

create or replace function public.list_staff()
returns table (
  user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_staff();
$$;
```

In `supabase/schemas/90_grants.sql`, extend the `-- staff` block so it reads:

```sql
-- staff
grant insert on public.staff to authenticated;
grant execute on function private.is_staff(), private.is_owner() to authenticated;
grant execute on function public.list_staff(), private.list_staff() to authenticated;
```

- [ ] **Step 4: Generate the migration and add the grants migration**

Run: `supabase db diff -f list_staff`
Expected: a new file `supabase/migrations/<timestamp>_list_staff.sql` creating both functions (no other changes). Open it
and check it contains only the two `create or replace function` statements (plus Supabase's header lines).

Run: `supabase migration new list_staff_setup`, then put this in the created file:

```sql
-- Function grants for list_staff, mirrored in supabase/schemas/90_grants.sql. New functions in private are executable
-- by PUBLIC by default, so every grant is revoked before granting authenticated.
revoke execute on function public.list_staff(), private.list_staff() from public, anon, authenticated;
grant execute on function public.list_staff(), private.list_staff() to authenticated;
```

- [ ] **Step 5: Rebuild and run the tests**

Run: `supabase db reset` then `supabase test db`
Expected: all files pass, including `10_list_staff.test.sql` (8 tests) and `01_structure.test.sql` (anon can execute no
function).

Run: `supabase db diff`
Expected: `No schema changes found`

Run: `supabase db advisors --local`
Expected: no new findings for `list_staff`.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas/01_staff.sql supabase/schemas/90_grants.sql supabase/migrations supabase/tests/database/10_list_staff.test.sql
git commit -m "feat(db): add owner-only list_staff() returning staff with login emails"
```

---

### Task 2: Generated types and typed client

**Files:**
- Create: `apps/web/scripts/gen-types.mjs`
- Create (generated): `apps/web/src/lib/database.types.ts`
- Create: `apps/web/src/lib/database-types.test.ts`
- Modify: `apps/web/package.json`, `package.json` (scripts), `apps/web/eslint.config.js`, `apps/web/src/lib/supabase.ts`,
  `apps/web/src/app/AppProviders.tsx`, `apps/web/src/test/fake-supabase.ts`

**Interfaces:**
- Consumes: `public.list_staff()` from Task 1 (must be in the local database).
- Produces:
  - `Database`, `Tables<'x'>`, `TablesInsert<'x'>`, `TablesUpdate<'x'>` from `@/lib/database.types`;
  - `type AppSupabaseClient = SupabaseClient<Database>` from `@/lib/supabase`; `useSupabase(): AppSupabaseClient`.

- [ ] **Step 1: Write the failing type test**

Create `apps/web/src/lib/database-types.test.ts`:

```ts
import { expectTypeOf, test } from 'vitest'
import type { Database, Tables } from './database.types'
import type { AppSupabaseClient } from './supabase'

// Checked by `tsc -b` (npm run build); at runtime these assertions are no-ops.
test('the client is typed from the generated schema', () => {
  expectTypeOf<Tables<'printers'>['hourly_rate']>().toEqualTypeOf<number>()
  expectTypeOf<Database['public']['Functions']['list_staff']['Returns'][number]['email']>().toEqualTypeOf<string>()
  expectTypeOf<AppSupabaseClient>().toHaveProperty('rpc')
})
```

- [ ] **Step 2: Run the build to verify it fails**

Run: `npm run build`
Expected: FAIL with `Cannot find module './database.types'` and `Module './supabase' has no exported member 'AppSupabaseClient'`.

- [ ] **Step 3: Add the generator script and scripts**

Create `apps/web/scripts/gen-types.mjs`:

```js
// Regenerates src/lib/database.types.ts from the local Supabase database (`supabase start` must be running).
// With --check it writes nothing and fails when the committed file is out of date.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as prettier from 'prettier'

const webRoot = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(webRoot, '../..')
const target = path.join(webRoot, 'src/lib/database.types.ts')

const raw = execSync('supabase gen types typescript --local', {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
const options = (await prettier.resolveConfig(target)) ?? {}
const formatted = await prettier.format(raw, { ...options, filepath: target })

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : ''
  if (current !== formatted) {
    console.error('src/lib/database.types.ts is out of date: run `npm run gen:types`.')
    process.exit(1)
  }
  console.log('src/lib/database.types.ts is up to date.')
} else {
  writeFileSync(target, formatted)
  console.log('Wrote src/lib/database.types.ts')
}
```

In `apps/web/package.json` `scripts`, add after `"format:check"`:

```json
    "gen:types": "node scripts/gen-types.mjs",
    "check:types-fresh": "node scripts/gen-types.mjs --check"
```

In the root `package.json` `scripts`, add after `"format:check"`:

```json
    "gen:types": "npm run gen:types --workspace @3d-quote/web --",
    "check:types-fresh": "npm run check:types-fresh --workspace @3d-quote/web --"
```

In `apps/web/eslint.config.js`, change the ignore line to:

```js
  globalIgnores(['dist', 'coverage', 'src/lib/database.types.ts']),
```

- [ ] **Step 4: Generate the types**

Run: `npm run gen:types`
Expected: `Wrote src/lib/database.types.ts`. The file contains `list_staff` under `Functions`.

Run: `npm run check:types-fresh`
Expected: `src/lib/database.types.ts is up to date.`

- [ ] **Step 5: Type the client**

Replace `apps/web/src/lib/supabase.ts` with:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'

export type AppSupabaseClient = SupabaseClient<Database>

let cached: { key: string; client: AppSupabaseClient } | null = null

/**
 * One client per configuration: StrictMode runs state initialisers twice in development, and two
 * clients would share the same auth storage key.
 */
export function getSupabaseClient(env: SupabaseEnv): AppSupabaseClient {
  const key = `${env.url}|${env.publishableKey}`
  if (cached?.key !== key) {
    cached = { key, client: createClient<Database>(env.url, env.publishableKey) }
  }
  return cached.client
}

export const SupabaseContext = createContext<AppSupabaseClient | null>(null)

export function useSupabase(): AppSupabaseClient {
  const client = useContext(SupabaseContext)
  if (!client) throw new Error('useSupabase must be used inside <SupabaseContext>')
  return client
}
```

In `apps/web/src/app/AppProviders.tsx`:
- delete the line `import type { SupabaseClient } from '@supabase/supabase-js'`;
- change `import { SupabaseContext } from '@/lib/supabase'` to
  `import { SupabaseContext, type AppSupabaseClient } from '@/lib/supabase'`;
- change the prop type `client: SupabaseClient` to `client: AppSupabaseClient`.

In `apps/web/src/test/fake-supabase.ts`:
- change the first import line to `import type { AuthChangeEvent, Session } from '@supabase/supabase-js'`;
- add `import type { AppSupabaseClient } from '@/lib/supabase'`;
- change the last line of `createFakeSupabase` to `return { client: { auth } as unknown as AppSupabaseClient, auth }`.

- [ ] **Step 6: Verify**

Run: `npm run build && npm run lint && npm test && npm run format:check`
Expected: all pass. If `format:check` flags files, run `npm run format` and re-check.

- [ ] **Step 7: Commit**

```bash
git add package.json apps/web/package.json apps/web/eslint.config.js apps/web/scripts apps/web/src/lib apps/web/src/app/AppProviders.tsx apps/web/src/test/fake-supabase.ts
git commit -m "feat(web): generate database types and type the Supabase client"
```

---

### Task 3: Fake query builder and test fixtures

**Files:**
- Create: `apps/web/src/test/fake-db.ts`, `apps/web/src/test/fake-db.test.ts`, `apps/web/src/test/fixtures.ts`
- Modify: `apps/web/src/test/fake-supabase.ts`, `apps/web/src/test/render-app.tsx`, `apps/web/src/lib/query-client.ts`

**Interfaces:**
- Consumes: `Tables<'x'>` (Task 2), `AppSupabaseClient` (Task 2).
- Produces:
  - `class FakeDb` with:
    - `from(table)`, `rpc(fn, args?)`, `storage.from(bucket)`;
    - `calls(table): DbCall[]`, `rpcCalls(fn): unknown[]`, `storageCalls(bucket): StorageCall[]`;
    - `failNext(target, failure)`, `table(name): Row[]`.
  - `type DbCall = { op: 'select' | 'insert' | 'update' | 'delete'; filters: Filter[]; values?: unknown }`.
  - `type Filter = ['eq', column, value] | ['ilike', column, pattern] | ['or', expression]`.
  - `NETWORK_FAILURE: DbFailure`.
  - `renderApp(path, { session?, signInError?, pendingSession?, staff?, tables?, rpc? })` returns
    `{ client, auth, db, router, user }`. `staff` defaults to `ownerStaff`; `null` means no staff row. A `settings` row is
    seeded by default.
  - Fixtures: `ownerStaff`, `operatorStaff`, `settingsRow`, `printerRow(o?)`, `materialRow(o?)`, `clientRow(o?)`,
    `quoteRow(o?)`.
  - `createQueryClient({ retry? })`.
  - `auth.updateUser` (a `vi.fn`) on the fake.

- [ ] **Step 1: Write the failing tests for the fake**

Create `apps/web/src/test/fake-db.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { FakeDb, NETWORK_FAILURE } from './fake-db'

const seed = () =>
  new FakeDb({
    printers: [
      { id: 1, name: 'MK4', active: true },
      { id: 2, name: 'X1C', active: false },
    ],
  })

describe('from()', () => {
  test('select filters, orders and records the call', async () => {
    const db = seed()
    const { data, error } = await db.from('printers').select('*').eq('active', true).order('name')
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 1, name: 'MK4', active: true }])
    expect(db.calls('printers')).toEqual([{ op: 'select', filters: [['eq', 'active', true]] }])
  })

  test('order descending and limit', async () => {
    const { data } = await seed().from('printers').select('*').order('name', { ascending: false }).limit(1)
    expect(data).toEqual([{ id: 2, name: 'X1C', active: false }])
  })

  test('ilike and or match case-insensitively', async () => {
    const db = seed()
    expect((await db.from('printers').select('*').ilike('name', '%mk%')).data).toHaveLength(1)
    const { data } = await db.from('printers').select('*').or('name.ilike.%x1%,name.ilike.%zz%')
    expect(data).toEqual([{ id: 2, name: 'X1C', active: false }])
  })

  test('insert assigns the next id and returns the row', async () => {
    const db = seed()
    const { data } = await db.from('printers').insert({ name: 'New' }).select().single()
    expect(data).toEqual({ id: 3, name: 'New' })
    expect(db.table('printers')).toHaveLength(3)
    expect(db.calls('printers')).toContainEqual({ op: 'insert', values: { name: 'New' }, filters: [] })
  })

  test('update changes matching rows', async () => {
    const db = seed()
    const { data } = await db.from('printers').update({ active: true }).eq('id', 2).select().single()
    expect(data).toEqual({ id: 2, name: 'X1C', active: true })
    expect(db.calls('printers')).toContainEqual({
      op: 'update',
      values: { active: true },
      filters: [['eq', 'id', 2]],
    })
  })

  test('single with no match fails with PGRST116, maybeSingle returns null', async () => {
    const db = seed()
    const single = await db.from('printers').update({ name: 'x' }).eq('id', 9).select().single()
    expect(single.error?.code).toBe('PGRST116')
    const maybe = await db.from('printers').select('*').eq('id', 9).maybeSingle()
    expect(maybe).toMatchObject({ data: null, error: null })
  })

  test('delete removes rows and returns them when selected', async () => {
    const db = seed()
    const { data } = await db.from('printers').delete().eq('id', 1).select('id')
    expect(data).toEqual([{ id: 1, name: 'MK4', active: true }])
    expect(db.table('printers')).toHaveLength(1)
  })

  test('failNext fails only the next request to that table', async () => {
    const db = seed()
    db.failNext('printers', NETWORK_FAILURE)
    expect((await db.from('printers').select('*')).error?.message).toBe('TypeError: Failed to fetch')
    expect((await db.from('printers').select('*')).error).toBeNull()
  })
})

describe('rpc() and storage', () => {
  test('rpc calls the handler and records arguments', async () => {
    const db = new FakeDb({}, { list_staff: () => [{ user_id: 'u' }] })
    expect((await db.rpc('list_staff')).data).toEqual([{ user_id: 'u' }])
    expect(db.rpcCalls('list_staff')).toEqual([undefined])
    expect((await db.rpc('missing')).error?.code).toBe('PGRST202')
  })

  test('storage records uploads, removals and signed URLs', async () => {
    const db = new FakeDb()
    const bucket = db.storage.from('branding')
    expect((await bucket.upload('logo.png', new Blob(['x']))).data).toEqual({ path: 'logo.png' })
    await bucket.remove(['old.png'])
    expect((await bucket.createSignedUrl('logo.png', 3600)).data).toEqual({
      signedUrl: 'https://storage.test/branding/logo.png',
    })
    expect(db.storageCalls('branding')).toEqual([
      { op: 'upload', paths: ['logo.png'] },
      { op: 'remove', paths: ['old.png'] },
      { op: 'createSignedUrl', paths: ['logo.png'] },
    ])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/test/fake-db.test.ts`
Expected: FAIL with `Failed to resolve import "./fake-db"`.

- [ ] **Step 3: Implement the fake database**

Create `apps/web/src/test/fake-db.ts`:

```ts
import type { PostgrestError } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
export type Filter = ['eq', string, unknown] | ['ilike', string, string] | ['or', string]
export type DbOp = 'select' | 'insert' | 'update' | 'delete'
export type DbCall = { op: DbOp; filters: Filter[]; values?: unknown }
export type StorageCall = { op: 'upload' | 'remove' | 'createSignedUrl'; paths: string[] }
export type DbFailure = { code: string; message: string }

/** What supabase-js returns when the request never reaches the server. */
export const NETWORK_FAILURE: DbFailure = { code: '', message: 'TypeError: Failed to fetch' }

type Result = { data: unknown; error: PostgrestError | null; count: null; status: number; statusText: string }

function result(data: unknown, error: PostgrestError | null, status: number): Result {
  return { data, error, count: null, status, statusText: '' }
}

function postgrestError(failure: DbFailure): PostgrestError {
  return { ...failure, details: '', hint: '', name: 'PostgrestError' } as PostgrestError
}

function likeToRegExp(pattern: string) {
  const escaped = pattern.split('%').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${escaped.join('.*')}$`, 'i')
}

function matches(row: Row, filter: Filter): boolean {
  if (filter[0] === 'eq') return row[filter[1]] === filter[2]
  if (filter[0] === 'ilike') return likeToRegExp(filter[2]).test(String(row[filter[1]] ?? ''))
  return filter[1].split(',').some((part) => {
    const [column, op, ...rest] = part.split('.')
    const value = rest.join('.')
    return op === 'ilike' ? matches(row, ['ilike', column, value]) : String(row[column]) === value
  })
}

function compare(a: unknown, b: unknown) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''))
}

/** A chainable stand-in for a PostgREST query; awaiting it runs the query against the FakeDb. */
class FakeQuery implements PromiseLike<Result> {
  private readonly db: FakeDb
  private readonly tableName: string
  private op: DbOp = 'select'
  private values: unknown = undefined
  private filters: Filter[] = []
  private sort: { column: string; ascending: boolean } | null = null
  private max: number | null = null
  private returning = false
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'

  constructor(db: FakeDb, tableName: string) {
    this.db = db
    this.tableName = tableName
  }

  /** Columns and embeds are not interpreted: rows come back as seeded (seed embedded fields directly). */
  select(_columns?: string) {
    if (this.op !== 'select') this.returning = true
    return this
  }
  insert(values: Row | Row[]) {
    this.op = 'insert'
    this.values = values
    return this
  }
  update(values: Row) {
    this.op = 'update'
    this.values = values
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push(['eq', column, value])
    return this
  }
  ilike(column: string, pattern: string) {
    this.filters.push(['ilike', column, pattern])
    return this
  }
  or(expression: string) {
    this.filters.push(['or', expression])
    return this
  }
  /** Ordering inside an embedded resource (`referencedTable`) is the seed's job, so it is ignored here. */
  order(column: string, options: { ascending?: boolean; referencedTable?: string } = {}) {
    if (!options.referencedTable) this.sort = { column, ascending: options.ascending ?? true }
    return this
  }
  limit(count: number, options: { referencedTable?: string } = {}) {
    if (!options.referencedTable) this.max = count
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybeSingle'
    return this
  }

  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onFulfilled, onRejected)
  }

  private run(): Result {
    const call: DbCall = { op: this.op, filters: this.filters }
    if (this.values !== undefined) call.values = this.values
    this.db.record(this.tableName, call)
    const failure = this.db.takeFailure(this.tableName)
    if (failure) return result(null, postgrestError(failure), 400)

    const rows = this.db.table(this.tableName)
    const matching = () => rows.filter((row) => this.filters.every((f) => matches(row, f)))
    let affected: Row[]
    if (this.op === 'insert') {
      const list = (Array.isArray(this.values) ? this.values : [this.values]) as Row[]
      affected = list.map((values) => ({ id: this.db.nextId(this.tableName), ...values }))
      rows.push(...affected)
    } else if (this.op === 'update') {
      affected = matching()
      affected.forEach((row) => Object.assign(row, this.values))
    } else if (this.op === 'delete') {
      affected = matching()
      this.db.replace(
        this.tableName,
        rows.filter((row) => !affected.includes(row)),
      )
    } else {
      affected = matching()
      const sort = this.sort
      if (sort) {
        affected.sort((a, b) => compare(a[sort.column], b[sort.column]) * (sort.ascending ? 1 : -1))
      }
      if (this.max !== null) affected = affected.slice(0, this.max)
    }

    const data = affected.map((row) => ({ ...row }))
    if (this.op !== 'select' && !this.returning) return result(null, null, 204)
    if (this.mode === 'many') return result(data, null, 200)
    if (data.length === 1) return result(data[0], null, 200)
    if (data.length === 0 && this.mode === 'maybeSingle') return result(null, null, 200)
    return result(
      null,
      postgrestError({ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }),
      406,
    )
  }
}

/** In-memory tables behind the fake Supabase client. Records every request so tests can assert on them. */
export class FakeDb {
  private tables: Record<string, Row[]>
  private readonly rpcs: Record<string, (args: unknown) => unknown>
  private readonly failures = new Map<string, DbFailure[]>()
  private readonly log: { table: string; call: DbCall }[] = []
  private readonly rpcLog: { fn: string; args: unknown }[] = []
  private readonly storageLog: { bucket: string; call: StorageCall }[] = []

  constructor(
    tables: Record<string, Row[]> = {},
    rpcs: Record<string, (args: unknown) => unknown> = {},
  ) {
    this.tables = Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
    )
    this.rpcs = rpcs
  }

  from(table: string) {
    return new FakeQuery(this, table)
  }

  async rpc(fn: string, args?: unknown) {
    this.rpcLog.push({ fn, args })
    const failure = this.takeFailure(fn)
    if (failure) return result(null, postgrestError(failure), 400)
    const handler = this.rpcs[fn]
    if (!handler) {
      return result(
        null,
        postgrestError({ code: 'PGRST202', message: `Could not find the function public.${fn}` }),
        404,
      )
    }
    return result(handler(args), null, 200)
  }

  readonly storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _file: Blob, _options?: unknown) =>
        this.storageOp(bucket, { op: 'upload', paths: [path] }, { path }),
      remove: async (paths: string[]) => this.storageOp(bucket, { op: 'remove', paths }, []),
      createSignedUrl: async (path: string, _expiresIn: number) =>
        this.storageOp(
          bucket,
          { op: 'createSignedUrl', paths: [path] },
          { signedUrl: `https://storage.test/${bucket}/${path}` },
        ),
    }),
  }

  /** The next request to `target` (a table, an rpc function name or `storage:<bucket>`) fails with `failure`. */
  failNext(target: string, failure: DbFailure) {
    this.failures.set(target, [...(this.failures.get(target) ?? []), failure])
  }

  calls(table: string): DbCall[] {
    return this.log.filter((entry) => entry.table === table).map((entry) => entry.call)
  }

  rpcCalls(fn: string): unknown[] {
    return this.rpcLog.filter((entry) => entry.fn === fn).map((entry) => entry.args)
  }

  storageCalls(bucket: string): StorageCall[] {
    return this.storageLog.filter((entry) => entry.bucket === bucket).map((entry) => entry.call)
  }

  table(name: string): Row[] {
    return (this.tables[name] ??= [])
  }

  /** @internal used by FakeQuery */
  replace(name: string, rows: Row[]) {
    this.tables[name] = rows
  }

  /** @internal used by FakeQuery */
  record(table: string, call: DbCall) {
    this.log.push({ table, call })
  }

  /** @internal used by FakeQuery */
  takeFailure(target: string) {
    return this.failures.get(target)?.shift()
  }

  /** @internal used by FakeQuery */
  nextId(name: string) {
    const ids = this.table(name)
      .map((row) => row.id)
      .filter((id): id is number => typeof id === 'number')
    return ids.length ? Math.max(...ids) + 1 : 1
  }

  private storageOp(bucket: string, call: StorageCall, data: unknown) {
    this.storageLog.push({ bucket, call })
    const failure = this.takeFailure(`storage:${bucket}`)
    if (failure) return { data: null, error: { name: 'StorageError', message: failure.message } }
    return { data, error: null }
  }
}
```

Parameters starting with `_` mirror the real signatures. `noUnusedParameters` ignores them, but if ESLint's
`@typescript-eslint/no-unused-vars` flags them, add `// eslint-disable-next-line @typescript-eslint/no-unused-vars`
on the line above each signature rather than changing the signature.

- [ ] **Step 4: Run the fake's tests**

Run: `npm test -- src/test/fake-db.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Add fixtures, wire the fake into the client and renderApp**

Create `apps/web/src/test/fixtures.ts`:

```ts
import type { Tables } from '@/lib/database.types'

const CREATED = '2026-01-01T09:00:00Z'
let nextId = 100

export const ownerStaff: Tables<'staff'> = {
  user_id: 'user-1',
  display_name: 'Anna Rossi',
  role: 'owner',
  language: 'it',
  active: true,
  created_at: CREATED,
  updated_at: CREATED,
}

export const operatorStaff: Tables<'staff'> = {
  ...ownerStaff,
  display_name: 'Otto Bianchi',
  role: 'operator',
}

export const settingsRow: Tables<'settings'> = {
  id: 1,
  currency: 'EUR',
  energy_price_kwh: 0.3,
  failure_allowance_pct: 5,
  setup_fee: 3,
  default_markup_pct: 40,
  minimum_item_price: 10,
  quote_prefix: 'Q',
  default_validity_days: 30,
  pdf_terms_it: null,
  pdf_terms_en: null,
  shop_name: '3D Lab',
  shop_address: null,
  shop_vat_number: null,
  shop_email: null,
  shop_phone: null,
  shop_logo_path: null,
  created_at: CREATED,
  updated_at: CREATED,
}

export function printerRow(overrides: Partial<Tables<'printers'>> = {}): Tables<'printers'> {
  return {
    id: nextId++,
    name: 'MK4 #1',
    model: 'Prusa MK4',
    build_x_mm: 250,
    build_y_mm: 210,
    build_z_mm: 220,
    nozzle_diameter_mm: 0.4,
    hourly_rate: 1.5,
    power_w: 120,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

export function materialRow(overrides: Partial<Tables<'materials'>> = {}): Tables<'materials'> {
  return {
    id: nextId++,
    name: 'Prusament PLA',
    type: 'PLA',
    color: 'Black',
    density_g_cm3: 1.24,
    cost_per_kg: 25,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

/** A client row as the clients list query returns it, embedded quote count and newest quote included. */
export function clientRow(
  overrides: Partial<Tables<'clients'>> & { quoteCount?: number; lastQuoteAt?: string | null } = {},
) {
  const { quoteCount = 0, lastQuoteAt = null, ...rest } = overrides
  return {
    id: nextId++,
    name: 'Mario Rossi',
    company: 'Rossi Meccanica',
    email: 'mario@example.com',
    phone: null,
    notes: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    quote_count: [{ count: quoteCount }],
    last_quote: lastQuoteAt ? [{ created_at: lastQuoteAt }] : [],
  }
}

export function quoteRow(overrides: Partial<Tables<'quotes'>> = {}): Tables<'quotes'> {
  return {
    id: nextId++,
    number: 'Q-2026-0001',
    number_year: 2026,
    number_seq: 1,
    client_id: 1,
    status: 'draft',
    valid_until: '2026-11-11',
    notes: null,
    created_by: 'user-1',
    markup_override_pct: null,
    sent_at: null,
    created_at: '2026-10-12T08:00:00Z',
    updated_at: '2026-10-12T08:00:00Z',
    ...overrides,
  }
}
```

If the generated `Tables<'quotes'>` has columns this literal lacks (or the reverse), tsc names them. Add or remove them
to match `database.types.ts`.

Replace `apps/web/src/lib/query-client.ts` with:

```ts
import { QueryClient } from '@tanstack/react-query'

/** Tests pass `retry: false` so a failed query shows its error at once. */
export function createQueryClient({ retry = 1 }: { retry?: number | false } = {}) {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry } },
  })
}
```

In `apps/web/src/test/fake-supabase.ts`, make these changes:
- Add the import `import { FakeDb } from './fake-db'`.
- Change the options type of `createFakeSupabase` to:

  ```ts
  opts: {
    session?: Session | null
    signInError?: SignInFailure
    pendingSession?: boolean
    db?: FakeDb
  } = {},
  ```

- Add this member to the `auth` object, after `resetPasswordForEmail`:

  ```ts
    updateUser: vi.fn(async (_attributes: { password?: string }) => ({
      data: { user: current?.user ?? null },
      error: null as null | { code: string; message: string },
    })),
  ```

- Replace the `return` line with:

  ```ts
  const db = opts.db ?? new FakeDb()
  const client = {
    auth,
    from: (table: string) => db.from(table),
    rpc: (fn: string, args?: unknown) => db.rpc(fn, args),
    storage: db.storage,
  }
  return { client: client as unknown as AppSupabaseClient, auth, db }
  ```

Replace `apps/web/src/test/render-app.tsx` with:

```tsx
import type { Session } from '@supabase/supabase-js'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/AppProviders'
import { routes } from '@/app/routes'
import type { Tables } from '@/lib/database.types'
import { createQueryClient } from '@/lib/query-client'
import { FakeDb, type Row } from './fake-db'
import { createFakeSupabase, type SignInFailure } from './fake-supabase'
import { ownerStaff, settingsRow } from './fixtures'

export type RenderAppOptions = {
  session?: Session | null
  signInError?: SignInFailure
  pendingSession?: boolean
  /** The signed-in user's (`user-1`) staff row. Defaults to an owner; `null` means no staff record. */
  staff?: Tables<'staff'> | null
  /** Rows per table. A settings row is seeded unless `tables.settings` is given. */
  tables?: Record<string, Row[]>
  rpc?: Record<string, (args: unknown) => unknown>
}

export function renderApp(path: string, opts: RenderAppOptions = {}) {
  const staff = opts.staff === undefined ? ownerStaff : opts.staff
  const tables = opts.tables ?? {}
  const db = new FakeDb(
    {
      settings: [settingsRow],
      ...tables,
      staff: [...(staff ? [staff] : []), ...(tables.staff ?? [])],
    },
    opts.rpc,
  )
  const fake = createFakeSupabase({ ...opts, db })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  render(
    <AppProviders client={fake.client} queryClient={createQueryClient({ retry: false })}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...fake, router, user }
}
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run build && npm run lint`
Expected: all pass. The existing auth and routes tests still pass, because the fake now also answers `from()` calls.

- [ ] **Step 7: Commit**

```bash
npm run format
git add apps/web/src/test apps/web/src/lib/query-client.ts
git commit -m "test(web): add a recording fake query builder and fixtures to renderApp"
```

---

### Task 4: Errors, formatting and form helpers

**Files:**
- Create: `apps/web/src/data/errors.ts`, `apps/web/src/data/errors.test.ts`
- Create: `apps/web/src/data/query-keys.ts`, `apps/web/src/data/settings.ts`
- Create: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/lib/use-format.ts`
- Create: `apps/web/src/lib/forms.ts`, `apps/web/src/lib/forms.test.ts`
- Modify: `apps/web/package.json` (zod), `apps/web/src/i18n/locales/it.json`, `en.json`

**Interfaces:**
- Produces:
  - `class AppError extends Error { kind: AppErrorKind; field?: string; messageKey: string }`, where
    `AppErrorKind = 'duplicate' | 'inUse' | 'invalid' | 'forbidden' | 'lastOwner' | 'notFound' | 'network' | 'unknown'`.
    The constructor is `new AppError(kind, { field?, messageKey?, cause? })`.
  - `toAppError(error: unknown): AppError`.
  - `queryKeys` (see code).
  - `useSettings()`; `type Settings = Tables<'settings'>`.
  - Formatting:
    - `type Locale = 'it-IT' | 'en-GB'`, `localeFor(language)`;
    - `formatNumber(value, locale, decimals?)`, `formatCurrency(value, locale, currency)`, `formatDate(value, locale)`;
    - `toInputNumber(value, locale, decimals?)`;
    - `useFormat(): { locale, number(v, decimals?), currency(v), date(v) }`.
  - Form helpers:
    - `parseDecimal(text): number | null`;
    - `numberField(rule: NumberRule)`;
    - `requiredText(max?)`, `optionalEmail`, `nullIfEmpty(text)`.

- [ ] **Step 1: Install zod**

Run: `npm install zod --workspace @3d-quote/web`
Expected: `zod` (4.x) appears under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/data/errors.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { AppError, toAppError } from './errors'

describe('toAppError', () => {
  test.each([
    [{ code: '23503', message: 'fk' }, 'inUse'],
    [{ code: '23514', message: 'check' }, 'invalid'],
    [{ code: '22P02', message: 'invalid input syntax' }, 'invalid'],
    [{ code: '42501', message: 'owner_required' }, 'forbidden'],
    [{ code: 'P0001', message: 'last_owner' }, 'lastOwner'],
    [{ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }, 'notFound'],
    [{ code: '', message: 'TypeError: Failed to fetch' }, 'network'],
    [{ code: 'P0001', message: 'quote_not_draft' }, 'unknown'],
    [{ code: 'XX000', message: 'boom' }, 'unknown'],
    ['not an error object', 'unknown'],
  ])('%o → %s', (error, kind) => {
    expect(toAppError(error).kind).toBe(kind)
  })

  test('a duplicate names the field from the constraint', () => {
    const error = toAppError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "printers_name_key"',
    })
    expect(error).toMatchObject({ kind: 'duplicate', field: 'name', messageKey: 'errors.duplicate' })
  })

  test('a thrown TypeError is a network error', () => {
    expect(toAppError(new TypeError('Failed to fetch')).kind).toBe('network')
  })

  test('an AppError passes through unchanged', () => {
    const error = new AppError('invalid', { messageKey: 'account.password.weak' })
    expect(toAppError(error)).toBe(error)
  })
})
```

Create `apps/web/src/lib/format.test.ts`:

```ts
import { expect, test } from 'vitest'
import { formatCurrency, formatDate, formatNumber, localeFor, toInputNumber } from './format'

// Intl uses non-breaking spaces; compare with plain ones.
const plain = (text: string) => text.replace(/\s/g, ' ')

test('localeFor maps the UI language', () => {
  expect(localeFor('it')).toBe('it-IT')
  expect(localeFor('en')).toBe('en-GB')
})

test('numbers use the locale separators', () => {
  expect(formatNumber(1234.5, 'it-IT')).toBe('1234,5')
  expect(formatNumber(12345.5, 'it-IT')).toBe('12.345,5')
  expect(formatNumber(0.4, 'it-IT', 2)).toBe('0,40')
  expect(formatNumber(0.4, 'en-GB', 2)).toBe('0.40')
})

test('currency follows the locale', () => {
  expect(plain(formatCurrency(1.5, 'it-IT', 'EUR'))).toBe('1,50 €')
  expect(formatCurrency(1.5, 'en-GB', 'EUR')).toBe('€1.50')
})

test('dates are dd/mm/yyyy; date-only values never shift a day', () => {
  expect(formatDate('2026-11-01', 'it-IT')).toBe('01/11/2026')
  expect(formatDate('2026-11-01', 'en-GB')).toBe('01/11/2026')
  // 23:30 UTC on 31 Oct is already 1 Nov in Rome.
  expect(formatDate('2026-10-31T23:30:00Z', 'it-IT')).toBe('01/11/2026')
})

test('toInputNumber writes numbers the way the user types them', () => {
  expect(toInputNumber(0.4, 'it-IT', 2)).toBe('0,40')
  expect(toInputNumber(0.4, 'en-GB', 2)).toBe('0.40')
  expect(toInputNumber(250, 'it-IT')).toBe('250')
  expect(toInputNumber(null, 'it-IT')).toBe('')
})
```

Italian groups thousands only from five digits (`1234,5` but `12.345,5`): that is Node's ICU output, checked while
writing this plan.

Create `apps/web/src/lib/forms.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { numberField, optionalEmail, parseDecimal, requiredText } from './forms'

const firstError = (schema: { safeParse: (v: unknown) => { error?: { issues: { message: string }[] } } }, value: unknown) =>
  schema.safeParse(value).error?.issues[0]?.message

describe('parseDecimal', () => {
  test.each([
    ['0,40', 0.4],
    ['0.40', 0.4],
    [' 12 ', 12],
    ['2,5', 2.5],
    ['-1', -1],
  ])('%s → %s', (text, value) => expect(parseDecimal(text)).toBe(value))

  test.each(['', 'abc', '1.2.3', '1,2,3', '1e3', '12a'])('rejects %j', (text) =>
    expect(parseDecimal(text)).toBeNull(),
  )
})

describe('numberField', () => {
  const nozzle = numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' })

  test('accepts a valid value in either locale', () => {
    expect(nozzle.safeParse('0,40').success).toBe(true)
    expect(nozzle.safeParse('0.4').success).toBe(true)
  })
  test('reports required, number, decimals and range in that order', () => {
    expect(firstError(nozzle, '')).toBe('validation.required')
    expect(firstError(nozzle, 'abc')).toBe('validation.number')
    expect(firstError(nozzle, '0,123')).toBe('validation.decimals2')
    expect(firstError(nozzle, '0')).toBe('validation.positive')
  })
  test('integers and inclusive ranges', () => {
    const days = numberField({ min: 1, max: 365, decimals: 0, rangeError: 'validation.validityDays' })
    expect(firstError(days, '1,5')).toBe('validation.integer')
    expect(firstError(days, '366')).toBe('validation.validityDays')
    expect(days.safeParse('365').success).toBe(true)
  })
  test('optional fields accept empty text', () => {
    expect(numberField({ min: 0, decimals: 2, rangeError: 'x', optional: true }).safeParse('').success).toBe(true)
  })
})

test('requiredText trims and limits length', () => {
  expect(firstError(requiredText(), '   ')).toBe('validation.required')
  expect(firstError(requiredText(3), 'abcd')).toBe('validation.tooLong')
})

test('optionalEmail allows empty text but not a bad address', () => {
  expect(optionalEmail.safeParse('').success).toBe(true)
  expect(optionalEmail.safeParse('anna@example.com').success).toBe(true)
  expect(firstError(optionalEmail, 'anna@')).toBe('validation.email')
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/data/errors.test.ts src/lib/format.test.ts src/lib/forms.test.ts`
Expected: FAIL: the three modules can't be resolved.

- [ ] **Step 4: Implement errors, keys, formatting and form helpers**

Create `apps/web/src/data/errors.ts`:

```ts
export type AppErrorKind =
  | 'duplicate'
  | 'inUse'
  | 'invalid'
  | 'forbidden'
  | 'lastOwner'
  | 'notFound'
  | 'network'
  | 'unknown'

/** A failed request reduced to what the UI needs to explain it. `messageKey` is an i18n key. */
export class AppError extends Error {
  readonly kind: AppErrorKind
  readonly field?: string
  readonly messageKey: string

  constructor(
    kind: AppErrorKind,
    options: { field?: string; messageKey?: string; cause?: unknown } = {},
  ) {
    super(kind, { cause: options.cause })
    this.name = 'AppError'
    this.kind = kind
    this.field = options.field
    this.messageKey = options.messageKey ?? `errors.${kind}`
  }
}

const NETWORK_MESSAGE = /failed to fetch|networkerror|fetch failed|load failed/i

/** `duplicate key value violates unique constraint "printers_name_key"` → `name`. */
function fieldFromConstraint(message: string): string | undefined {
  const constraint = /constraint "([a-z0-9_]+)_key"/.exec(message)?.[1]
  return constraint?.split('_').slice(1).join('_') || undefined
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof TypeError) return new AppError('network', { cause: error })
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''

  switch (code) {
    case '23505':
      return new AppError('duplicate', { field: fieldFromConstraint(message), cause: error })
    case '23503':
      return new AppError('inUse', { cause: error })
    case '23514':
    case '22P02':
      return new AppError('invalid', { cause: error })
    case '42501':
      return new AppError('forbidden', { cause: error })
    case 'PGRST116':
      return new AppError('notFound', { cause: error })
    case 'P0001':
      if (message === 'last_owner') return new AppError('lastOwner', { cause: error })
      break
  }
  if (NETWORK_MESSAGE.test(message)) return new AppError('network', { cause: error })
  return new AppError('unknown', { cause: error })
}
```

Create `apps/web/src/data/query-keys.ts`:

```ts
/** TanStack Query keys. Invalidating a prefix (e.g. `queryKeys.clientsAll`) refreshes everything under it. */
export const queryKeys = {
  printers: ['printers'] as const,
  materials: ['materials'] as const,
  clientsAll: ['clients'] as const,
  clientLists: ['clients', 'list'] as const,
  clients: (search: string) => ['clients', 'list', search] as const,
  client: (id: number) => ['clients', 'detail', id] as const,
  clientQuotes: (id: number) => ['clients', 'quotes', id] as const,
  settings: ['settings'] as const,
  logoUrl: (path: string) => ['settings', 'logo', path] as const,
  staffAll: ['staff'] as const,
  ownStaff: (userId: string) => ['staff', 'own', userId] as const,
  staffList: ['staff', 'list'] as const,
}
```

Create `apps/web/src/data/settings.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Settings = Tables<'settings'>

export function useSettings() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
      if (error) throw toAppError(error)
      return data
    },
  })
}
```

Create `apps/web/src/lib/format.ts`:

```ts
export type Locale = 'it-IT' | 'en-GB'

export function localeFor(language: string): Locale {
  return language === 'en' ? 'en-GB' : 'it-IT'
}

export function formatNumber(value: number, locale: Locale, decimals?: number) {
  const options =
    decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatCurrency(value: number, locale: Locale, currency: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** dd/mm/yyyy. Date-only values are calendar dates; timestamps are shown in shop time (Europe/Rome). */
export function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: DATE_ONLY.test(value) ? 'UTC' : 'Europe/Rome',
  }).format(new Date(value))
}

/** A number as an input value, written the way the user types it: 0.4 → "0,40" in Italian. */
export function toInputNumber(value: number | null | undefined, locale: Locale, decimals?: number) {
  if (value === null || value === undefined) return ''
  const text = decimals === undefined ? String(value) : value.toFixed(decimals)
  return locale === 'it-IT' ? text.replace('.', ',') : text
}
```

Create `apps/web/src/lib/use-format.ts`:

```ts
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings } from '@/data/settings'
import { formatCurrency, formatDate, formatNumber, localeFor } from './format'

/** Formatters for the UI language, with the shop currency from settings (EUR until it loads). */
export function useFormat() {
  const { i18n } = useTranslation()
  const settings = useSettings()
  const locale = localeFor(i18n.language)
  const currency = settings.data?.currency ?? 'EUR'
  return useMemo(
    () => ({
      locale,
      number: (value: number, decimals?: number) => formatNumber(value, locale, decimals),
      currency: (value: number) => formatCurrency(value, locale, currency),
      date: (value: string) => formatDate(value, locale),
    }),
    [locale, currency],
  )
}
```

Create `apps/web/src/lib/forms.ts`:

```ts
import { z } from 'zod'

/** Parses a number typed in either locale ("0,40" or "0.40"). Null unless it is a plain decimal number. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return null
  return Number(normalized)
}

function decimalsOf(text: string) {
  return text.trim().replace(',', '.').split('.')[1]?.length ?? 0
}

export type NumberRule = {
  /** Smallest allowed value, inclusive. */
  min?: number
  /** The value must be greater than this. */
  gt?: number
  /** Largest allowed value, inclusive. */
  max?: number
  decimals: 0 | 1 | 2 | 4
  /** i18n key shown when the value is out of range. */
  rangeError: string
  optional?: boolean
}

/** A number held as text in a form, checked with the same limits as the database. Messages are i18n keys. */
export function numberField(rule: NumberRule) {
  return z.string().superRefine((raw, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    const text = raw.trim()
    if (text === '') {
      if (!rule.optional) fail('validation.required')
      return
    }
    const value = parseDecimal(text)
    if (value === null) {
      fail('validation.number')
      return
    }
    if (decimalsOf(text) > rule.decimals) {
      fail(rule.decimals === 0 ? 'validation.integer' : `validation.decimals${rule.decimals}`)
      return
    }
    const tooLow =
      (rule.min !== undefined && value < rule.min) || (rule.gt !== undefined && value <= rule.gt)
    const tooHigh = rule.max !== undefined && value > rule.max
    if (tooLow || tooHigh) fail(rule.rangeError)
  })
}

export function requiredText(max = 200) {
  return z.string().trim().min(1, 'validation.required').max(max, 'validation.tooLong')
}

export const optionalEmail = z
  .string()
  .trim()
  .refine((value) => value === '' || z.email().safeParse(value).success, 'validation.email')

/** Empty text fields are stored as null. */
export function nullIfEmpty(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}
```

Add these top-level keys to `apps/web/src/i18n/locales/it.json`, after `"config"` (remember the comma after the
`"config"` object):

```json
  "errors": {
    "duplicate": "Esiste già un elemento con questo valore.",
    "inUse": "È ancora in uso e non può essere eliminato.",
    "invalid": "Alcuni valori non sono validi.",
    "forbidden": "Non hai i permessi per questa operazione.",
    "lastOwner": "Deve esserci almeno un titolare.",
    "notFound": "L'elemento non esiste più o non puoi modificarlo.",
    "network": "Impossibile contattare il server. Controlla la connessione e riprova.",
    "unknown": "Qualcosa è andato storto. Riprova."
  },
  "validation": {
    "required": "Campo obbligatorio.",
    "tooLong": "Troppo lungo.",
    "number": "Inserisci un numero.",
    "integer": "Inserisci un numero intero.",
    "decimals1": "Al massimo 1 decimale.",
    "decimals2": "Al massimo 2 decimali.",
    "decimals4": "Al massimo 4 decimali.",
    "positive": "Deve essere maggiore di zero.",
    "nonNegative": "Non può essere negativo.",
    "percent": "Deve essere tra 0 e 100.",
    "validityDays": "Deve essere tra 1 e 365 giorni.",
    "email": "Inserisci un indirizzo email valido.",
    "currency": "Usa un codice di 3 lettere, es. EUR.",
    "quotePrefix": "Da 1 a 10 lettere o cifre.",
    "passwordLength": "Almeno 6 caratteri.",
    "passwordMismatch": "Le password non coincidono."
  }
```

And to `apps/web/src/i18n/locales/en.json`, in the same place:

```json
  "errors": {
    "duplicate": "An item with this value already exists.",
    "inUse": "It's still in use and can't be deleted.",
    "invalid": "Some values aren't valid.",
    "forbidden": "You don't have permission to do this.",
    "lastOwner": "There must be at least one owner.",
    "notFound": "This item no longer exists or you can't change it.",
    "network": "Couldn't reach the server. Check your connection and try again.",
    "unknown": "Something went wrong. Try again."
  },
  "validation": {
    "required": "Required.",
    "tooLong": "Too long.",
    "number": "Enter a number.",
    "integer": "Enter a whole number.",
    "decimals1": "At most 1 decimal place.",
    "decimals2": "At most 2 decimal places.",
    "decimals4": "At most 4 decimal places.",
    "positive": "Must be greater than zero.",
    "nonNegative": "Can't be negative.",
    "percent": "Must be between 0 and 100.",
    "validityDays": "Must be between 1 and 365 days.",
    "email": "Enter a valid email address.",
    "currency": "Use a 3-letter code, e.g. EUR.",
    "quotePrefix": "1 to 10 letters or digits.",
    "passwordLength": "At least 6 characters.",
    "passwordMismatch": "The passwords don't match."
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/data/errors.test.ts src/lib/format.test.ts src/lib/forms.test.ts src/i18n/i18n.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `npm run build && npm run lint && npm run format`
Expected: build and lint pass.

```bash
git add apps/web/package.json package-lock.json apps/web/src/data apps/web/src/lib apps/web/src/i18n/locales
git commit -m "feat(web): add error mapping, locale formatting and form validation helpers"
```

---

### Task 5: Staff profile, roles and language

**Files:**
- Create: `apps/web/src/auth/staff-context.ts`, `apps/web/src/auth/StaffProvider.tsx`, `apps/web/src/auth/RequireOwner.tsx`,
  `apps/web/src/auth/use-change-language.ts`, `apps/web/src/data/staff.ts`, `apps/web/src/auth/StaffProvider.test.tsx`
- Modify: `apps/web/src/auth/RequireAuth.tsx`, `apps/web/src/app/sections.ts`, `apps/web/src/app/routes.tsx`,
  `apps/web/src/layout/Navigation.tsx`, `apps/web/src/layout/LanguageSwitcher.tsx`,
  `apps/web/src/layout/LanguageSwitcher.test.tsx`, `apps/web/src/app/routes.test.tsx`, both locale files

**Interfaces:**
- Consumes: `toAppError` and `queryKeys` (Task 4); `renderApp({ staff })`, `operatorStaff`, `ownerStaff` and
  `NETWORK_FAILURE` (Task 3).
- Produces:
  - `type Staff = { userId: string; displayName: string; role: 'owner' | 'operator'; isOwner: boolean; language: Language }`;
  - `useStaff(): Staff`, `useOptionalStaff(): Staff | null`;
  - `<StaffProvider userId>`, `<RequireOwner>{children}</RequireOwner>`;
  - `useOwnStaff(userId)`, `useSaveOwnProfile()` taking `{ userId, display_name?, language? }`;
  - `useChangeLanguage(): { change(language): Promise<void>; saveFailed: boolean }`;
  - in `routes.tsx`, a `SECTION_PAGES` map from section path to page element (later tasks add entries).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/auth/StaffProvider.test.tsx`:

```tsx
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
```

`failNext` is called after `renderApp` on purpose. The staff query only starts once the session promise has resolved,
so the failure is queued before the request is made. The same holds for every page test, because pages render only
after the staff profile loads.

Replace `apps/web/src/layout/LanguageSwitcher.test.tsx` with:

```tsx
import { screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { STORAGE_KEY } from '@/i18n'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

afterEach(() => vi.restoreAllMocks())

test('switches the UI language and remembers it', async () => {
  const { user } = renderApp('/login')
  expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Lingua'), 'en')
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  expect(document.documentElement.lang).toBe('en')
  expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en')
})

test('switching works when localStorage throws', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const { user } = renderApp('/login')
  await user.selectOptions(await screen.findByLabelText('Lingua'), 'en')
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
})

test('signed in, the choice is saved on the staff record', async () => {
  const { db, user } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  await user.selectOptions(within(nav).getByLabelText('Lingua'), 'en')
  expect(await screen.findByRole('heading', { level: 1, name: 'Quotes' })).toBeInTheDocument()
  expect(db.calls('staff')).toContainEqual({
    op: 'update',
    values: { language: 'en' },
    filters: [['eq', 'user_id', 'user-1']],
  })
})

test('a failed save keeps the new language and says so', async () => {
  const { db, user } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  db.failNext('staff', NETWORK_FAILURE)
  await user.selectOptions(within(nav).getByLabelText('Lingua'), 'en')
  expect(await within(nav).findByRole('alert')).toHaveTextContent(
    'Language changed on this device only',
  )
  expect(screen.getByRole('heading', { level: 1, name: 'Quotes' })).toBeInTheDocument()
})
```

In `apps/web/src/app/routes.test.tsx`:
- add `import { operatorStaff } from '@/test/fixtures'`;
- in the `log out signs out and returns to login` test, replace
  `expect(within(nav).getByText('anna@example.com')).toBeInTheDocument()` with
  `expect(within(nav).getByText('Anna Rossi')).toBeInTheDocument()`;
- append:

```tsx
test('operators opening /staff are told it is not for their role', async () => {
  renderApp('/staff', { session: fakeSession(), staff: operatorStaff })
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Non disponibile per il tuo ruolo' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Torna ai preventivi' })).toHaveAttribute('href', '/quotes')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/auth/StaffProvider.test.tsx src/layout/LanguageSwitcher.test.tsx src/app/routes.test.tsx`
Expected: FAIL. The "Nessun accesso" heading, "Anna Rossi" and "Non disponibile per il tuo ruolo" are not found, and no
staff update call is recorded.

- [ ] **Step 3: Implement the staff context, data hooks and provider**

Create `apps/web/src/auth/staff-context.ts`:

```ts
import { createContext, useContext } from 'react'
import type { Language } from '@/i18n'

export type Staff = {
  userId: string
  displayName: string
  role: 'owner' | 'operator'
  isOwner: boolean
  language: Language
}

export const StaffContext = createContext<Staff | null>(null)

/** The signed-in staff member. <StaffProvider> renders nothing else until it is known. */
export function useStaff(): Staff {
  const staff = useContext(StaffContext)
  if (!staff) throw new Error('useStaff must be used inside <StaffProvider>')
  return staff
}

/** Null outside <StaffProvider>, e.g. on the login page. */
export function useOptionalStaff(): Staff | null {
  return useContext(StaffContext)
}
```

Create `apps/web/src/data/staff.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Language } from '@/i18n'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'

/** The signed-in user's staff row; null when RLS hides it (no staff record, or inactive). */
export function useOwnStaff(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.ownStaff(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('user_id, display_name, role, language, active')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw toAppError(error)
      return data
    },
  })
}

export type ProfileChanges = { userId: string; display_name?: string; language?: Language }

export function useSaveOwnProfile() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, ...changes }: ProfileChanges) => {
      const { error } = await supabase
        .from('staff')
        .update(changes)
        .eq('user_id', userId)
        .select('user_id')
        .single()
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll }),
  })
}
```

Create `apps/web/src/auth/StaffProvider.tsx`:

```tsx
import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useOwnStaff } from '@/data/staff'
import { setLanguage } from '@/i18n'
import { useSupabase } from '@/lib/supabase'
import { StaffContext, type Staff } from './staff-context'

/**
 * Loads the signed-in user's staff row and renders the app only for active staff. RLS hides the row from users
 * without one and from inactive staff, so "no row" means "no access"; a failed request does not.
 */
export function StaffProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { t } = useTranslation()
  const supabase = useSupabase()
  const own = useOwnStaff(userId)
  const row = own.data

  const staff = useMemo<Staff | null>(() => {
    if (!row || !row.active) return null
    const role: Staff['role'] = row.role === 'owner' ? 'owner' : 'operator'
    return {
      userId: row.user_id,
      displayName: row.display_name,
      role,
      isOwner: role === 'owner',
      language: row.language === 'en' ? 'en' : 'it',
    }
  }, [row])

  const language = staff?.language
  useEffect(() => {
    if (language) void setLanguage(language)
  }, [language])

  if (own.isPending) {
    return (
      <p role="status" className="p-6 text-muted-foreground">
        {t('auth.loading')}
      </p>
    )
  }
  if (own.isError) {
    return (
      <main className="mx-auto grid max-w-lg gap-4 p-6">
        <h1 className="text-2xl font-semibold">{t('access.loadError.title')}</h1>
        <p role="alert" className="text-muted-foreground">
          {t(toAppError(own.error).messageKey)}
        </p>
        <div>
          <Button onClick={() => void own.refetch()}>{t('common.retry')}</Button>
        </div>
      </main>
    )
  }
  if (!staff) {
    return (
      <main className="mx-auto grid max-w-lg gap-4 p-6">
        <h1 className="text-2xl font-semibold">{t('access.none.title')}</h1>
        <p className="text-muted-foreground">{t('access.none.body')}</p>
        <div>
          <Button variant="outline" onClick={() => void supabase.auth.signOut()}>
            {t('nav.logout')}
          </Button>
        </div>
      </main>
    )
  }
  return <StaffContext value={staff}>{children}</StaffContext>
}
```

Create `apps/web/src/auth/RequireOwner.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useStaff } from './staff-context'

/** Owner-only pages. The database refuses operators anyway; this explains it instead of showing empty data. */
export function RequireOwner({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  if (isOwner) return children
  return (
    <section>
      <h1 className="mb-2 text-2xl font-semibold">{t('access.ownerOnly.title')}</h1>
      <p className="mb-4 text-muted-foreground">{t('access.ownerOnly.body')}</p>
      <Link to="/quotes" className="underline-offset-4 hover:underline">
        {t('pages.notFound.back')}
      </Link>
    </section>
  )
}
```

Create `apps/web/src/auth/use-change-language.ts`:

```ts
import { useSaveOwnProfile } from '@/data/staff'
import { setLanguage, type Language } from '@/i18n'
import { useOptionalStaff } from './staff-context'

/** Switches the UI language at once and, when signed in, saves it on the staff record. */
export function useChangeLanguage() {
  const staff = useOptionalStaff()
  const save = useSaveOwnProfile()

  async function change(language: Language) {
    await setLanguage(language)
    if (staff && staff.language !== language) save.mutate({ userId: staff.userId, language })
  }

  return { change, saveFailed: save.isError }
}
```

- [ ] **Step 4: Wire it into routing, navigation and the switcher**

In `apps/web/src/auth/RequireAuth.tsx`:
- add `import { StaffProvider } from './StaffProvider'`;
- replace the final `return <Outlet />` with:

```tsx
  return (
    <StaffProvider userId={auth.session.user.id}>
      <Outlet />
    </StaffProvider>
  )
```

Replace `apps/web/src/app/sections.ts` with:

```ts
import { FileText, Layers, Printer, Settings, UserCog, Users, type LucideIcon } from 'lucide-react'

/** Sidebar sections, in order (functional analysis §2). `ownerOnly` sections are hidden from operators. */
export const SECTIONS: { path: string; labelKey: string; icon: LucideIcon; ownerOnly?: boolean }[] = [
  { path: '/quotes', labelKey: 'nav.quotes', icon: FileText },
  { path: '/clients', labelKey: 'nav.clients', icon: Users },
  { path: '/printers', labelKey: 'nav.printers', icon: Printer },
  { path: '/materials', labelKey: 'nav.materials', icon: Layers },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
  { path: '/staff', labelKey: 'nav.staff', icon: UserCog, ownerOnly: true },
]
```

Replace `apps/web/src/app/routes.tsx` with:

```tsx
import type { ReactElement } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/auth/RequireAuth'
import { RequireOwner } from '@/auth/RequireOwner'
import { AppShell } from '@/layout/AppShell'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SectionPage } from '@/pages/SectionPage'
import { SECTIONS } from './sections'

/** Sections with a real page; the others still show the "coming soon" placeholder. */
const SECTION_PAGES: Partial<Record<string, ReactElement>> = {
  '/staff': (
    <RequireOwner>
      <SectionPage titleKey="nav.staff" />
    </RequireOwner>
  ),
}

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/quotes" replace /> },
          ...SECTIONS.map(({ path, labelKey }) => ({
            path: path.slice(1),
            element: SECTION_PAGES[path] ?? <SectionPage titleKey={labelKey} />,
          })),
          { path: 'account', element: <SectionPage titleKey="nav.account" /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
```

In `apps/web/src/layout/Navigation.tsx`:
- replace `import { useAuth } from '@/auth/auth-context'` with `import { useStaff } from '@/auth/staff-context'`;
- replace `const auth = useAuth()` with `const staff = useStaff()`;
- change `{SECTIONS.map(({ path, labelKey, icon: Icon }) => (` to
  `{SECTIONS.filter((section) => !section.ownerOnly || staff.isOwner).map(({ path, labelKey, icon: Icon }) => (`.
  Prettier will lay it out;
- replace the email block

```tsx
        {auth.status === 'signedIn' && (
          <p className="truncate px-3 text-sm text-muted-foreground">{auth.session.user.email}</p>
        )}
```

  with:

```tsx
        <p className="truncate px-3 text-sm text-muted-foreground">{staff.displayName}</p>
```

Replace `apps/web/src/layout/LanguageSwitcher.tsx` with:

```tsx
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useChangeLanguage } from '@/auth/use-change-language'
import { LANGUAGES, type Language } from '@/i18n'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const id = useId()
  const { change, saveFailed } = useChangeLanguage()
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor={id} className="text-muted-foreground">
          {t('language.label')}
        </label>
        <select
          id={id}
          value={i18n.language}
          onChange={(event) => void change(event.target.value as Language)}
          className="h-8 rounded-md border border-input bg-background px-2 pointer-coarse:h-11"
        >
          {LANGUAGES.map((lng) => (
            <option key={lng} value={lng}>
              {t(`language.${lng}`)}
            </option>
          ))}
        </select>
      </div>
      {saveFailed && (
        <p role="alert" className="text-xs text-destructive">
          {t('language.saveFailed')}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add the translations**

In `it.json`:
- add `"saveFailed": "Lingua cambiata solo su questo dispositivo: salvataggio non riuscito."` inside `"language"`;
- add these top-level objects after `"validation"`:

```json
  "common": {
    "retry": "Riprova"
  },
  "access": {
    "none": {
      "title": "Nessun accesso",
      "body": "Il tuo account non ha accesso a 3D-Quote: chiedi al titolare."
    },
    "loadError": {
      "title": "Impossibile caricare il profilo"
    },
    "ownerOnly": {
      "title": "Non disponibile per il tuo ruolo",
      "body": "Questa sezione è riservata ai titolari."
    }
  }
```

In `en.json`:
- add `"saveFailed": "Language changed on this device only: saving it failed."` inside `"language"`;
- add after `"validation"`:

```json
  "common": {
    "retry": "Retry"
  },
  "access": {
    "none": {
      "title": "No access",
      "body": "Your account has no access to 3D-Quote — ask the owner."
    },
    "loadError": {
      "title": "Couldn't load your profile"
    },
    "ownerOnly": {
      "title": "Not available for your role",
      "body": "This section is for owners only."
    }
  }
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS, including the new StaffProvider, LanguageSwitcher and routes tests, plus the existing auth and AppShell
tests.

- [ ] **Step 7: Verify and commit**

Run: `npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): load the staff profile for roles, no-access and the saved UI language"
```

---

### Task 6: Shared UI building blocks

**Files:**
- Add (shadcn): `apps/web/src/components/ui/{field,separator,table,alert-dialog,native-select,switch,textarea,badge,skeleton,alert}.tsx`
- Create, all under `apps/web/src/components/`: `PageHeader.tsx`, `QueryError.tsx`, `DataTable.tsx`, `FormField.tsx`,
  `FormSheet.tsx`, `UnsavedChangesDialog.tsx`, `use-leave-guard.tsx`, `ConfirmDeleteDialog.tsx`, `ReadOnlyField.tsx`,
  `components.test.tsx`
- Modify: `apps/web/package.json` (react-hook-form, @hookform/resolvers), both locale files

**Interfaces:**
- Consumes: `toAppError` (Task 4), `createQueryClient` (Task 3).
- Produces:
  - `<PageHeader title actions? />`.
  - `<QueryError error onRetry />`.
  - `type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; className?: string }` and
    `<DataTable<T> query columns rowKey empty caption />`.
  - `<FormField id label error? children />`, where `error` is an i18n key.
  - `<FormSheet title dirty onClose>{children}</FormSheet>`: mount it only while open.
  - `<UnsavedChangesDialog open onStay onDiscard />`.
  - `useLeaveGuard(dirty): { dialog: ReactElement; allowLeaving(): void }`.
  - `<ConfirmDeleteDialog title body? pending error? alternative? onConfirm onCancel />`: mount it only while open.
  - `<ReadOnlyField label value />`, placed inside a `<dl>`.

- [ ] **Step 1: Install dependencies and add components**

Run: `npm install react-hook-form @hookform/resolvers --workspace @3d-quote/web`
Expected: both appear in `apps/web/package.json` dependencies.

Run: `npx shadcn add field table alert-dialog native-select switch textarea badge skeleton alert -c apps/web --yes`
Expected: the new files are created, and `button.tsx` and `label.tsx` are overwritten.

Run: `git checkout -- apps/web/src/components/ui/button.tsx apps/web/src/components/ui/label.tsx`
Expected: the local `pointer-coarse` touch-target classes in `button.tsx` are back (`git diff` shows no change to either
file).

In `apps/web/src/components/ui/native-select.tsx`, add ` pointer-coarse:h-11` to the end of the `<select>` element's
`className` string. Native selects are 44 px tall on touch screens, like the other controls.

Run: `npm run format`

- [ ] **Step 2: Write the failing component tests**

Create `apps/web/src/components/components.test.tsx`:

```tsx
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { createQueryClient } from '@/lib/query-client'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { DataTable } from './DataTable'
import { FormSheet } from './FormSheet'

type Item = { id: number; name: string }

function List({ load }: { load: () => Promise<Item[]> }) {
  const query = useQuery({ queryKey: ['items'], queryFn: load })
  return (
    <DataTable
      query={query}
      caption="Items"
      empty="Nothing here"
      rowKey={(item) => item.id}
      columns={[{ key: 'name', header: 'Name', cell: (item) => item.name }]}
    />
  )
}

function renderList(load: () => Promise<Item[]>) {
  render(
    <QueryClientProvider client={createQueryClient({ retry: false })}>
      <List load={load} />
    </QueryClientProvider>,
  )
}

test('DataTable shows a loading state, then the rows', async () => {
  renderList(async () => [{ id: 1, name: 'MK4' }])
  expect(screen.getByRole('status', { name: 'Caricamento…' })).toBeInTheDocument()
  expect(await screen.findByRole('cell', { name: 'MK4' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
})

test('DataTable shows the empty state', async () => {
  renderList(async () => [])
  expect(await screen.findByText('Nothing here')).toBeInTheDocument()
})

test('DataTable shows a failed load with Retry', async () => {
  const load = vi
    .fn<() => Promise<Item[]>>()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce([{ id: 1, name: 'MK4' }])
  renderList(load)
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  await userEvent.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(await screen.findByRole('cell', { name: 'MK4' })).toBeInTheDocument()
})

function SheetHarness({ dirty }: { dirty: boolean }) {
  const [open, setOpen] = useState(true)
  if (!open) return <p>Closed</p>
  return (
    <FormSheet title="Edit" dirty={dirty} onClose={() => setOpen(false)}>
      <p>Body</p>
    </FormSheet>
  )
}

test('FormSheet closes at once when nothing changed', async () => {
  render(<SheetHarness dirty={false} />)
  await userEvent.click(screen.getByRole('button', { name: 'Chiudi' }))
  expect(await screen.findByText('Closed')).toBeInTheDocument()
})

test('FormSheet asks before discarding changes', async () => {
  render(<SheetHarness dirty />)
  await userEvent.keyboard('{Escape}')
  const confirm = await screen.findByRole('alertdialog', { name: 'Modifiche non salvate' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Continua a modificare' }))
  expect(screen.getByRole('dialog', { name: 'Edit' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Chiudi' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Scarta' }))
  expect(await screen.findByText('Closed')).toBeInTheDocument()
})

test('ConfirmDeleteDialog names the item, shows errors and offers an alternative', async () => {
  const onConfirm = vi.fn()
  const onAlternative = vi.fn()
  const { rerender } = render(
    <ConfirmDeleteDialog
      title="Eliminare MK4?"
      pending={false}
      onConfirm={onConfirm}
      onCancel={() => {}}
    />,
  )
  const dialog = screen.getByRole('alertdialog', { name: 'Eliminare MK4?' })
  expect(within(dialog).getByText("L'operazione non si può annullare.")).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(onConfirm).toHaveBeenCalled()

  rerender(
    <ConfirmDeleteDialog
      title="Eliminare MK4?"
      pending={false}
      error="In uso"
      alternative={{ label: 'Disattiva invece', onClick: onAlternative }}
      onConfirm={onConfirm}
      onCancel={() => {}}
    />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent('In uso')
  await userEvent.click(screen.getByRole('button', { name: 'Disattiva invece' }))
  expect(onAlternative).toHaveBeenCalled()
})

test('native selects are 44px tall on touch screens', () => {
  render(
    <NativeSelect aria-label="Tipo">
      <NativeSelectOption value="a">A</NativeSelectOption>
    </NativeSelect>,
  )
  expect(screen.getByLabelText('Tipo')).toHaveClass('pointer-coarse:h-11')
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/components/components.test.tsx`
Expected: FAIL: `./ConfirmDeleteDialog`, `./DataTable` and `./FormSheet` can't be resolved.

- [ ] **Step 4: Implement the components**

Create `apps/web/src/components/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react'

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}
```

Create `apps/web/src/components/QueryError.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'

/** A failed load: what went wrong, in words, and a way to try again. Never blocks the rest of the page. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{t(toAppError(error).messageKey)}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
```

Create `apps/web/src/components/DataTable.tsx`:

```tsx
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { QueryError } from './QueryError'

export type Column<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
}

/** A list backed by a query: a skeleton while loading, an error with Retry, an empty state, or the rows. */
export function DataTable<T>({
  query,
  columns,
  rowKey,
  empty,
  caption,
}: {
  query: UseQueryResult<T[]>
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  empty: ReactNode
  caption: string
}) {
  const { t } = useTranslation()

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('common.loading')} className="grid gap-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.length === 0) {
    return <p className="rounded-md border p-6 text-center text-muted-foreground">{empty}</p>
  }
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.data.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

Create `apps/web/src/components/FormField.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'

/** Label, control and its error. `error` is an i18n key; the control must use `id` and set `aria-invalid`. */
export function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      <FieldError>{error ? t(error) : null}</FieldError>
    </Field>
  )
}
```

Create `apps/web/src/components/UnsavedChangesDialog.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/** Plain buttons, not AlertDialogAction/Cancel: those also fire onOpenChange, which would call onStay a second time. */
export function UnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
}: {
  open: boolean
  onStay: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onStay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('common.unsaved.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('common.unsaved.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onStay}>
            {t('common.unsaved.stay')}
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            {t('common.unsaved.discard')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

Create `apps/web/src/components/FormSheet.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

/** A create/edit form beside the list. Mount it only while open; closing with changes asks first. */
export function FormSheet({
  title,
  dirty,
  onClose,
  children,
}: {
  title: string
  dirty: boolean
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)

  function requestClose(open: boolean) {
    if (open) return
    if (dirty) setConfirming(true)
    else onClose()
  }

  return (
    <>
      <Sheet open onOpenChange={requestClose}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-lg"
          closeLabel={t('common.close')}
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{children}</div>
        </SheetContent>
      </Sheet>
      <UnsavedChangesDialog
        open={confirming}
        onStay={() => setConfirming(false)}
        onDiscard={() => {
          setConfirming(false)
          onClose()
        }}
      />
    </>
  )
}
```

Create `apps/web/src/components/use-leave-guard.tsx`:

```tsx
import { useRef } from 'react'
import { useBlocker } from 'react-router'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

/**
 * Asks before navigating to another page while `dirty`. Render `dialog`; call `allowLeaving()` right before a
 * navigation that should not ask (e.g. after deleting the record being edited).
 */
export function useLeaveGuard(dirty: boolean) {
  const bypass = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  )
  return {
    dialog: (
      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        onStay={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
    ),
    allowLeaving: () => {
      bypass.current = true
    },
  }
}
```

Create `apps/web/src/components/ConfirmDeleteDialog.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * Confirms a delete, naming the item in `title`. Mount it only while open. The confirm button is a plain Button so the
 * dialog stays open to show `error`; `alternative` replaces it (e.g. "Deactivate instead").
 */
export function ConfirmDeleteDialog({
  title,
  body,
  pending,
  error,
  alternative,
  onConfirm,
  onCancel,
}: {
  title: string
  body?: string
  pending: boolean
  error?: string | null
  alternative?: { label: string; onClick: () => void } | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body ?? t('common.deleteBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          {alternative ? (
            <Button onClick={alternative.onClick} disabled={pending}>
              {alternative.label}
            </Button>
          ) : (
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>
              {t('common.delete')}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

Create `apps/web/src/components/ReadOnlyField.tsx`:

```tsx
import type { ReactNode } from 'react'

/** A value shown to people who can't edit it. Place inside a <dl>. */
export function ReadOnlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-line">{value === null || value === '' ? '—' : value}</dd>
    </div>
  )
}
```

Replace the `"common"` object in `it.json` with:

```json
  "common": {
    "retry": "Riprova",
    "loading": "Caricamento…",
    "save": "Salva",
    "saved": "Salvato.",
    "cancel": "Annulla",
    "close": "Chiudi",
    "delete": "Elimina",
    "deactivateInstead": "Disattiva invece",
    "yes": "Sì",
    "no": "No",
    "actions": "Azioni",
    "editItem": "Modifica {{name}}",
    "deleteItem": "Elimina {{name}}",
    "deleteBody": "L'operazione non si può annullare.",
    "unsaved": {
      "title": "Modifiche non salvate",
      "body": "Le modifiche andranno perse.",
      "stay": "Continua a modificare",
      "discard": "Scarta"
    }
  },
```

and in `en.json` with:

```json
  "common": {
    "retry": "Retry",
    "loading": "Loading…",
    "save": "Save",
    "saved": "Saved.",
    "cancel": "Cancel",
    "close": "Close",
    "delete": "Delete",
    "deactivateInstead": "Deactivate instead",
    "yes": "Yes",
    "no": "No",
    "actions": "Actions",
    "editItem": "Edit {{name}}",
    "deleteItem": "Delete {{name}}",
    "deleteBody": "This can't be undone.",
    "unsaved": {
      "title": "Unsaved changes",
      "body": "Your changes will be lost.",
      "stay": "Keep editing",
      "discard": "Discard"
    }
  },
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/components/components.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (8 component tests and the parity test).

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`
Expected: all pass. If `react-refresh/only-export-components` flags a `src/components/*.tsx` file, the file is exporting
a non-component: move that export to a `.ts` file.

```bash
git add apps/web/package.json package-lock.json apps/web/src/components apps/web/src/i18n/locales
git commit -m "feat(web): add data table, form field, sheet, confirm and unsaved-changes building blocks"
```

---

### Task 7: Printers screen

**Files:**
- Create: `apps/web/src/data/printers.ts`, `apps/web/src/pages/printers/printer-form.ts`,
  `apps/web/src/pages/printers/PrinterSheet.tsx`, `apps/web/src/components/DeleteCatalogItemDialog.tsx`,
  `apps/web/src/pages/PrintersPage.tsx`, `apps/web/src/pages/PrintersPage.test.tsx`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/routes.test.tsx`, both locale files

**Interfaces:**
- Consumes:
  - from Task 6: `DataTable`, `Column`, `PageHeader`, `FormSheet`, `FormField`, `ConfirmDeleteDialog`;
  - from Task 5: `useStaff`;
  - from Task 4: `useFormat`, `numberField`, `requiredText`, `parseDecimal`, `toInputNumber`, `toAppError`,
    `AppError`, `queryKeys`;
  - from Task 3: `printerRow`, `operatorStaff`, `NETWORK_FAILURE`.
- Produces:
  - `type Printer`, `type PrinterValues`;
  - `usePrinters()`, `useSavePrinter()` (mutate `{ id?, values: Partial<PrinterValues> }`),
    `useDeletePrinter()` (mutate `id`);
  - `<DeleteCatalogItemDialog title inUseMessage onDelete onDeactivate onClose />`, reused by Materials.

- [ ] **Step 1: Write the failing page tests**

Create `apps/web/src/pages/PrintersPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { operatorStaff, printerRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mk4 = () => printerRow({ id: 1, name: 'MK4 #1' })

async function openEdit(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Modifica MK4 #1' }))
  return screen.findByRole('dialog', { name: 'Modifica stampante' })
}

test('lists printers with formatted values', async () => {
  renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const row = await screen.findByRole('row', { name: /MK4 #1/ })
  expect(within(row).getByText('Prusa MK4')).toBeInTheDocument()
  expect(within(row).getByText('250 × 210 × 220 mm')).toBeInTheDocument()
  expect(within(row).getByText('0,40 mm')).toBeInTheDocument()
  expect(within(row).getByText('1,50 €/h')).toBeInTheDocument()
  expect(within(row).getByText('120 W')).toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/printers', { session })
  expect(await screen.findByText('Nessuna stampante.')).toBeInTheDocument()
})

test('a failed load shows the error and Retry reloads', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  db.failNext('printers', NETWORK_FAILURE)
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile contattare il server.')
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(await screen.findByRole('row', { name: /MK4 #1/ })).toBeInTheDocument()
})

test('operators see the list without owner actions', async () => {
  renderApp('/printers', { session, staff: operatorStaff, tables: { printers: [mk4()] } })
  const row = await screen.findByRole('row', { name: /MK4 #1/ })
  expect(within(row).getByText('Sì')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nuova stampante' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Modifica MK4 #1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Elimina MK4 #1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

test('creates a printer, accepting Italian decimals', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  await user.type(within(sheet).getByLabelText('Nome'), 'X1C #1')
  await user.type(within(sheet).getByLabelText('Modello'), 'Bambu Lab X1C')
  await user.type(within(sheet).getByLabelText('Volume X (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Volume Y (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Volume Z (mm)'), '256')
  await user.type(within(sheet).getByLabelText('Costo orario'), '2,5')
  await user.type(within(sheet).getByLabelText('Potenza (W)'), '180')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'insert',
    filters: [],
    values: {
      name: 'X1C #1',
      model: 'Bambu Lab X1C',
      build_x_mm: 256,
      build_y_mm: 256,
      build_z_mm: 256,
      nozzle_diameter_mm: 0.4,
      hourly_rate: 2.5,
      power_w: 180,
      active: true,
    },
  })
  expect(await screen.findByRole('row', { name: /X1C #1/ })).toBeInTheDocument()
})

test('shows field errors and does not save invalid values', async () => {
  const { db, user } = renderApp('/printers', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuova stampante' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuova stampante' })
  const nozzle = within(sheet).getByLabelText('Ugello (mm)')
  await user.clear(nozzle)
  await user.type(nozzle, '0')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  expect((await within(sheet).findAllByText('Campo obbligatorio.')).length).toBeGreaterThan(0)
  expect(within(sheet).getByText('Deve essere maggiore di zero.')).toBeInTheDocument()
  expect(db.calls('printers').filter((call) => call.op === 'insert')).toHaveLength(0)
})

test('edits a printer', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  expect(within(sheet).getByLabelText('Ugello (mm)')).toHaveValue('0,40')
  const name = within(sheet).getByLabelText('Nome')
  await user.clear(name)
  await user.type(name, 'MK4 #2')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: expect.objectContaining({ name: 'MK4 #2', hourly_rate: 1.5, nozzle_diameter_mm: 0.4 }),
  })
})

test('a duplicate name is shown under the name field', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  await user.type(within(sheet).getByLabelText('Nome'), 'x')
  db.failNext('printers', {
    code: '23505',
    message: 'duplicate key value violates unique constraint "printers_name_key"',
  })
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(
    await within(sheet).findByText('Esiste già una stampante con questo nome.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Modifica stampante' })).toBeInTheDocument()
})

test('a save that changes no row shows an error instead of closing', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  await user.type(within(sheet).getByLabelText('Nome'), 'x')
  db.failNext('printers', {
    code: 'PGRST116',
    message: 'Cannot coerce the result to a single JSON object',
  })
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(
    await within(sheet).findByText("L'elemento non esiste più o non puoi modificarlo."),
  ).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Modifica stampante' })).toBeInTheDocument()
})

test('owners switch a printer off from the list', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  await user.click(await screen.findByRole('switch', { name: 'Attiva/disattiva MK4 #1' }))
  await waitFor(() =>
    expect(db.calls('printers')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Attiva/disattiva MK4 #1' })).not.toBeChecked(),
  )
})

test('deletes a printer after confirmation', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  await user.click(await screen.findByRole('button', { name: 'Elimina MK4 #1' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare la stampante MK4 #1?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))

  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 1]] })
  expect(await screen.findByText('Nessuna stampante.')).toBeInTheDocument()
})

test('a printer in use can be deactivated instead', async () => {
  const { db, user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  await user.click(await screen.findByRole('button', { name: 'Elimina MK4 #1' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare la stampante MK4 #1?' })
  db.failNext('printers', { code: '23503', message: 'violates foreign key constraint' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'La stampante è usata in alcuni preventivi: puoi disattivarla invece di eliminarla.',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva invece' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(db.calls('printers')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { active: false },
  })
})

test('closing a changed form asks before discarding', async () => {
  const { user } = renderApp('/printers', { session, tables: { printers: [mk4()] } })
  const sheet = await openEdit(user)
  await user.type(within(sheet).getByLabelText('Nome'), 'x')
  await user.click(within(sheet).getByRole('button', { name: 'Chiudi' }))
  await user.click(await screen.findByRole('button', { name: 'Scarta' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
```

In `apps/web/src/app/routes.test.tsx`, delete the `['/printers', 'Stampanti'],` row from `pages`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/pages/PrintersPage.test.tsx`
Expected: FAIL. `/printers` still renders the placeholder, so no row, button or empty state is found.

- [ ] **Step 3: Implement the data hooks**

Create `apps/web/src/data/printers.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Printer = Tables<'printers'>
export type PrinterValues = Omit<TablesInsert<'printers'>, 'id' | 'created_at' | 'updated_at'>

export function usePrinters() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.printers,
    queryFn: async () => {
      const { data, error } = await supabase.from('printers').select('*').order('name')
      if (error) throw toAppError(error)
      return data
    },
  })
}

/** Inserts without `id`, otherwise updates that printer (partial values allowed, e.g. the Active toggle). */
export function useSavePrinter() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: Partial<PrinterValues> }) => {
      const { data, error } =
        id === undefined
          ? await supabase
              .from('printers')
              .insert(values as PrinterValues)
              .select()
              .single()
          : await supabase.from('printers').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.printers }),
  })
}

export function useDeletePrinter() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('printers').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.printers }),
  })
}
```

- [ ] **Step 4: Implement the form, sheet, delete dialog and page**

Create `apps/web/src/pages/printers/printer-form.ts`:

```ts
import { z } from 'zod'
import type { Printer, PrinterValues } from '@/data/printers'
import { toInputNumber, type Locale } from '@/lib/format'
import { numberField, parseDecimal, requiredText } from '@/lib/forms'

export const printerSchema = z.object({
  name: requiredText(),
  model: requiredText(),
  build_x_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
  build_y_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
  build_z_mm: numberField({ gt: 0, decimals: 1, rangeError: 'validation.positive' }),
  nozzle_diameter_mm: numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' }),
  hourly_rate: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  power_w: numberField({ gt: 0, decimals: 0, rangeError: 'validation.positive' }),
  active: z.boolean(),
})

export type PrinterForm = z.infer<typeof printerSchema>

export function printerToForm(printer: Printer | null, locale: Locale): PrinterForm {
  return {
    name: printer?.name ?? '',
    model: printer?.model ?? '',
    build_x_mm: toInputNumber(printer?.build_x_mm, locale),
    build_y_mm: toInputNumber(printer?.build_y_mm, locale),
    build_z_mm: toInputNumber(printer?.build_z_mm, locale),
    nozzle_diameter_mm: toInputNumber(printer?.nozzle_diameter_mm ?? 0.4, locale, 2),
    hourly_rate: toInputNumber(printer?.hourly_rate, locale, 2),
    power_w: toInputNumber(printer?.power_w, locale),
    active: printer?.active ?? true,
  }
}

/** Only called on values that passed printerSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

export function formToPrinter(form: PrinterForm): PrinterValues {
  return {
    name: form.name.trim(),
    model: form.model.trim(),
    build_x_mm: number(form.build_x_mm),
    build_y_mm: number(form.build_y_mm),
    build_z_mm: number(form.build_z_mm),
    nozzle_diameter_mm: number(form.nozzle_diameter_mm),
    hourly_rate: number(form.hourly_rate),
    power_w: number(form.power_w),
    active: form.active,
  }
}
```

Create `apps/web/src/pages/printers/PrinterSheet.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import { useSavePrinter, type Printer } from '@/data/printers'
import { useFormat } from '@/lib/use-format'
import { formToPrinter, printerSchema, printerToForm, type PrinterForm } from './printer-form'

const NUMBER_FIELDS = [
  ['build_x_mm', 'printers.fields.buildX'],
  ['build_y_mm', 'printers.fields.buildY'],
  ['build_z_mm', 'printers.fields.buildZ'],
  ['nozzle_diameter_mm', 'printers.fields.nozzle'],
  ['hourly_rate', 'printers.fields.hourlyRate'],
  ['power_w', 'printers.fields.power'],
] as const

/** New printer when `printer` is null. */
export function PrinterSheet({ printer, onClose }: { printer: Printer | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const save = useSavePrinter()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<PrinterForm>({
    resolver: zodResolver(printerSchema),
    defaultValues: printerToForm(printer, locale),
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await save.mutateAsync({ id: printer?.id, values: formToPrinter(values) })
      onClose()
    } catch (error) {
      const appError = toAppError(error)
      if (appError.kind === 'duplicate' && appError.field === 'name') {
        setError('name', { message: 'printers.duplicateName' })
      } else {
        setFormError(appError.messageKey)
      }
    }
  })

  return (
    <FormSheet
      title={t(printer ? 'printers.edit' : 'printers.new')}
      dirty={isDirty}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormField id="printer-name" label={t('printers.fields.name')} error={errors.name?.message}>
          <Input id="printer-name" aria-invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField
          id="printer-model"
          label={t('printers.fields.model')}
          error={errors.model?.message}
        >
          <Input id="printer-model" aria-invalid={!!errors.model} {...register('model')} />
        </FormField>
        {NUMBER_FIELDS.map(([name, label]) => (
          <FormField
            key={name}
            id={`printer-${name}`}
            label={t(label)}
            error={errors[name]?.message}
          >
            <Input
              id={`printer-${name}`}
              inputMode="decimal"
              aria-invalid={!!errors[name]}
              {...register(name)}
            />
          </FormField>
        ))}
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="printer-active" checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor="printer-active">{t('printers.fields.active')}</FieldLabel>
            </Field>
          )}
        />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={!isDirty || save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormSheet>
  )
}
```

Create `apps/web/src/components/DeleteCatalogItemDialog.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toAppError } from '@/data/errors'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

/**
 * Deletes a printer or material. One that quote items still use can't be deleted (foreign key), so the dialog then
 * explains why and offers to deactivate it instead.
 */
export function DeleteCatalogItemDialog({
  title,
  inUseMessage,
  onDelete,
  onDeactivate,
  onClose,
}: {
  title: string
  inUseMessage: string
  onDelete: () => Promise<unknown>
  onDeactivate: () => Promise<unknown>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [inUse, setInUse] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (caught) {
      const appError = toAppError(caught)
      if (appError.kind === 'inUse') setInUse(true)
      else setError(t(appError.messageKey))
      setPending(false)
    }
  }

  return (
    <ConfirmDeleteDialog
      title={title}
      pending={pending}
      error={error ?? (inUse ? inUseMessage : null)}
      alternative={
        inUse ? { label: t('common.deactivateInstead'), onClick: () => void run(onDeactivate) } : null
      }
      onConfirm={() => void run(onDelete)}
      onCancel={onClose}
    />
  )
}
```

Create `apps/web/src/pages/PrintersPage.tsx`:

```tsx
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column } from '@/components/DataTable'
import { DeleteCatalogItemDialog } from '@/components/DeleteCatalogItemDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import { useDeletePrinter, usePrinters, useSavePrinter, type Printer } from '@/data/printers'
import { useFormat } from '@/lib/use-format'
import { PrinterSheet } from './printers/PrinterSheet'

export function PrintersPage() {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const printers = usePrinters()
  const save = useSavePrinter()
  const remove = useDeletePrinter()
  const [editing, setEditing] = useState<Printer | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Printer | null>(null)

  const columns: Column<Printer>[] = [
    {
      key: 'name',
      header: t('printers.fields.name'),
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    { key: 'model', header: t('printers.fields.model'), cell: (p) => p.model },
    {
      key: 'volume',
      header: t('printers.columns.buildVolume'),
      cell: (p) =>
        t('printers.volumeValue', {
          x: format.number(p.build_x_mm),
          y: format.number(p.build_y_mm),
          z: format.number(p.build_z_mm),
        }),
    },
    {
      key: 'nozzle',
      header: t('printers.columns.nozzle'),
      cell: (p) => `${format.number(p.nozzle_diameter_mm, 2)} mm`,
    },
    {
      key: 'rate',
      header: t('printers.fields.hourlyRate'),
      cell: (p) => t('printers.rateValue', { value: format.currency(p.hourly_rate) }),
    },
    {
      key: 'power',
      header: t('printers.columns.power'),
      cell: (p) => `${format.number(p.power_w)} W`,
    },
    {
      key: 'active',
      header: t('printers.fields.active'),
      cell: (p) =>
        isOwner ? (
          <Switch
            checked={p.active}
            aria-label={t('printers.toggleActive', { name: p.name })}
            onCheckedChange={(active) => save.mutate({ id: p.id, values: { active } })}
          />
        ) : (
          t(p.active ? 'common.yes' : 'common.no')
        ),
    },
  ]
  if (isOwner) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.editItem', { name: p.name })}
            onClick={() => setEditing(p)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.deleteItem', { name: p.name })}
            onClick={() => setDeleting(p)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ),
    })
  }

  return (
    <section>
      <PageHeader
        title={t('nav.printers')}
        actions={
          isOwner && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('printers.new')}
            </Button>
          )
        }
      />
      {save.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(toAppError(save.error).messageKey)}
        </p>
      )}
      <DataTable
        query={printers}
        columns={columns}
        rowKey={(p) => p.id}
        caption={t('nav.printers')}
        empty={t('printers.empty')}
      />
      {editing && (
        <PrinterSheet
          printer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCatalogItemDialog
          title={t('printers.deleteTitle', { name: deleting.name })}
          inUseMessage={t('printers.inUse')}
          onDelete={() => remove.mutateAsync(deleting.id)}
          onDeactivate={() => save.mutateAsync({ id: deleting.id, values: { active: false } })}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
```

In `apps/web/src/app/routes.tsx`, add `import { PrintersPage } from '@/pages/PrintersPage'` and the entry
`'/printers': <PrintersPage />,` to `SECTION_PAGES`.

Add to `it.json` (top level):

```json
  "printers": {
    "empty": "Nessuna stampante.",
    "new": "Nuova stampante",
    "edit": "Modifica stampante",
    "fields": {
      "name": "Nome",
      "model": "Modello",
      "buildX": "Volume X (mm)",
      "buildY": "Volume Y (mm)",
      "buildZ": "Volume Z (mm)",
      "nozzle": "Ugello (mm)",
      "hourlyRate": "Costo orario",
      "power": "Potenza (W)",
      "active": "Attiva"
    },
    "columns": {
      "buildVolume": "Volume di stampa",
      "nozzle": "Ugello",
      "power": "Potenza"
    },
    "volumeValue": "{{x}} × {{y}} × {{z}} mm",
    "rateValue": "{{value}}/h",
    "toggleActive": "Attiva/disattiva {{name}}",
    "duplicateName": "Esiste già una stampante con questo nome.",
    "deleteTitle": "Eliminare la stampante {{name}}?",
    "inUse": "La stampante è usata in alcuni preventivi: puoi disattivarla invece di eliminarla."
  }
```

Add to `en.json`:

```json
  "printers": {
    "empty": "No printers yet.",
    "new": "New printer",
    "edit": "Edit printer",
    "fields": {
      "name": "Name",
      "model": "Model",
      "buildX": "Build X (mm)",
      "buildY": "Build Y (mm)",
      "buildZ": "Build Z (mm)",
      "nozzle": "Nozzle (mm)",
      "hourlyRate": "Hourly rate",
      "power": "Power (W)",
      "active": "Active"
    },
    "columns": {
      "buildVolume": "Build volume",
      "nozzle": "Nozzle",
      "power": "Power"
    },
    "volumeValue": "{{x}} × {{y}} × {{z}} mm",
    "rateValue": "{{value}}/h",
    "toggleActive": "Toggle {{name}} active",
    "duplicateName": "A printer with this name already exists.",
    "deleteTitle": "Delete printer {{name}}?",
    "inUse": "This printer is used by quote items — deactivate it instead."
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/pages/PrintersPage.test.tsx src/app/routes.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (13 printer tests).

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): printers screen with owner-only editing, deactivate-instead-of-delete and field errors"
```

---

### Task 8: Materials screen

**Files:**
- Create: `apps/web/src/data/materials.ts`, `apps/web/src/pages/materials/material-form.ts`,
  `apps/web/src/pages/materials/MaterialSheet.tsx`, `apps/web/src/pages/MaterialsPage.tsx`,
  `apps/web/src/pages/MaterialsPage.test.tsx`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/routes.test.tsx`, both locale files

**Interfaces:**
- Consumes: everything Task 7 consumed, plus `DeleteCatalogItemDialog` (Task 7) and `materialRow` (Task 3).
- Produces:
  - `type Material`, `type MaterialValues`;
  - `useMaterials()`, `useSaveMaterial()` (mutate `{ id?, values: Partial<MaterialValues> }`), `useDeleteMaterial()`;
  - `MATERIAL_TYPES`, `TYPE_DENSITY`.

- [ ] **Step 1: Write the failing page tests**

Create `apps/web/src/pages/MaterialsPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { materialRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const pla = () => materialRow({ id: 1, name: 'Prusament PLA' })

test('lists materials with formatted values', async () => {
  renderApp('/materials', {
    session,
    tables: {
      materials: [pla(), materialRow({ id: 2, name: 'Generic', type: 'other', color: null })],
    },
  })
  const row = await screen.findByRole('row', { name: /Prusament PLA/ })
  expect(within(row).getByText('PLA')).toBeInTheDocument()
  expect(within(row).getByText('Black')).toBeInTheDocument()
  expect(within(row).getByText('25,00 €/kg')).toBeInTheDocument()
  expect(within(row).getByText('1,24 g/cm³')).toBeInTheDocument()
  const other = screen.getByRole('row', { name: /Generic/ })
  expect(within(other).getByText('Altro')).toBeInTheDocument()
  expect(within(other).getByText('—')).toBeInTheDocument()
})

test('shows an empty state', async () => {
  renderApp('/materials', { session })
  expect(await screen.findByText('Nessun materiale.')).toBeInTheDocument()
})

test('operators see the list without owner actions', async () => {
  renderApp('/materials', { session, staff: operatorStaff, tables: { materials: [pla()] } })
  await screen.findByRole('row', { name: /Prusament PLA/ })
  expect(screen.queryByRole('button', { name: 'Nuovo materiale' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Modifica Prusament PLA' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

test('choosing a type pre-fills density until density is edited by hand', async () => {
  const { db, user } = renderApp('/materials', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo materiale' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo materiale' })
  const type = within(sheet).getByLabelText('Tipo')
  const density = within(sheet).getByLabelText('Densità (g/cm³)')
  expect(density).toHaveValue('1,24')

  await user.selectOptions(type, 'PETG')
  expect(density).toHaveValue('1,27')

  await user.clear(density)
  await user.type(density, '1,30')
  await user.selectOptions(type, 'ABS')
  expect(density).toHaveValue('1,30')

  await user.type(within(sheet).getByLabelText('Nome'), 'Custom ABS')
  await user.type(within(sheet).getByLabelText('Costo al kg'), '30')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(db.calls('materials')).toContainEqual({
    op: 'insert',
    filters: [],
    values: {
      name: 'Custom ABS',
      type: 'ABS',
      color: null,
      cost_per_kg: 30,
      density_g_cm3: 1.3,
      active: true,
    },
  })
})

test('Other leaves density as it is', async () => {
  const { user } = renderApp('/materials', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo materiale' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo materiale' })
  await user.selectOptions(within(sheet).getByLabelText('Tipo'), 'other')
  expect(within(sheet).getByLabelText('Densità (g/cm³)')).toHaveValue('1,24')
})

test('a material in use can be deactivated instead', async () => {
  const { db, user } = renderApp('/materials', { session, tables: { materials: [pla()] } })
  await user.click(await screen.findByRole('button', { name: 'Elimina Prusament PLA' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Eliminare il materiale Prusament PLA?',
  })
  db.failNext('materials', { code: '23503', message: 'violates foreign key constraint' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Il materiale è usato in alcuni preventivi: puoi disattivarlo invece di eliminarlo.',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Disattiva invece' }))
  await waitFor(() =>
    expect(db.calls('materials')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
})

test('owners switch a material off from the list', async () => {
  const { db, user } = renderApp('/materials', { session, tables: { materials: [pla()] } })
  await user.click(await screen.findByRole('switch', { name: 'Attiva/disattiva Prusament PLA' }))
  await waitFor(() =>
    expect(db.calls('materials')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 1]],
      values: { active: false },
    }),
  )
})
```

In `apps/web/src/app/routes.test.tsx`, delete the `['/materials', 'Materiali'],` row from `pages`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/pages/MaterialsPage.test.tsx`
Expected: FAIL. `/materials` still renders the placeholder.

- [ ] **Step 3: Implement data hooks, form, sheet and page**

Create `apps/web/src/data/materials.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Material = Tables<'materials'>
export type MaterialValues = Omit<TablesInsert<'materials'>, 'id' | 'created_at' | 'updated_at'>

export const MATERIAL_TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'other'] as const
export type MaterialType = (typeof MATERIAL_TYPES)[number]

/** Typical densities in g/cm³ (functional analysis §3.7); `other` has none. */
export const TYPE_DENSITY: Partial<Record<MaterialType, number>> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  PA: 1.14,
  PC: 1.2,
}

export function useMaterials() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.materials,
    queryFn: async () => {
      const { data, error } = await supabase.from('materials').select('*').order('name')
      if (error) throw toAppError(error)
      return data
    },
  })
}

/** Inserts without `id`, otherwise updates that material (partial values allowed, e.g. the Active toggle). */
export function useSaveMaterial() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: Partial<MaterialValues> }) => {
      const { data, error } =
        id === undefined
          ? await supabase
              .from('materials')
              .insert(values as MaterialValues)
              .select()
              .single()
          : await supabase.from('materials').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.materials }),
  })
}

export function useDeleteMaterial() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('materials').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.materials }),
  })
}
```

Create `apps/web/src/pages/materials/material-form.ts`:

```ts
import { z } from 'zod'
import { MATERIAL_TYPES, TYPE_DENSITY, type Material, type MaterialValues } from '@/data/materials'
import { toInputNumber, type Locale } from '@/lib/format'
import { nullIfEmpty, numberField, parseDecimal, requiredText } from '@/lib/forms'

export const materialSchema = z.object({
  name: requiredText(),
  type: z.enum(MATERIAL_TYPES),
  color: z.string(),
  cost_per_kg: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  density_g_cm3: numberField({ gt: 0, decimals: 2, rangeError: 'validation.positive' }),
  active: z.boolean(),
})

export type MaterialForm = z.infer<typeof materialSchema>

export function materialToForm(material: Material | null, locale: Locale): MaterialForm {
  const type = (material?.type ?? 'PLA') as MaterialForm['type']
  return {
    name: material?.name ?? '',
    type,
    color: material?.color ?? '',
    cost_per_kg: toInputNumber(material?.cost_per_kg, locale, 2),
    density_g_cm3: toInputNumber(material?.density_g_cm3 ?? TYPE_DENSITY[type], locale, 2),
    active: material?.active ?? true,
  }
}

/** Only called on values that passed materialSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

export function formToMaterial(form: MaterialForm): MaterialValues {
  return {
    name: form.name.trim(),
    type: form.type,
    color: nullIfEmpty(form.color),
    cost_per_kg: number(form.cost_per_kg),
    density_g_cm3: number(form.density_g_cm3),
    active: form.active,
  }
}
```

Create `apps/web/src/pages/materials/MaterialSheet.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, useState, type ChangeEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import {
  MATERIAL_TYPES,
  TYPE_DENSITY,
  useSaveMaterial,
  type Material,
  type MaterialType,
} from '@/data/materials'
import { toInputNumber } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { formToMaterial, materialSchema, materialToForm, type MaterialForm } from './material-form'

/** New material when `material` is null. */
export function MaterialSheet({
  material,
  onClose,
}: {
  material: Material | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const save = useSaveMaterial()
  const [formError, setFormError] = useState<string | null>(null)
  // Set once the user types a density; from then on a type change no longer overwrites it.
  const densityEdited = useRef(false)
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isDirty },
  } = useForm<MaterialForm>({
    resolver: zodResolver(materialSchema),
    defaultValues: materialToForm(material, locale),
  })

  const typeField = register('type', {
    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
      const density = TYPE_DENSITY[event.target.value as MaterialType]
      if (density !== undefined && !densityEdited.current) {
        setValue('density_g_cm3', toInputNumber(density, locale, 2))
      }
    },
  })
  const densityField = register('density_g_cm3', {
    onChange: () => {
      densityEdited.current = true
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await save.mutateAsync({ id: material?.id, values: formToMaterial(values) })
      onClose()
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <FormSheet
      title={t(material ? 'materials.edit' : 'materials.new')}
      dirty={isDirty}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormField
          id="material-name"
          label={t('materials.fields.name')}
          error={errors.name?.message}
        >
          <Input id="material-name" aria-invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField
          id="material-type"
          label={t('materials.fields.type')}
          error={errors.type?.message}
        >
          <NativeSelect id="material-type" className="w-full" {...typeField}>
            {MATERIAL_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {type === 'other' ? t('materials.types.other') : type}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="material-color" label={t('materials.fields.color')}>
          <Input id="material-color" {...register('color')} />
        </FormField>
        <FormField
          id="material-cost"
          label={t('materials.fields.costPerKg')}
          error={errors.cost_per_kg?.message}
        >
          <Input
            id="material-cost"
            inputMode="decimal"
            aria-invalid={!!errors.cost_per_kg}
            {...register('cost_per_kg')}
          />
        </FormField>
        <FormField
          id="material-density"
          label={t('materials.fields.density')}
          error={errors.density_g_cm3?.message}
        >
          <Input
            id="material-density"
            inputMode="decimal"
            aria-invalid={!!errors.density_g_cm3}
            {...densityField}
          />
        </FormField>
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="material-active" checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor="material-active">{t('materials.fields.active')}</FieldLabel>
            </Field>
          )}
        />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={!isDirty || save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormSheet>
  )
}
```

Create `apps/web/src/pages/MaterialsPage.tsx`:

```tsx
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column } from '@/components/DataTable'
import { DeleteCatalogItemDialog } from '@/components/DeleteCatalogItemDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import { useDeleteMaterial, useMaterials, useSaveMaterial, type Material } from '@/data/materials'
import { useFormat } from '@/lib/use-format'
import { MaterialSheet } from './materials/MaterialSheet'

export function MaterialsPage() {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const materials = useMaterials()
  const save = useSaveMaterial()
  const remove = useDeleteMaterial()
  const [editing, setEditing] = useState<Material | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Material | null>(null)

  const columns: Column<Material>[] = [
    {
      key: 'name',
      header: t('materials.fields.name'),
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      key: 'type',
      header: t('materials.fields.type'),
      cell: (m) => (m.type === 'other' ? t('materials.types.other') : m.type),
    },
    { key: 'color', header: t('materials.fields.color'), cell: (m) => m.color ?? '—' },
    {
      key: 'cost',
      header: t('materials.fields.costPerKg'),
      cell: (m) => t('materials.costValue', { value: format.currency(m.cost_per_kg) }),
    },
    {
      key: 'density',
      header: t('materials.columns.density'),
      cell: (m) => t('materials.densityValue', { value: format.number(m.density_g_cm3, 2) }),
    },
    {
      key: 'active',
      header: t('materials.fields.active'),
      cell: (m) =>
        isOwner ? (
          <Switch
            checked={m.active}
            aria-label={t('materials.toggleActive', { name: m.name })}
            onCheckedChange={(active) => save.mutate({ id: m.id, values: { active } })}
          />
        ) : (
          t(m.active ? 'common.yes' : 'common.no')
        ),
    },
  ]
  if (isOwner) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (m) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.editItem', { name: m.name })}
            onClick={() => setEditing(m)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.deleteItem', { name: m.name })}
            onClick={() => setDeleting(m)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ),
    })
  }

  return (
    <section>
      <PageHeader
        title={t('nav.materials')}
        actions={
          isOwner && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('materials.new')}
            </Button>
          )
        }
      />
      {save.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(toAppError(save.error).messageKey)}
        </p>
      )}
      <DataTable
        query={materials}
        columns={columns}
        rowKey={(m) => m.id}
        caption={t('nav.materials')}
        empty={t('materials.empty')}
      />
      {editing && (
        <MaterialSheet
          material={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCatalogItemDialog
          title={t('materials.deleteTitle', { name: deleting.name })}
          inUseMessage={t('materials.inUse')}
          onDelete={() => remove.mutateAsync(deleting.id)}
          onDeactivate={() => save.mutateAsync({ id: deleting.id, values: { active: false } })}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
```

In `apps/web/src/app/routes.tsx`, add `import { MaterialsPage } from '@/pages/MaterialsPage'` and the entry
`'/materials': <MaterialsPage />,` to `SECTION_PAGES`.

Add to `it.json`:

```json
  "materials": {
    "empty": "Nessun materiale.",
    "new": "Nuovo materiale",
    "edit": "Modifica materiale",
    "fields": {
      "name": "Nome",
      "type": "Tipo",
      "color": "Colore",
      "costPerKg": "Costo al kg",
      "density": "Densità (g/cm³)",
      "active": "Attivo"
    },
    "columns": {
      "density": "Densità"
    },
    "types": {
      "other": "Altro"
    },
    "costValue": "{{value}}/kg",
    "densityValue": "{{value}} g/cm³",
    "toggleActive": "Attiva/disattiva {{name}}",
    "deleteTitle": "Eliminare il materiale {{name}}?",
    "inUse": "Il materiale è usato in alcuni preventivi: puoi disattivarlo invece di eliminarlo."
  }
```

Add to `en.json`:

```json
  "materials": {
    "empty": "No materials yet.",
    "new": "New material",
    "edit": "Edit material",
    "fields": {
      "name": "Name",
      "type": "Type",
      "color": "Colour",
      "costPerKg": "Cost per kg",
      "density": "Density (g/cm³)",
      "active": "Active"
    },
    "columns": {
      "density": "Density"
    },
    "types": {
      "other": "Other"
    },
    "costValue": "{{value}}/kg",
    "densityValue": "{{value}} g/cm³",
    "toggleActive": "Toggle {{name}} active",
    "deleteTitle": "Delete material {{name}}?",
    "inUse": "This material is used by quote items — deactivate it instead."
  }
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/pages/MaterialsPage.test.tsx src/app/routes.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (7 material tests).

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): materials screen with density pre-filled from the material type"
```

---

### Task 9: Clients list

**Files:**
- Create: `apps/web/src/data/clients.ts`, `apps/web/src/lib/use-debounced-value.ts`,
  `apps/web/src/pages/clients/client-form.ts`, `apps/web/src/pages/clients/ClientFields.tsx`,
  `apps/web/src/pages/clients/ClientSheet.tsx`, `apps/web/src/pages/ClientsPage.tsx`,
  `apps/web/src/pages/ClientsPage.test.tsx`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/routes.test.tsx`, both locale files

**Interfaces:**
- Consumes:
  - from Task 6: `DataTable`, `PageHeader`, `FormSheet`, `FormField`;
  - from Task 4: `useFormat`, `requiredText`, `optionalEmail`, `nullIfEmpty`, `toAppError`, `queryKeys`;
  - from Task 3: `clientRow`, `operatorStaff`.
- Produces:
  - `type Client`, `type ClientValues`, `type ClientListRow = Client & { quoteCount: number; lastQuoteAt: string | null }`;
  - `sanitizeSearch(term)`, `useClients(search)`, `useSaveClient()` (mutate `{ id?, values: ClientValues }`, resolves
    to the saved row);
  - `clientSchema`, `ClientForm`, `clientToForm(client | null)`, `formToClient(form)`;
  - `<ClientFields form idPrefix />`;
  - `useDebouncedValue(value, ms)`.

- [ ] **Step 1: Check the list query against the local stack**

The spec asks to confirm the embedded count and newest-quote embed before relying on them. Create
`C:\Users\<you>\AppData\Local\Temp\probe-clients.cjs`, outside the repo:

```js
const { createClient } = require('C:/Progetti/3D-Quote/node_modules/@supabase/supabase-js/dist/index.cjs')
const s = createClient('http://127.0.0.1:54321', process.env.KEY, { auth: { persistSession: false } })
;(async () => {
  await s.auth.signInWithPassword({ email: 'owner@3dquote.local', password: 'password123' })
  for (const days of [20, 5]) {
    const valid = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    const r = await s.from('quotes').insert({ client_id: 1, valid_until: valid }).select().single()
    if (r.error) throw r.error
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const { data, error } = await s
    .from('clients')
    .select('*, quote_count:quotes(count), last_quote:quotes(created_at)')
    .order('created_at', { referencedTable: 'last_quote', ascending: false })
    .limit(1, { referencedTable: 'last_quote' })
    .order('name')
  console.log(JSON.stringify({ error, quote_count: data?.[0]?.quote_count, last_quote: data?.[0]?.last_quote }))
})()
```

Run it from the repo root with `KEY` set to the `PUBLISHABLE_KEY` from `supabase status -o env`:
`KEY=<publishable key> node <path>/probe-clients.cjs`.
Expected: `error` null, `quote_count` `[{"count":2}]`, and `last_quote` holding exactly one entry: the second quote's
`created_at`.

If PostgREST rejects the alias in `referencedTable`, change `referencedTable` to `'quotes'` in the probe and in
`useClients` below. Then record the change as a ruling.

Then run `supabase db reset` to drop the probe quotes, and delete the probe file.

- [ ] **Step 2: Write the failing page tests**

Create `apps/web/src/pages/ClientsPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mario = () =>
  clientRow({ id: 1, name: 'Mario Rossi', quoteCount: 2, lastQuoteAt: '2026-10-05T10:00:00Z' })
const lucia = () =>
  clientRow({ id: 2, name: 'Lucia Verdi', company: null, email: 'lucia@example.com' })
const searchBox = () =>
  screen.getByRole('searchbox', { name: 'Cerca per nome, azienda o email' })

test('lists clients with their quote count and last quote date', async () => {
  renderApp('/clients', { session, tables: { clients: [mario(), lucia()] } })
  const row = await screen.findByRole('row', { name: /Mario Rossi/ })
  expect(within(row).getByText('Rossi Meccanica')).toBeInTheDocument()
  expect(within(row).getByText('2')).toBeInTheDocument()
  expect(within(row).getByText('05/10/2026')).toBeInTheDocument()
  expect(within(row).getByRole('link', { name: 'Mario Rossi' })).toHaveAttribute(
    'href',
    '/clients/1',
  )
  const other = screen.getByRole('row', { name: /Lucia Verdi/ })
  expect(within(other).getByText('0')).toBeInTheDocument()
  expect(within(other).getAllByText('—').length).toBeGreaterThan(0)
})

test('shows an empty state', async () => {
  renderApp('/clients', { session })
  expect(await screen.findByText('Nessun cliente.')).toBeInTheDocument()
})

test('searches by name, company or email on the server', async () => {
  const { db, user } = renderApp('/clients', { session, tables: { clients: [mario(), lucia()] } })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  await user.type(searchBox(), 'lucia')
  await waitFor(() =>
    expect(screen.queryByRole('row', { name: /Mario Rossi/ })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('row', { name: /Lucia Verdi/ })).toBeInTheDocument()
  expect(db.calls('clients')).toContainEqual({
    op: 'select',
    filters: [['or', 'name.ilike.%lucia%,company.ilike.%lucia%,email.ilike.%lucia%']],
  })
})

test('search text that is PostgREST syntax is stripped before it is sent', async () => {
  const { db, user } = renderApp('/clients', { session, tables: { clients: [mario()] } })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  await user.type(searchBox(), 'Rossi, (Meccanica)*')
  await waitFor(() =>
    expect(db.calls('clients')).toContainEqual({
      op: 'select',
      filters: [
        [
          'or',
          'name.ilike.%Rossi Meccanica%,company.ilike.%Rossi Meccanica%,email.ilike.%Rossi Meccanica%',
        ],
      ],
    }),
  )
  expect(screen.getByRole('row', { name: /Mario Rossi/ })).toBeInTheDocument()
})

test('says when nothing matches the search', async () => {
  const { user } = renderApp('/clients', { session, tables: { clients: [mario()] } })
  await screen.findByRole('row', { name: /Mario Rossi/ })
  await user.type(searchBox(), 'zzz')
  expect(await screen.findByText('Nessun cliente corrisponde alla ricerca.')).toBeInTheDocument()
})

test('operators create a client and land on its page', async () => {
  const { db, user, router } = renderApp('/clients', { session, staff: operatorStaff })
  await user.click(await screen.findByRole('button', { name: 'Nuovo cliente' }))
  const sheet = await screen.findByRole('dialog', { name: 'Nuovo cliente' })
  await user.type(within(sheet).getByLabelText('Nome'), 'Giulia Neri')
  await user.type(within(sheet).getByLabelText('Email'), 'giulia@')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  expect(await within(sheet).findByText('Inserisci un indirizzo email valido.')).toBeInTheDocument()

  await user.type(within(sheet).getByLabelText('Email'), 'example.com')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/clients\/\d+$/))
  expect(db.calls('clients')).toContainEqual({
    op: 'insert',
    filters: [],
    values: {
      name: 'Giulia Neri',
      company: null,
      email: 'giulia@example.com',
      phone: null,
      notes: null,
    },
  })
})
```

In `apps/web/src/app/routes.test.tsx`, delete the `['/clients', 'Clienti'],` row from `pages`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/pages/ClientsPage.test.tsx`
Expected: FAIL. `/clients` still renders the placeholder.

- [ ] **Step 4: Implement the data hooks and debounce**

Create `apps/web/src/data/clients.ts`:

```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Client = Tables<'clients'>
export type ClientValues = Pick<
  TablesInsert<'clients'>,
  'name' | 'company' | 'email' | 'phone' | 'notes'
>
export type ClientListRow = Client & { quoteCount: number; lastQuoteAt: string | null }

/** Drops characters that would break PostgREST's or() filter or act as wildcards. */
export function sanitizeSearch(term: string) {
  return term.replace(/[,()%*\\]/g, '').trim()
}

export function useClients(search: string) {
  const supabase = useSupabase()
  const term = sanitizeSearch(search)
  return useQuery({
    queryKey: queryKeys.clients(term),
    queryFn: async (): Promise<ClientListRow[]> => {
      let query = supabase
        .from('clients')
        .select('*, quote_count:quotes(count), last_quote:quotes(created_at)')
      if (term) {
        query = query.or(`name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%`)
      }
      const { data, error } = await query
        .order('created_at', { referencedTable: 'last_quote', ascending: false })
        .limit(1, { referencedTable: 'last_quote' })
        .order('name')
      if (error) throw toAppError(error)
      return data.map(({ quote_count, last_quote, ...client }) => ({
        ...client,
        quoteCount: quote_count[0]?.count ?? 0,
        lastQuoteAt: last_quote[0]?.created_at ?? null,
      }))
    },
    // Keep the current rows on screen while a new search loads.
    placeholderData: keepPreviousData,
  })
}

/** Inserts without `id`, otherwise updates that client. Resolves to the saved row. */
export function useSaveClient() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: ClientValues }) => {
      const { data, error } =
        id === undefined
          ? await supabase.from('clients').insert(values).select().single()
          : await supabase.from('clients').update(values).eq('id', id).select().single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
  })
}
```

Create `apps/web/src/lib/use-debounced-value.ts`:

```ts
import { useEffect, useState } from 'react'

/** `value`, updated only once it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
```

- [ ] **Step 5: Implement the form, fields, sheet and page**

Create `apps/web/src/pages/clients/client-form.ts`:

```ts
import { z } from 'zod'
import type { Client, ClientValues } from '@/data/clients'
import { nullIfEmpty, optionalEmail, requiredText } from '@/lib/forms'

export const clientSchema = z.object({
  name: requiredText(),
  company: z.string(),
  email: optionalEmail,
  phone: z.string(),
  notes: z.string(),
})

export type ClientForm = z.infer<typeof clientSchema>

export function clientToForm(client: Client | null): ClientForm {
  return {
    name: client?.name ?? '',
    company: client?.company ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    notes: client?.notes ?? '',
  }
}

export function formToClient(form: ClientForm): ClientValues {
  return {
    name: form.name.trim(),
    company: nullIfEmpty(form.company),
    email: nullIfEmpty(form.email),
    phone: nullIfEmpty(form.phone),
    notes: nullIfEmpty(form.notes),
  }
}
```

Create `apps/web/src/pages/clients/ClientFields.tsx`:

```tsx
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ClientForm } from './client-form'

/** The client fields, shared by the New client sheet and the client page. */
export function ClientFields({
  form,
  idPrefix,
}: {
  form: UseFormReturn<ClientForm>
  idPrefix: string
}) {
  const { t } = useTranslation()
  const {
    register,
    formState: { errors },
  } = form
  const id = (name: keyof ClientForm) => `${idPrefix}-${name}`
  return (
    <>
      <FormField id={id('name')} label={t('clients.fields.name')} error={errors.name?.message}>
        <Input id={id('name')} aria-invalid={!!errors.name} {...register('name')} />
      </FormField>
      <FormField id={id('company')} label={t('clients.fields.company')}>
        <Input id={id('company')} {...register('company')} />
      </FormField>
      <FormField id={id('email')} label={t('clients.fields.email')} error={errors.email?.message}>
        <Input
          id={id('email')}
          type="email"
          autoComplete="off"
          aria-invalid={!!errors.email}
          {...register('email')}
        />
      </FormField>
      <FormField id={id('phone')} label={t('clients.fields.phone')}>
        <Input id={id('phone')} type="tel" autoComplete="off" {...register('phone')} />
      </FormField>
      <FormField id={id('notes')} label={t('clients.fields.notes')}>
        <Textarea id={id('notes')} rows={3} {...register('notes')} />
      </FormField>
    </>
  )
}
```

Create `apps/web/src/pages/clients/ClientSheet.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { useSaveClient } from '@/data/clients'
import { toAppError } from '@/data/errors'
import { clientSchema, clientToForm, formToClient, type ClientForm } from './client-form'
import { ClientFields } from './ClientFields'

/** New client; on save, goes to the new client's page. */
export function ClientSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const save = useSaveClient()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: clientToForm(null),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const created = await save.mutateAsync({ values: formToClient(values) })
      navigate(`/clients/${created.id}`)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <FormSheet title={t('clients.new')} dirty={form.formState.isDirty} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <ClientFields form={form} idPrefix="new-client" />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={!form.formState.isDirty || save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormSheet>
  )
}
```

Create `apps/web/src/pages/ClientsPage.tsx`:

```tsx
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useClients, type ClientListRow } from '@/data/clients'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useFormat } from '@/lib/use-format'
import { ClientSheet } from './clients/ClientSheet'

export function ClientsPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const clients = useClients(debounced)
  const [creating, setCreating] = useState(false)

  const columns: Column<ClientListRow>[] = [
    {
      key: 'name',
      header: t('clients.fields.name'),
      cell: (c) => (
        <Link to={`/clients/${c.id}`} className="font-medium underline-offset-4 hover:underline">
          {c.name}
        </Link>
      ),
    },
    { key: 'company', header: t('clients.fields.company'), cell: (c) => c.company ?? '—' },
    { key: 'email', header: t('clients.fields.email'), cell: (c) => c.email ?? '—' },
    { key: 'phone', header: t('clients.fields.phone'), cell: (c) => c.phone ?? '—' },
    {
      key: 'quotes',
      header: t('clients.columns.quotes'),
      className: 'text-right',
      cell: (c) => format.number(c.quoteCount),
    },
    {
      key: 'lastQuote',
      header: t('clients.columns.lastQuote'),
      cell: (c) => (c.lastQuoteAt ? format.date(c.lastQuoteAt) : '—'),
    },
  ]

  return (
    <section>
      <PageHeader
        title={t('nav.clients')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('clients.new')}
          </Button>
        }
      />
      <Input
        type="search"
        aria-label={t('clients.search')}
        placeholder={t('clients.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="mb-4 max-w-sm"
      />
      <DataTable
        query={clients}
        columns={columns}
        rowKey={(c) => c.id}
        caption={t('nav.clients')}
        empty={t(debounced.trim() ? 'clients.noMatches' : 'clients.empty')}
      />
      {creating && <ClientSheet onClose={() => setCreating(false)} />}
    </section>
  )
}
```

In `apps/web/src/app/routes.tsx`, add `import { ClientsPage } from '@/pages/ClientsPage'` and the entry
`'/clients': <ClientsPage />,` to `SECTION_PAGES`.

Add to `it.json`:

```json
  "clients": {
    "empty": "Nessun cliente.",
    "noMatches": "Nessun cliente corrisponde alla ricerca.",
    "search": "Cerca per nome, azienda o email",
    "new": "Nuovo cliente",
    "fields": {
      "name": "Nome",
      "company": "Azienda",
      "email": "Email",
      "phone": "Telefono",
      "notes": "Note interne"
    },
    "columns": {
      "quotes": "Preventivi",
      "lastQuote": "Ultimo preventivo"
    }
  }
```

Add to `en.json`:

```json
  "clients": {
    "empty": "No clients yet.",
    "noMatches": "No clients match your search.",
    "search": "Search by name, company or email",
    "new": "New client",
    "fields": {
      "name": "Name",
      "company": "Company",
      "email": "Email",
      "phone": "Phone",
      "notes": "Internal notes"
    },
    "columns": {
      "quotes": "Quotes",
      "lastQuote": "Last quote"
    }
  }
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- src/pages/ClientsPage.test.tsx src/app/routes.test.tsx src/auth/auth.test.tsx src/layout/AppShell.test.tsx src/i18n/i18n.test.ts`
Expected: PASS. The auth test that lands on `/clients` still finds the `Clienti` heading, which is now the page's
`<h1>`.

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): clients list with server-side search, quote counts and a New client sheet"
```

---

### Task 10: Client detail page

**Files:**
- Create: `apps/web/src/pages/ClientDetailPage.tsx`, `apps/web/src/pages/ClientDetailPage.test.tsx`
- Modify: `apps/web/src/data/clients.ts`, `apps/web/src/pages/NotFoundPage.tsx`, `apps/web/src/app/routes.tsx`, both
  locale files

**Interfaces:**
- Consumes:
  - from Task 9: `useSaveClient`, `clientSchema`, `clientToForm`, `formToClient`, `ClientFields`, `Client`;
  - from Task 6: `useLeaveGuard`, `ConfirmDeleteDialog`, `DataTable`, `QueryError`, `PageHeader`, the shadcn `Badge`;
  - `quoteRow` (Task 3).
- Produces:
  - `type ClientQuote`;
  - `useClient(id: number | null)`, `useClientQuotes(id)`, `useDeleteClient()`;
  - `NotFoundMessage`;
  - the routes `clients/:id` and `quotes/new` (placeholder).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/ClientDetailPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, operatorStaff, quoteRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mario = () =>
  clientRow({ id: 1, name: 'Mario Rossi', phone: '+39 333 1234567', notes: 'Paga a 30 giorni' })

test("shows the client's form and quotes", async () => {
  renderApp('/clients/1', {
    session,
    tables: {
      clients: [mario()],
      quotes: [
        quoteRow({
          id: 7,
          client_id: 1,
          number: 'Q-2026-0007',
          status: 'sent',
          created_at: '2026-10-01T09:00:00Z',
          valid_until: '2026-10-31',
        }),
        quoteRow({ id: 8, client_id: 2, number: 'Q-2026-0008' }),
      ],
    },
  })
  expect(await screen.findByRole('heading', { level: 1, name: 'Mario Rossi' })).toBeInTheDocument()
  expect(screen.getByLabelText('Note interne')).toHaveValue('Paga a 30 giorni')
  const row = await screen.findByRole('row', { name: /Q-2026-0007/ })
  expect(within(row).getByText('Inviato')).toBeInTheDocument()
  expect(within(row).getByText('01/10/2026')).toBeInTheDocument()
  expect(within(row).getByText('31/10/2026')).toBeInTheDocument()
  expect(screen.queryByText('Q-2026-0008')).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Nuovo preventivo per questo cliente' }),
  ).toHaveAttribute('href', '/quotes/new?client=1')
})

test('saves changes and confirms', async () => {
  const { db, user } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  const phone = await screen.findByLabelText('Telefono')
  await user.clear(phone)
  await user.type(phone, '+39 02 123456')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('clients')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: {
      name: 'Mario Rossi',
      company: 'Rossi Meccanica',
      email: 'mario@example.com',
      phone: '+39 02 123456',
      notes: 'Paga a 30 giorni',
    },
  })
})

test('leaving with unsaved changes asks first', async () => {
  const { user, router } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  await user.type(await screen.findByLabelText('Telefono'), '9')
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })

  await user.click(within(nav).getByRole('link', { name: 'Stampanti' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Modifiche non salvate' })
  await user.click(within(dialog).getByRole('button', { name: 'Continua a modificare' }))
  expect(router.state.location.pathname).toBe('/clients/1')

  await user.click(within(nav).getByRole('link', { name: 'Stampanti' }))
  await user.click(await screen.findByRole('button', { name: 'Scarta' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/printers'))
})

test('owners delete a client without quotes and go back to the list without a prompt', async () => {
  const { db, user, router } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  await user.type(await screen.findByLabelText('Telefono'), '9')
  await user.click(await screen.findByRole('button', { name: 'Elimina' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Eliminare il cliente Mario Rossi?',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/clients'))
  expect(
    screen.queryByRole('alertdialog', { name: 'Modifiche non salvate' }),
  ).not.toBeInTheDocument()
  expect(db.calls('clients')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 1]] })
})

test('delete is hidden when the client has quotes', async () => {
  renderApp('/clients/1', {
    session,
    tables: { clients: [mario()], quotes: [quoteRow({ client_id: 1 })] },
  })
  await screen.findByRole('row', { name: /Q-2026-0001/ })
  expect(screen.queryByRole('button', { name: 'Elimina' })).not.toBeInTheDocument()
})

test('operators cannot delete clients', async () => {
  renderApp('/clients/1', { session, staff: operatorStaff, tables: { clients: [mario()] } })
  expect(await screen.findByText('Nessun preventivo.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Elimina' })).not.toBeInTheDocument()
})

test.each(['/clients/999', '/clients/abc'])('%s shows not found', async (path) => {
  renderApp(path, { session, tables: { clients: [mario()] } })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
})

test('New quote for this client opens the quote placeholder with the client', async () => {
  const { user, router } = renderApp('/clients/1', { session, tables: { clients: [mario()] } })
  await user.click(
    await screen.findByRole('link', { name: 'Nuovo preventivo per questo cliente' }),
  )
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Nuovo preventivo' }),
  ).toBeInTheDocument()
  expect(router.state.location.search).toBe('?client=1')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/pages/ClientDetailPage.test.tsx`
Expected: FAIL. `/clients/1` is not routed, so the top-level Not found page renders and no client heading appears.

- [ ] **Step 3: Add the data hooks**

Append to `apps/web/src/data/clients.ts`, and add `AppError` to the `./errors` import:

```ts
export type ClientQuote = Pick<
  Tables<'quotes'>,
  'id' | 'number' | 'status' | 'created_at' | 'valid_until'
>

/** One client, or null when it doesn't exist. `id` null (an invalid URL) disables the query. */
export function useClient(id: number | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.client(id ?? 0),
    enabled: id !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id as number)
        .maybeSingle()
      if (error) throw toAppError(error)
      return data
    },
  })
}

export function useClientQuotes(clientId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.clientQuotes(clientId),
    queryFn: async (): Promise<ClientQuote[]> => {
      const { data, error } = await supabase
        .from('quotes')
        .select('id, number, status, created_at, valid_until')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw toAppError(error)
      return data
    },
  })
}

export function useDeleteClient() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase.from('clients').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
    },
    // Only the lists: refetching the deleted client's own page would flash "not found" before leaving it.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.clientLists }),
  })
}
```

- [ ] **Step 4: Implement the page and routes**

Replace `apps/web/src/pages/NotFoundPage.tsx` with:

```tsx
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

/** The not-found text. NotFoundPage wraps it for unknown URLs; detail pages show it for missing records. */
export function NotFoundMessage() {
  const { t } = useTranslation()
  return (
    <section>
      <h1 className="mb-2 text-2xl font-semibold">{t('pages.notFound.title')}</h1>
      <p className="mb-4 text-muted-foreground">{t('pages.notFound.body')}</p>
      <Link to="/quotes" className="underline-offset-4 hover:underline">
        {t('pages.notFound.back')}
      </Link>
    </section>
  )
}

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <NotFoundMessage />
    </main>
  )
}
```

Create `apps/web/src/pages/ClientDetailPage.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useStaff } from '@/auth/staff-context'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLeaveGuard } from '@/components/use-leave-guard'
import {
  useClient,
  useClientQuotes,
  useDeleteClient,
  useSaveClient,
  type Client,
  type ClientQuote,
} from '@/data/clients'
import { toAppError } from '@/data/errors'
import { useFormat } from '@/lib/use-format'
import { clientSchema, clientToForm, formToClient, type ClientForm } from './clients/client-form'
import { ClientFields } from './clients/ClientFields'
import { NotFoundMessage } from './NotFoundPage'

export function ClientDetailPage() {
  const { t } = useTranslation()
  const { id: rawId } = useParams()
  const id = Number(rawId)
  const valid = Number.isInteger(id) && id > 0
  const client = useClient(valid ? id : null)

  if (!valid) return <NotFoundMessage />
  if (client.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  if (client.isError) {
    return <QueryError error={client.error} onRetry={() => void client.refetch()} />
  }
  if (!client.data) return <NotFoundMessage />
  return <ClientDetail key={client.data.id} client={client.data} />
}

function ClientDetail({ client }: { client: Client }) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const navigate = useNavigate()
  const quotes = useClientQuotes(client.id)
  const save = useSaveClient()
  const remove = useDeleteClient()
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: clientToForm(client),
  })
  const isDirty = form.formState.isDirty
  const guard = useLeaveGuard(isDirty)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false)
    setFormError(null)
    try {
      const updated = await save.mutateAsync({ id: client.id, values: formToClient(values) })
      form.reset(clientToForm(updated))
      setSaved(true)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  async function confirmDelete() {
    setDeleteError(null)
    try {
      await remove.mutateAsync(client.id)
      guard.allowLeaving()
      navigate('/clients')
    } catch (error) {
      const appError = toAppError(error)
      setDeleteError(t(appError.kind === 'inUse' ? 'clients.inUse' : appError.messageKey))
    }
  }

  const canDelete = isOwner && quotes.isSuccess && quotes.data.length === 0
  const columns: Column<ClientQuote>[] = [
    { key: 'number', header: t('clients.detail.number'), cell: (q) => q.number },
    {
      key: 'status',
      header: t('clients.detail.status'),
      cell: (q) => <Badge variant="secondary">{t(`quotes.status.${q.status}`)}</Badge>,
    },
    { key: 'created', header: t('clients.detail.created'), cell: (q) => format.date(q.created_at) },
    {
      key: 'validUntil',
      header: t('clients.detail.validUntil'),
      cell: (q) => format.date(q.valid_until),
    },
  ]

  return (
    <section className="grid gap-8">
      <PageHeader
        title={client.name}
        actions={
          <>
            <Button asChild>
              <Link to={`/quotes/new?client=${client.id}`}>{t('clients.detail.newQuote')}</Link>
            </Button>
            {canDelete && (
              <Button variant="outline" onClick={() => setDeleting(true)}>
                {t('common.delete')}
              </Button>
            )}
          </>
        }
      />
      <form onSubmit={onSubmit} noValidate className="grid max-w-xl gap-4">
        <ClientFields form={form} idPrefix="client" />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        {saved && !isDirty && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.saved')}
          </p>
        )}
        <div>
          <Button type="submit" disabled={!isDirty || save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
      <div>
        <h2 className="mb-3 text-lg font-semibold">{t('clients.detail.quotes')}</h2>
        <DataTable
          query={quotes}
          columns={columns}
          rowKey={(q) => q.id}
          caption={t('clients.detail.quotes')}
          empty={t('clients.detail.noQuotes')}
        />
      </div>
      {deleting && (
        <ConfirmDeleteDialog
          title={t('clients.detail.deleteTitle', { name: client.name })}
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setDeleting(false)
            setDeleteError(null)
          }}
        />
      )}
      {guard.dialog}
    </section>
  )
}
```

In `apps/web/src/app/routes.tsx`:
- add `import { ClientDetailPage } from '@/pages/ClientDetailPage'`;
- add these two children after the `...SECTIONS.map(...)` spread:

```tsx
          { path: 'clients/:id', element: <ClientDetailPage /> },
          { path: 'quotes/new', element: <SectionPage titleKey="quotes.new" /> },
```

Add inside `"clients"` in `it.json`:

```json
    "inUse": "Il cliente ha dei preventivi e non può essere eliminato.",
    "detail": {
      "quotes": "Preventivi del cliente",
      "noQuotes": "Nessun preventivo.",
      "newQuote": "Nuovo preventivo per questo cliente",
      "number": "Numero",
      "status": "Stato",
      "created": "Creato",
      "validUntil": "Valido fino al",
      "deleteTitle": "Eliminare il cliente {{name}}?"
    }
```

and this top-level object:

```json
  "quotes": {
    "new": "Nuovo preventivo",
    "status": {
      "draft": "Bozza",
      "sent": "Inviato",
      "accepted": "Accettato",
      "rejected": "Rifiutato",
      "expired": "Scaduto"
    }
  }
```

Add inside `"clients"` in `en.json`:

```json
    "inUse": "This client has quotes and can't be deleted.",
    "detail": {
      "quotes": "Client's quotes",
      "noQuotes": "No quotes yet.",
      "newQuote": "New quote for this client",
      "number": "Number",
      "status": "Status",
      "created": "Created",
      "validUntil": "Valid until",
      "deleteTitle": "Delete client {{name}}?"
    }
```

and:

```json
  "quotes": {
    "new": "New quote",
    "status": {
      "draft": "Draft",
      "sent": "Sent",
      "accepted": "Accepted",
      "rejected": "Rejected",
      "expired": "Expired"
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/pages/ClientDetailPage.test.tsx src/pages/ClientsPage.test.tsx src/app/routes.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (10 detail tests). The unknown-path test in `routes.test.tsx` still finds "Pagina non trovata".

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): client page with in-place editing, the client's quotes and a guarded delete"
```

---

### Task 11: Settings screen

**Files:**
- Create: `apps/web/src/pages/settings/settings-form.ts`, `apps/web/src/pages/SettingsPage.tsx`,
  `apps/web/src/pages/SettingsPage.test.tsx`
- Modify: `apps/web/src/data/settings.ts`, `apps/web/src/app/routes.tsx`, `apps/web/src/app/routes.test.tsx`, both
  locale files

**Interfaces:**
- Consumes:
  - from Task 4: `useSettings`, `Settings`, `numberField`, `optionalEmail`, `nullIfEmpty`, `parseDecimal`,
    `toInputNumber`;
  - from Task 6: `FormField`, `ReadOnlyField`, `useLeaveGuard`, `QueryError`, `PageHeader`, the shadcn `Textarea`;
  - `Card` (existing).
- Produces:
  - `type SettingsValues = TablesUpdate<'settings'>`, `useSaveSettings()`;
  - `settingsSchema`, `SettingsForm`, `settingsToForm(settings, locale)`, `changedSettings(form, dirtyFields)`;
  - `SettingsEditor` and `SettingsView`, which are local to `SettingsPage.tsx` (Task 12 adds the logo to both).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/SettingsPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

test('owners see the current values in the form', async () => {
  renderApp('/settings', { session })
  expect(await screen.findByLabelText('Costo di avvio')).toHaveValue('3,00')
  expect(screen.getByLabelText('Margine per stampe fallite (%)')).toHaveValue('5')
  expect(screen.getByLabelText('Nome del negozio')).toHaveValue('3D Lab')
  expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled()
})

test('saves only the changed fields', async () => {
  const { db, user } = renderApp('/settings', { session })
  const fee = await screen.findByLabelText('Costo di avvio')
  await user.clear(fee)
  await user.type(fee, '4,5')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { setup_fee: 4.5 },
  })
})

test('currency codes are saved in upper case', async () => {
  const { db, user } = renderApp('/settings', { session })
  const currency = await screen.findByLabelText('Valuta')
  await user.clear(currency)
  await user.type(currency, 'usd')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { currency: 'USD' },
  })
})

test('checks values before saving', async () => {
  const { db, user } = renderApp('/settings', { session })
  const failure = await screen.findByLabelText('Margine per stampe fallite (%)')
  await user.clear(failure)
  await user.type(failure, '150')
  const prefix = screen.getByLabelText('Prefisso numero')
  await user.clear(prefix)
  await user.type(prefix, 'Q-1')
  const currency = screen.getByLabelText('Valuta')
  await user.clear(currency)
  await user.type(currency, 'EURO')
  const validity = screen.getByLabelText('Validità predefinita (giorni)')
  await user.clear(validity)
  await user.type(validity, '0')
  await user.click(screen.getByRole('button', { name: 'Salva' }))

  expect(await screen.findByText('Deve essere tra 0 e 100.')).toBeInTheDocument()
  expect(screen.getByText('Da 1 a 10 lettere o cifre.')).toBeInTheDocument()
  expect(screen.getByText('Usa un codice di 3 lettere, es. EUR.')).toBeInTheDocument()
  expect(screen.getByText('Deve essere tra 1 e 365 giorni.')).toBeInTheDocument()
  expect(db.calls('settings').filter((call) => call.op === 'update')).toHaveLength(0)
})

test('a refused save is explained', async () => {
  const { db, user } = renderApp('/settings', { session })
  const fee = await screen.findByLabelText('Costo di avvio')
  await user.clear(fee)
  await user.type(fee, '4')
  db.failNext('settings', { code: '42501', message: 'permission denied for table settings' })
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Non hai i permessi per questa operazione.')).toBeInTheDocument()
})

test('operators see the settings read-only', async () => {
  renderApp('/settings', { session, staff: operatorStaff })
  expect(await screen.findByText('3D Lab')).toBeInTheDocument()
  expect(screen.getByText('5 %')).toBeInTheDocument()
  expect(screen.getByText('Q')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument()
})
```

In `apps/web/src/app/routes.test.tsx`, delete the `['/settings', 'Impostazioni'],` row from `pages`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/pages/SettingsPage.test.tsx`
Expected: FAIL. `/settings` still renders the placeholder.

- [ ] **Step 3: Implement the save hook and the form module**

Append to `apps/web/src/data/settings.ts`:
- change the imports to `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'` and
  `import type { Tables, TablesUpdate } from '@/lib/database.types'`;
- add:

```ts
export type SettingsValues = TablesUpdate<'settings'>

export function useSaveSettings() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: SettingsValues) => {
      const { data, error } = await supabase
        .from('settings')
        .update(values)
        .eq('id', 1)
        .select()
        .single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}
```

Create `apps/web/src/pages/settings/settings-form.ts`:

```ts
import { z } from 'zod'
import type { Settings, SettingsValues } from '@/data/settings'
import { toInputNumber, type Locale } from '@/lib/format'
import { nullIfEmpty, numberField, optionalEmail, parseDecimal } from '@/lib/forms'

export const settingsSchema = z.object({
  energy_price_kwh: numberField({ min: 0, decimals: 4, rangeError: 'validation.nonNegative' }),
  failure_allowance_pct: numberField({
    min: 0,
    max: 100,
    decimals: 2,
    rangeError: 'validation.percent',
  }),
  setup_fee: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  default_markup_pct: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  minimum_item_price: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'validation.currency'),
  quote_prefix: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/, 'validation.quotePrefix'),
  default_validity_days: numberField({
    min: 1,
    max: 365,
    decimals: 0,
    rangeError: 'validation.validityDays',
  }),
  pdf_terms_it: z.string(),
  pdf_terms_en: z.string(),
  shop_name: z.string(),
  shop_address: z.string(),
  shop_vat_number: z.string(),
  shop_email: optionalEmail,
  shop_phone: z.string(),
})

export type SettingsForm = z.infer<typeof settingsSchema>

export function settingsToForm(settings: Settings, locale: Locale): SettingsForm {
  return {
    energy_price_kwh: toInputNumber(settings.energy_price_kwh, locale),
    failure_allowance_pct: toInputNumber(settings.failure_allowance_pct, locale),
    setup_fee: toInputNumber(settings.setup_fee, locale, 2),
    default_markup_pct: toInputNumber(settings.default_markup_pct, locale),
    minimum_item_price: toInputNumber(settings.minimum_item_price, locale, 2),
    currency: settings.currency,
    quote_prefix: settings.quote_prefix,
    default_validity_days: String(settings.default_validity_days),
    pdf_terms_it: settings.pdf_terms_it ?? '',
    pdf_terms_en: settings.pdf_terms_en ?? '',
    shop_name: settings.shop_name ?? '',
    shop_address: settings.shop_address ?? '',
    shop_vat_number: settings.shop_vat_number ?? '',
    shop_email: settings.shop_email ?? '',
    shop_phone: settings.shop_phone ?? '',
  }
}

/** Only called on values that passed settingsSchema, so every number parses. */
const number = (text: string) => parseDecimal(text) as number

/** The fields the user changed, converted for the database. */
export function changedSettings(
  form: SettingsForm,
  dirtyFields: Partial<Record<keyof SettingsForm, boolean | undefined>>,
): SettingsValues {
  const all: Required<Pick<SettingsValues, keyof SettingsForm>> = {
    energy_price_kwh: number(form.energy_price_kwh),
    failure_allowance_pct: number(form.failure_allowance_pct),
    setup_fee: number(form.setup_fee),
    default_markup_pct: number(form.default_markup_pct),
    minimum_item_price: number(form.minimum_item_price),
    currency: form.currency.trim().toUpperCase(),
    quote_prefix: form.quote_prefix.trim(),
    default_validity_days: number(form.default_validity_days),
    pdf_terms_it: nullIfEmpty(form.pdf_terms_it),
    pdf_terms_en: nullIfEmpty(form.pdf_terms_en),
    shop_name: nullIfEmpty(form.shop_name),
    shop_address: nullIfEmpty(form.shop_address),
    shop_vat_number: nullIfEmpty(form.shop_vat_number),
    shop_email: nullIfEmpty(form.shop_email),
    shop_phone: nullIfEmpty(form.shop_phone),
  }
  return Object.fromEntries(
    Object.entries(all).filter(([key]) => dirtyFields[key as keyof SettingsForm]),
  ) as SettingsValues
}
```

- [ ] **Step 4: Implement the page**

Create `apps/web/src/pages/SettingsPage.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { ReadOnlyField } from '@/components/ReadOnlyField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useLeaveGuard } from '@/components/use-leave-guard'
import { toAppError } from '@/data/errors'
import { useSaveSettings, useSettings, type Settings } from '@/data/settings'
import { useFormat } from '@/lib/use-format'
import {
  changedSettings,
  settingsSchema,
  settingsToForm,
  type SettingsForm,
} from './settings/settings-form'

export function SettingsPage() {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const settings = useSettings()

  let content: ReactNode
  if (settings.isPending) {
    content = (
      <p role="status" className="text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  } else if (settings.isError) {
    content = <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  } else if (isOwner) {
    content = <SettingsEditor settings={settings.data} />
  } else {
    content = <SettingsView settings={settings.data} />
  }

  return (
    <section>
      <PageHeader title={t('nav.settings')} />
      {content}
    </section>
  )
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  )
}

type FieldOptions = { multiline?: boolean; inputMode?: 'decimal' | 'numeric' }

function SettingsEditor({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const save = useSaveSettings()
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsToForm(settings, locale),
  })
  const guard = useLeaveGuard(isDirty)

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false)
    setFormError(null)
    try {
      const updated = await save.mutateAsync(changedSettings(values, dirtyFields))
      reset(settingsToForm(updated, locale))
      setSaved(true)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  const field = (name: keyof SettingsForm, labelKey: string, options: FieldOptions = {}) => {
    const id = `settings-${name}`
    return (
      <FormField key={name} id={id} label={t(labelKey)} error={errors[name]?.message}>
        {options.multiline ? (
          <Textarea id={id} rows={3} aria-invalid={!!errors[name]} {...register(name)} />
        ) : (
          <Input
            id={id}
            inputMode={options.inputMode}
            aria-invalid={!!errors[name]}
            {...register(name)}
          />
        )}
      </FormField>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-6">
      <SettingsCard title={t('settings.pricing.title')}>
        {field('energy_price_kwh', 'settings.pricing.energy', { inputMode: 'decimal' })}
        {field('failure_allowance_pct', 'settings.pricing.failure', { inputMode: 'decimal' })}
        {field('setup_fee', 'settings.pricing.setupFee', { inputMode: 'decimal' })}
        {field('default_markup_pct', 'settings.pricing.markup', { inputMode: 'decimal' })}
        {field('minimum_item_price', 'settings.pricing.minimum', { inputMode: 'decimal' })}
        {field('currency', 'settings.pricing.currency')}
      </SettingsCard>
      <SettingsCard title={t('settings.quotes.title')}>
        {field('quote_prefix', 'settings.quotes.prefix')}
        {field('default_validity_days', 'settings.quotes.validity', { inputMode: 'numeric' })}
        {field('pdf_terms_it', 'settings.quotes.termsIt', { multiline: true })}
        {field('pdf_terms_en', 'settings.quotes.termsEn', { multiline: true })}
      </SettingsCard>
      <SettingsCard title={t('settings.shop.title')}>
        {field('shop_name', 'settings.shop.name')}
        {field('shop_address', 'settings.shop.address', { multiline: true })}
        {field('shop_vat_number', 'settings.shop.vat')}
        {field('shop_email', 'settings.shop.email')}
        {field('shop_phone', 'settings.shop.phone')}
      </SettingsCard>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {t(formError)}
        </p>
      )}
      {saved && !isDirty && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.saved')}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!isDirty || save.isPending}>
          {t('common.save')}
        </Button>
      </div>
      {guard.dialog}
    </form>
  )
}

function SettingsView({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const format = useFormat()
  const percent = (value: number) => `${format.number(value)} %`
  return (
    <div className="grid max-w-3xl gap-6">
      <SettingsCard title={t('settings.pricing.title')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField
            label={t('settings.pricing.energy')}
            value={t('settings.pricing.energyValue', {
              value: format.number(settings.energy_price_kwh),
              currency: settings.currency,
            })}
          />
          <ReadOnlyField
            label={t('settings.pricing.failure')}
            value={percent(settings.failure_allowance_pct)}
          />
          <ReadOnlyField
            label={t('settings.pricing.setupFee')}
            value={format.currency(settings.setup_fee)}
          />
          <ReadOnlyField
            label={t('settings.pricing.markup')}
            value={percent(settings.default_markup_pct)}
          />
          <ReadOnlyField
            label={t('settings.pricing.minimum')}
            value={format.currency(settings.minimum_item_price)}
          />
          <ReadOnlyField label={t('settings.pricing.currency')} value={settings.currency} />
        </dl>
      </SettingsCard>
      <SettingsCard title={t('settings.quotes.title')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label={t('settings.quotes.prefix')} value={settings.quote_prefix} />
          <ReadOnlyField
            label={t('settings.quotes.validity')}
            value={format.number(settings.default_validity_days)}
          />
          <ReadOnlyField label={t('settings.quotes.termsIt')} value={settings.pdf_terms_it} />
          <ReadOnlyField label={t('settings.quotes.termsEn')} value={settings.pdf_terms_en} />
        </dl>
      </SettingsCard>
      <SettingsCard title={t('settings.shop.title')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label={t('settings.shop.name')} value={settings.shop_name} />
          <ReadOnlyField label={t('settings.shop.address')} value={settings.shop_address} />
          <ReadOnlyField label={t('settings.shop.vat')} value={settings.shop_vat_number} />
          <ReadOnlyField label={t('settings.shop.email')} value={settings.shop_email} />
          <ReadOnlyField label={t('settings.shop.phone')} value={settings.shop_phone} />
        </dl>
      </SettingsCard>
    </div>
  )
}
```

In `apps/web/src/app/routes.tsx`, add `import { SettingsPage } from '@/pages/SettingsPage'` and the entry
`'/settings': <SettingsPage />,` to `SECTION_PAGES`.

Add to `it.json`:

```json
  "settings": {
    "pricing": {
      "title": "Prezzi",
      "energy": "Costo energia per kWh",
      "energyValue": "{{value}} {{currency}}/kWh",
      "failure": "Margine per stampe fallite (%)",
      "setupFee": "Costo di avvio",
      "markup": "Ricarico predefinito (%)",
      "minimum": "Prezzo minimo per articolo",
      "currency": "Valuta"
    },
    "quotes": {
      "title": "Preventivi",
      "prefix": "Prefisso numero",
      "validity": "Validità predefinita (giorni)",
      "termsIt": "Condizioni nel PDF (italiano)",
      "termsEn": "Condizioni nel PDF (inglese)"
    },
    "shop": {
      "title": "Dati del negozio",
      "name": "Nome del negozio",
      "address": "Indirizzo",
      "vat": "Partita IVA",
      "email": "Email",
      "phone": "Telefono"
    }
  }
```

Add to `en.json`:

```json
  "settings": {
    "pricing": {
      "title": "Pricing",
      "energy": "Energy price per kWh",
      "energyValue": "{{value}} {{currency}}/kWh",
      "failure": "Failure allowance (%)",
      "setupFee": "Setup fee",
      "markup": "Default markup (%)",
      "minimum": "Minimum item price",
      "currency": "Currency"
    },
    "quotes": {
      "title": "Quotes",
      "prefix": "Number prefix",
      "validity": "Default validity (days)",
      "termsIt": "PDF terms (Italian)",
      "termsEn": "PDF terms (English)"
    },
    "shop": {
      "title": "Shop details",
      "name": "Shop name",
      "address": "Address",
      "vat": "VAT number",
      "email": "Email",
      "phone": "Phone"
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/pages/SettingsPage.test.tsx src/app/routes.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (6 settings tests).

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): settings screen that saves only changed fields, read-only for operators"
```

---

### Task 12: Shop logo upload

**Files:**
- Create: `apps/web/src/pages/settings/LogoField.tsx`
- Modify: `apps/web/src/data/settings.ts`, `apps/web/src/pages/SettingsPage.tsx`,
  `apps/web/src/pages/SettingsPage.test.tsx`, both locale files

**Interfaces:**
- Consumes: `useSettings`/`queryKeys.settings` (Tasks 4 and 11); `FakeDb.storage` and `storageCalls` (Task 3);
  `settingsRow` (Task 3).
- Produces:
  - `LOGO_TYPES`, `LOGO_MAX_BYTES`;
  - `useLogoUrl(path)`, `useUploadLogo()` (mutate `{ file, previousPath }`), `useRemoveLogo()` (mutate `path`);
  - `<LogoField path editable />`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/pages/SettingsPage.test.tsx`, adding these imports at the top: `userEvent` from
`@testing-library/user-event`, `waitFor` from `@testing-library/react`, and `settingsRow` from `@/test/fixtures`.

```tsx
const png = () => new File(['png'], 'logo.png', { type: 'image/png' })
const withLogo = { settings: [{ ...settingsRow, shop_logo_path: 'logo-1.png' }] }

test('uploads a logo and shows it', async () => {
  const { db, user } = renderApp('/settings', { session })
  await user.upload(await screen.findByLabelText('Carica logo'), png())
  expect(await screen.findByRole('img', { name: 'Logo del negozio' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^https:\/\/storage\.test\/branding\/logo-\d+\.png$/),
  )
  expect(db.storageCalls('branding')).toContainEqual({
    op: 'upload',
    paths: [expect.stringMatching(/^logo-\d+\.png$/)],
  })
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { shop_logo_path: expect.stringMatching(/^logo-\d+\.png$/) },
  })
})

test('replacing the logo deletes the old file', async () => {
  const { db, user } = renderApp('/settings', { session, tables: withLogo })
  expect(await screen.findByRole('img', { name: 'Logo del negozio' })).toHaveAttribute(
    'src',
    'https://storage.test/branding/logo-1.png',
  )
  await user.upload(screen.getByLabelText('Carica logo'), png())
  await waitFor(() =>
    expect(db.storageCalls('branding')).toContainEqual({ op: 'remove', paths: ['logo-1.png'] }),
  )
})

test('rejects files of the wrong type or over 1 MB before uploading', async () => {
  // The input's accept attribute would filter the GIF out; the check under test is the page's own.
  const user = userEvent.setup({ applyAccept: false })
  const { db } = renderApp('/settings', { session })
  const input = await screen.findByLabelText('Carica logo')
  await user.upload(input, new File(['gif'], 'logo.gif', { type: 'image/gif' }))
  expect(await screen.findByText('Usa un file PNG, JPG o SVG.')).toBeInTheDocument()
  await user.upload(
    input,
    new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
  )
  expect(await screen.findByText('Il file supera 1 MB.')).toBeInTheDocument()
  expect(db.storageCalls('branding').filter((call) => call.op === 'upload')).toHaveLength(0)
})

test('removes the logo', async () => {
  const { db, user } = renderApp('/settings', { session, tables: withLogo })
  await user.click(await screen.findByRole('button', { name: 'Rimuovi logo' }))
  expect(await screen.findByText('Nessun logo.')).toBeInTheDocument()
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { shop_logo_path: null },
  })
  expect(db.storageCalls('branding')).toContainEqual({ op: 'remove', paths: ['logo-1.png'] })
})

test('operators see the logo without upload controls', async () => {
  renderApp('/settings', { session, staff: operatorStaff, tables: withLogo })
  expect(await screen.findByRole('img', { name: 'Logo del negozio' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Carica logo')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Rimuovi logo' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/pages/SettingsPage.test.tsx`
Expected: the 5 new tests FAIL (no "Carica logo" control or logo image); the 6 from Task 11 pass.

- [ ] **Step 3: Implement the logo hooks**

Append to `apps/web/src/data/settings.ts`:

```ts
/** Allowed logo types and the file extension each is stored with (functional analysis §3.8). */
export const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
}
export const LOGO_MAX_BYTES = 1024 * 1024

/** A signed URL for the private branding bucket, valid for an hour; refreshed well before it expires. */
export function useLogoUrl(path: string | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.logoUrl(path ?? ''),
    enabled: path !== null,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('branding')
        .createSignedUrl(path as string, 3600)
      if (error) throw toAppError(error)
      return data.signedUrl
    },
  })
}

export function useUploadLogo() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, previousPath }: { file: File; previousPath: string | null }) => {
      const path = `logo-${Date.now()}.${LOGO_TYPES[file.type]}`
      const upload = await supabase.storage
        .from('branding')
        .upload(path, file, { contentType: file.type })
      if (upload.error) throw toAppError(upload.error)
      const { data, error } = await supabase
        .from('settings')
        .update({ shop_logo_path: path })
        .eq('id', 1)
        .select()
        .single()
      if (error) throw toAppError(error)
      // A leftover old file is harmless, so a failed removal is ignored.
      if (previousPath) await supabase.storage.from('branding').remove([previousPath])
      return data
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}

export function useRemoveLogo() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase
        .from('settings')
        .update({ shop_logo_path: null })
        .eq('id', 1)
        .select()
        .single()
      if (error) throw toAppError(error)
      await supabase.storage.from('branding').remove([path])
      return data
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}
```

- [ ] **Step 4: Implement the field and place it**

Create `apps/web/src/pages/settings/LogoField.tsx`:

```tsx
import { useId, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toAppError } from '@/data/errors'
import {
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  useLogoUrl,
  useRemoveLogo,
  useUploadLogo,
} from '@/data/settings'

/** The shop logo. Uploads and removals save at once, separately from the settings form's Save. */
export function LogoField({ path, editable }: { path: string | null; editable: boolean }) {
  const { t } = useTranslation()
  const inputId = useId()
  const url = useLogoUrl(path)
  const upload = useUploadLogo()
  const remove = useRemoveLogo()
  const [error, setError] = useState<string | null>(null)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    if (!(file.type in LOGO_TYPES)) {
      setError(t('settings.logo.badType'))
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(t('settings.logo.tooBig'))
      return
    }
    try {
      await upload.mutateAsync({ file, previousPath: path })
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  async function onRemove() {
    if (!path) return
    setError(null)
    try {
      await remove.mutateAsync(path)
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{t('settings.logo.label')}</span>
      {path ? (
        url.data ? (
          <img
            src={url.data}
            alt={t('settings.logo.alt')}
            className="h-16 w-auto self-start rounded border bg-white p-1"
          />
        ) : (
          <Skeleton className="h-16 w-32" />
        )
      ) : (
        <p className="text-sm text-muted-foreground">{t('settings.logo.none')}</p>
      )}
      {editable && (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{t('settings.logo.upload')}</Label>
          <Input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            disabled={upload.isPending}
            onChange={(event) => void onFile(event)}
          />
          <p className="text-xs text-muted-foreground">{t('settings.logo.hint')}</p>
          {path && (
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => void onRemove()}
              >
                {t('settings.logo.remove')}
              </Button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
```

In `apps/web/src/pages/SettingsPage.tsx`:
- add `import { LogoField } from './settings/LogoField'`;
- in `SettingsEditor`, add `<LogoField path={settings.shop_logo_path} editable />` as the last child of the Shop
  details `SettingsCard`;
- in `SettingsView`, add `<LogoField path={settings.shop_logo_path} editable={false} />` after the shop `<dl>`, inside
  the same card.

`SettingsEditor` receives `settings` from the page. After an upload, `setQueryData` updates it, so the new path reaches
`LogoField` without remounting the form.

Add inside `"settings"` in `it.json`:

```json
    "logo": {
      "label": "Logo",
      "alt": "Logo del negozio",
      "upload": "Carica logo",
      "remove": "Rimuovi logo",
      "none": "Nessun logo.",
      "hint": "PNG, JPG o SVG, massimo 1 MB.",
      "badType": "Usa un file PNG, JPG o SVG.",
      "tooBig": "Il file supera 1 MB."
    }
```

Add inside `"settings"` in `en.json`:

```json
    "logo": {
      "label": "Logo",
      "alt": "Shop logo",
      "upload": "Upload logo",
      "remove": "Remove logo",
      "none": "No logo.",
      "hint": "PNG, JPG or SVG, up to 1 MB.",
      "badType": "Use a PNG, JPG or SVG file.",
      "tooBig": "The file is larger than 1 MB."
    }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/pages/SettingsPage.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (11 settings tests).

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): upload, replace and remove the shop logo in the branding bucket"
```

---

### Task 13: Staff list

**Files:**
- Create: `apps/web/src/pages/StaffPage.tsx`, `apps/web/src/pages/StaffPage.test.tsx`
- Modify: `apps/web/src/data/staff.ts`, `apps/web/src/app/routes.tsx`, `apps/web/src/app/routes.test.tsx`, both locale files

**Interfaces:**
- Consumes:
  - `list_staff` in the generated types (Task 2);
  - `RequireOwner` and `useStaff` (Task 5);
  - `DataTable`, `PageHeader` and the shadcn `NativeSelect` (Task 6);
  - `renderApp({ rpc })` (Task 3).
- Produces:
  - `type StaffMember`;
  - `useStaffList()`;
  - `useSetStaffRole()`, mutating `{ userId, role }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/StaffPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NETWORK_FAILURE } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const member = (userId: string, name: string, email: string, role: string, active = true) => ({
  user_id: userId,
  display_name: name,
  email,
  role,
  language: 'it',
  active,
  created_at: '2026-01-01T09:00:00Z',
})
const members = [
  member('user-1', 'Anna Rossi', 'anna@example.com', 'owner'),
  member('user-2', 'Bruno Verdi', 'bruno@example.com', 'owner'),
  member('user-3', 'Otto Bianchi', 'otto@example.com', 'operator', false),
]
const rpc = { list_staff: () => members }

test('lists staff with emails, roles and whether they are active', async () => {
  const { db } = renderApp('/staff', { session, rpc })
  const row = await screen.findByRole('row', { name: /Otto Bianchi/ })
  expect(within(row).getByText('otto@example.com')).toBeInTheDocument()
  expect(within(row).getByRole('combobox', { name: 'Ruolo di Otto Bianchi' })).toHaveValue(
    'operator',
  )
  expect(within(row).getByText('No')).toBeInTheDocument()
  expect(db.rpcCalls('list_staff')).toHaveLength(1)
})

test('changing a role updates the staff record', async () => {
  const { db, user } = renderApp('/staff', { session, rpc })
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Ruolo di Otto Bianchi' }),
    'owner',
  )
  await waitFor(() =>
    expect(db.calls('staff')).toContainEqual({
      op: 'update',
      values: { role: 'owner' },
      filters: [['eq', 'user_id', 'user-3']],
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
```

In `apps/web/src/app/routes.test.tsx`, delete the `['/staff', 'Personale'],` row from `pages`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/pages/StaffPage.test.tsx`
Expected: FAIL. `/staff` still renders the placeholder inside `RequireOwner`.

- [ ] **Step 3: Implement the hooks and page**

Append to `apps/web/src/data/staff.ts`, adding `import type { Database } from '@/lib/database.types'`:

```ts
export type StaffMember = Database['public']['Functions']['list_staff']['Returns'][number]

/** Everyone on staff with their login email (owner only; the function refuses anyone else). */
export function useStaffList() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.staffList,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_staff')
      if (error) throw toAppError(error)
      return data
    },
  })
}

export function useSetStaffRole() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'owner' | 'operator' }) => {
      const { error } = await supabase
        .from('staff')
        .update({ role })
        .eq('user_id', userId)
        .select('user_id')
        .single()
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staffAll }),
  })
}
```

Create `apps/web/src/pages/StaffPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toAppError } from '@/data/errors'
import { useSetStaffRole, useStaffList, type StaffMember } from '@/data/staff'

/** Owner only (wrapped in RequireOwner). The select shows the saved role, so a refused change snaps back. */
export function StaffPage() {
  const { t } = useTranslation()
  const me = useStaff()
  const members = useStaffList()
  const setRole = useSetStaffRole()

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: t('staff.columns.name'),
      cell: (m) => <span className="font-medium">{m.display_name}</span>,
    },
    { key: 'email', header: t('staff.columns.email'), cell: (m) => m.email },
    {
      key: 'role',
      header: t('staff.columns.role'),
      cell: (m) => (
        <NativeSelect
          aria-label={t('staff.roleFor', { name: m.display_name })}
          value={m.role}
          // Your own role can't be changed here, so an owner can't demote themselves by accident.
          disabled={m.user_id === me.userId || setRole.isPending}
          onChange={(event) =>
            setRole.mutate({
              userId: m.user_id,
              role: event.target.value === 'owner' ? 'owner' : 'operator',
            })
          }
        >
          <NativeSelectOption value="owner">{t('staff.roles.owner')}</NativeSelectOption>
          <NativeSelectOption value="operator">{t('staff.roles.operator')}</NativeSelectOption>
        </NativeSelect>
      ),
    },
    {
      key: 'active',
      header: t('staff.columns.active'),
      cell: (m) => t(m.active ? 'common.yes' : 'common.no'),
    },
  ]

  return (
    <section>
      <PageHeader title={t('nav.staff')} />
      <p className="mb-4 text-sm text-muted-foreground">{t('staff.note')}</p>
      {setRole.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(toAppError(setRole.error).messageKey)}
        </p>
      )}
      <DataTable
        query={members}
        columns={columns}
        rowKey={(m) => m.user_id}
        caption={t('nav.staff')}
        empty={t('staff.empty')}
      />
    </section>
  )
}
```

In `apps/web/src/app/routes.tsx`:
- add `import { StaffPage } from '@/pages/StaffPage'`;
- change the `'/staff'` entry in `SECTION_PAGES` to:

```tsx
  '/staff': (
    <RequireOwner>
      <StaffPage />
    </RequireOwner>
  ),
```

Add to `it.json`:

```json
  "staff": {
    "note": "Per invitare o rimuovere persone si usa ancora la dashboard di Supabase.",
    "empty": "Nessun membro del personale.",
    "roleFor": "Ruolo di {{name}}",
    "columns": {
      "name": "Nome",
      "email": "Email",
      "role": "Ruolo",
      "active": "Attivo"
    },
    "roles": {
      "owner": "Titolare",
      "operator": "Operatore"
    }
  }
```

Add to `en.json`:

```json
  "staff": {
    "note": "Inviting or removing people still happens in the Supabase dashboard.",
    "empty": "No staff yet.",
    "roleFor": "Role of {{name}}",
    "columns": {
      "name": "Name",
      "email": "Email",
      "role": "Role",
      "active": "Active"
    },
    "roles": {
      "owner": "Owner",
      "operator": "Operator"
    }
  }
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/pages/StaffPage.test.tsx src/app/routes.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (5 staff tests; the operator `/staff` test in `routes.test.tsx` still shows "Non disponibile per il tuo
ruolo").

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): owner-only staff list with emails and role changes"
```

---

### Task 14: Account page and password-reset completion

**Files:**
- Create: `apps/web/src/data/account.ts`, `apps/web/src/pages/AccountPage.tsx`, `apps/web/src/pages/AccountPage.test.tsx`
- Modify: `apps/web/src/pages/ForgotPasswordPage.tsx`, `apps/web/src/pages/ForgotPasswordPage.test.tsx`,
  `apps/web/src/app/routes.tsx`, `apps/web/src/app/routes.test.tsx`, both locale files

**Interfaces:**
- Consumes:
  - `useStaff` and `useChangeLanguage` (Task 5);
  - `useSaveOwnProfile` (Task 5);
  - `FormField` and `useLeaveGuard` (Task 6);
  - `requiredText`, `AppError` and `toAppError` (Task 4);
  - `auth.updateUser` on the fake (Task 3).
- Produces: `useChangePassword()` (mutate `password`) and `AccountPage`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/AccountPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

async function fillPasswords(user: ReturnType<typeof renderApp>['user'], first: string, second: string) {
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
  expect(screen.queryByText('Scegli una nuova password.')).not.toBeInTheDocument()
})
```

In `apps/web/src/pages/ForgotPasswordPage.test.tsx`, change the expected `redirectTo` to
`` `${window.location.origin}/account?reset=1` ``.

In `apps/web/src/app/routes.test.tsx`, delete the `['/account', 'Account'],` row from `pages`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/pages/AccountPage.test.tsx src/pages/ForgotPasswordPage.test.tsx`
Expected: FAIL. `/account` is the placeholder, and the reset email still links to `/account`.

- [ ] **Step 3: Implement**

Create `apps/web/src/data/account.ts`:

```ts
import { useMutation } from '@tanstack/react-query'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'

const PASSWORD_ERRORS: Record<string, string> = {
  weak_password: 'account.password.weak',
  same_password: 'account.password.same',
}

export function useChangePassword() {
  const supabase = useSupabase()
  return useMutation({
    mutationFn: async (password: string) => {
      const { error } = await supabase.auth.updateUser({ password })
      if (!error) return
      const messageKey = error.code ? PASSWORD_ERRORS[error.code] : undefined
      throw messageKey ? new AppError('invalid', { messageKey, cause: error }) : toAppError(error)
    },
  })
}
```

Create `apps/web/src/pages/AccountPage.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { useStaff } from '@/auth/staff-context'
import { useChangeLanguage } from '@/auth/use-change-language'
import { FormField } from '@/components/FormField'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useLeaveGuard } from '@/components/use-leave-guard'
import { useChangePassword } from '@/data/account'
import { toAppError } from '@/data/errors'
import { useSaveOwnProfile } from '@/data/staff'
import { LANGUAGES, type Language } from '@/i18n'
import { requiredText } from '@/lib/forms'

const profileSchema = z.object({ display_name: requiredText(100) })
type ProfileForm = z.infer<typeof profileSchema>

const passwordSchema = z
  .object({ password: z.string().min(6, 'validation.passwordLength'), confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'validation.passwordMismatch',
  })
type PasswordForm = z.infer<typeof passwordSchema>

export function AccountPage() {
  const { t } = useTranslation()
  return (
    <section className="grid max-w-xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.account')}</h1>
      <ProfileCard />
      <PasswordCard />
    </section>
  )
}

function ProfileCard() {
  const { t, i18n } = useTranslation()
  const staff = useStaff()
  const save = useSaveOwnProfile()
  const language = useChangeLanguage()
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: staff.displayName },
  })
  const guard = useLeaveGuard(isDirty)

  const onSubmit = handleSubmit(async ({ display_name }) => {
    setSaved(false)
    setFormError(null)
    try {
      await save.mutateAsync({ userId: staff.userId, display_name })
      reset({ display_name })
      setSaved(true)
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('account.profile.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField
            id="account-name"
            label={t('account.profile.name')}
            error={errors.display_name?.message}
          >
            <Input
              id="account-name"
              autoComplete="name"
              aria-invalid={!!errors.display_name}
              {...register('display_name')}
            />
          </FormField>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}
          {saved && !isDirty && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('common.saved')}
            </p>
          )}
          <div>
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
        <FormField id="account-language" label={t('account.profile.language')}>
          <NativeSelect
            id="account-language"
            value={i18n.language}
            onChange={(event) => void language.change(event.target.value as Language)}
          >
            {LANGUAGES.map((lng) => (
              <NativeSelectOption key={lng} value={lng}>
                {t(`language.${lng}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {language.saveFailed && (
          <p role="alert" className="text-sm text-destructive">
            {t('language.saveFailed')}
          </p>
        )}
      </CardContent>
      {guard.dialog}
    </Card>
  )
}

/** Also completes a password reset: the reset email links to /account?reset=1 with a recovery session. */
function PasswordCard() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const resetting = params.get('reset') === '1'
  const change = useChangePassword()
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const passwordInput = useRef<HTMLInputElement | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirm: '' },
  })
  const passwordField = register('password')

  useEffect(() => {
    if (resetting) passwordInput.current?.focus()
  }, [resetting])

  const onSubmit = handleSubmit(async ({ password }) => {
    setDone(false)
    setFormError(null)
    try {
      await change.mutateAsync(password)
      reset()
      setDone(true)
      if (resetting) setParams({}, { replace: true })
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('account.password.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {resetting && (
            <Alert>
              <AlertDescription>{t('account.password.resetBanner')}</AlertDescription>
            </Alert>
          )}
          <FormField
            id="account-password"
            label={t('account.password.new')}
            error={errors.password?.message}
          >
            <Input
              id="account-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...passwordField}
              ref={(element) => {
                passwordField.ref(element)
                passwordInput.current = element
              }}
            />
          </FormField>
          <FormField
            id="account-confirm"
            label={t('account.password.confirm')}
            error={errors.confirm?.message}
          >
            <Input
              id="account-confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              {...register('confirm')}
            />
          </FormField>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('account.password.changed')}
            </p>
          )}
          <div>
            <Button type="submit" disabled={change.isPending}>
              {t('account.password.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

In `apps/web/src/pages/ForgotPasswordPage.tsx`, change `redirectTo` to `` `${window.location.origin}/account?reset=1` ``.

In `apps/web/src/app/routes.tsx`:
- add `import { AccountPage } from '@/pages/AccountPage'`;
- change the account route to `{ path: 'account', element: <AccountPage /> },`.

Add to `it.json`:

```json
  "account": {
    "profile": {
      "title": "Profilo",
      "name": "Nome visualizzato",
      "language": "Lingua dell'interfaccia"
    },
    "password": {
      "title": "Password",
      "new": "Nuova password",
      "confirm": "Conferma password",
      "submit": "Cambia password",
      "changed": "Password aggiornata.",
      "resetBanner": "Scegli una nuova password.",
      "weak": "La password è troppo debole.",
      "same": "La nuova password deve essere diversa da quella attuale."
    }
  }
```

Add to `en.json`:

```json
  "account": {
    "profile": {
      "title": "Profile",
      "name": "Display name",
      "language": "Interface language"
    },
    "password": {
      "title": "Password",
      "new": "New password",
      "confirm": "Confirm password",
      "submit": "Change password",
      "changed": "Password updated.",
      "resetBanner": "Choose a new password.",
      "weak": "That password is too weak.",
      "same": "The new password must be different from the current one."
    }
  }
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/pages/AccountPage.test.tsx src/pages/ForgotPasswordPage.test.tsx src/app/routes.test.tsx src/i18n/i18n.test.ts`
Expected: PASS (6 account tests). `routes.test.tsx`'s `pages` now holds only `['/quotes', 'Preventivi']`.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run build && npm run lint && npm run format`

```bash
git add apps/web/src
git commit -m "feat(web): account page for name, language and password; finish the password-reset flow"
```

---

### Task 15: Documentation and final verification

**Files:**
- Modify: `docs/frontend/web-app.md`, `docs/supabase/data-model.md`, `docs/development/getting-started.md`,
  `docs/superpowers/specs/2026-10-12-web-catalog-settings-design.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Update the web app guide**

In `docs/frontend/web-app.md`:

1. Add these rows to the commands table under **Running**:

```markdown
| `npm run gen:types` | Regenerate `apps/web/src/lib/database.types.ts` from the local database (`supabase start` must be running) |
| `npm run check:types-fresh` | Fail if the committed types differ from the local database; run after schema changes |
```

2. Replace the **Structure** tree with:

````markdown
```
apps/web/src/
├── main.tsx          # initialises i18n, reads env, renders <App>
├── index.css         # Tailwind + shadcn theme tokens
├── app/              # App, AppProviders, routes (SECTION_PAGES), sections
├── lib/              # env, typed Supabase client, generated database types, query client, formatting, form helpers
├── data/             # one TanStack Query module per entity, AppError mapping, query keys
├── i18n/             # i18next setup, language detection/switching, locales/it.json + en.json
├── auth/             # session (AuthProvider, RequireAuth), staff profile (StaffProvider, useStaff), RequireOwner
├── layout/           # AppShell (sidebar / drawer), Navigation, LanguageSwitcher
├── pages/            # one component per page, plus a folder per page for its form and sheet
├── components/       # shared building blocks (DataTable, FormField, FormSheet, dialogs, leave guard)
├── components/ui/    # shadcn components (owned code, generated by the shadcn CLI)
└── test/             # setup, fake Supabase client with an in-memory query builder, fixtures, renderApp
```
````

3. Replace the bullets from **Supabase** through **Tests** in **Conventions** with:

```markdown
- **Data** goes through `src/data/`: one module per entity exporting TanStack Query hooks (`usePrinters`,
  `useSavePrinter`, …). Pages never call Supabase directly. Hooks reach Supabase only through `useSupabase()`, which
  returns a client typed from `src/lib/database.types.ts`. Regenerate the types with `npm run gen:types` after every
  schema change.
- **Errors:** hooks throw `AppError` (`src/data/errors.ts`), which maps Postgres/PostgREST codes to a `kind` and an
  i18n `messageKey`. A duplicate also names the field. Saves end in `.select().single()` and deletes in `.select('id')`,
  so a write that RLS silently filters out becomes `notFound` instead of looking like success.
- **Roles:** `useStaff()` gives `{ userId, displayName, role, isOwner, language }`. Hide owner-only actions; don't
  disable them. Wrap owner-only pages in `<RequireOwner>`. The database (RLS) is the authority.
- **Forms:** react-hook-form + zod. Numbers are text fields checked by `numberField()`, which accepts `0,40` and `0.40`
  with the same limits as the database. Messages are i18n keys shown by `FormField`. Create/edit forms open in a
  `FormSheet`; full-page forms call `useLeaveGuard(isDirty)`.
- **Formatting:** `useFormat()` for numbers, money (the shop currency) and dates in the UI language.
- **UI components:** add them with the shadcn CLI installed in the workspace (not `@latest`), never by hand:

  ```bash
  npx shadcn add <component> -c apps/web
  ```

  It overwrites `button.tsx` and `label.tsx` when they are dependencies. Restore them with
  `git checkout -- apps/web/src/components/ui/button.tsx apps/web/src/components/ui/label.tsx`, because they carry the
  `pointer-coarse` touch-target sizes. Run `npm run format` afterwards.
- **Tests** sit next to the code as `*.test.ts(x)` and query by role and visible (Italian) text.
  `renderApp(path, { session, staff, tables, rpc })` renders the real routes against a fake Supabase client:
  - `staff` is the signed-in user's staff row (default: an owner; `null` means no access);
  - `tables` seeds in-memory rows;
  - `rpc` maps function names to handlers.

  It returns `{ db, user, auth, router }`:
  - `db.calls('printers')` lists the requests made (`{ op, values, filters }`);
  - `db.failNext('printers', { code, message })` makes the next one fail;
  - fixtures live in `src/test/fixtures.ts`.
```

4. In **Adding a section page**, change step 3 to:

```markdown
3. In `src/app/routes.tsx`, add the page to `SECTION_PAGES` (wrap it in `<RequireOwner>` if it is owner-only, and
   set `ownerOnly: true` in `SECTIONS`).
```

5. Replace **Not done yet** with:

```markdown
## Not done yet

- **Quotes** — list, editor and pricing; `/quotes/new?client=<id>` is a placeholder the quotes work will read.
- **Inviting, removing and deactivating staff** — needs an Edge Function; until then use the Supabase dashboard.
- **Redirect URLs** — the reset email links to `<origin>/account?reset=1`. Allow it under Supabase → Authentication →
  URL Configuration → **Redirect URLs** for every environment (for example `https://<host>/account**`), or Supabase
  falls back to the Site URL.
- **Bundle size** — the single JS chunk is ~700 kB (~210 kB gzip); split routes with lazy loading.
- **End-to-end tests** (Playwright).
```

- [ ] **Step 2: Update the data model and getting-started docs**

In `docs/supabase/data-model.md`:
- add this row at the top of the **Web app functions** table:

```markdown
| `list_staff() → table(user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamptz)` | owner | Every staff row with the login email from `auth.users` (which the API can't read), ordered by display name. Raises `owner_required` for anyone else. |
```

- in the `## Errors` table, check that the `42501` row already lists `owner_required` (it does; nothing to add).

In `docs/development/getting-started.md`, in **Changing the schema**, add this step after step 4:

```markdown
5. If tables, columns or functions changed, run `npm run gen:types` and commit `apps/web/src/lib/database.types.ts`.
```

In `docs/superpowers/specs/2026-10-12-web-catalog-settings-design.md`, change `- **Status:** Draft — awaiting review` to
`- **Status:** Implemented`.

- [ ] **Step 3: Full verification**

Run, from the repo root:

```bash
npm run build && npm run lint && npm run format:check && npm test
supabase test db
supabase db diff
npm run check:types-fresh
```

Expected:
- build, lint, format and tests all pass;
- `supabase test db` passes all 11 files;
- `supabase db diff` prints `No schema changes found`;
- `check:types-fresh` prints `src/lib/database.types.ts is up to date.`

- [ ] **Step 4: Manual smoke check (local stack)**

Run `npm run dev` with `apps/web/.env.local` pointing at the local stack. Then:
- log in as `owner@3dquote.local` (password `password123`) and open each section: edit a printer, add a material (check
  the density pre-fill), search clients and open Mario Rossi, change a setting, upload a PNG logo, open Staff;
- log in as `operator@3dquote.local`: Staff is gone from the sidebar, and Printers, Materials and Settings are
  read-only.

Note anything that differs from the spec in the final report rather than fixing it silently.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: document the data layer, roles, forms and test helpers; list_staff in the data model"
```
