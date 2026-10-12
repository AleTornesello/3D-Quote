# Web Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the quotes list, the New quote sheet and the quote editor (uploads, item settings, live slicing
status, prices, overrides, lifecycle actions, duplicate, delete) in `apps/web`.

**Architecture:**
- A `security_invoker` view `quotes_list` feeds the paginated, filterable list through PostgREST.
- The editor reads the quote and its items (with each item's newest slicing job). It saves item changes as soon as
  they happen, and it refetches the items whenever Supabase Realtime reports a change to `quote_items` or
  `slicing_jobs`.
- The editor calls the `price-quote` Edge Function whenever it sees an item with results but no price.
- Models upload with `tus-js-client` to Supabase Storage's resumable endpoint.

**Tech Stack:**
- React 19, TypeScript 6, Vite 8, TanStack Query 5, react-router 8, react-hook-form + zod 4, react-i18next;
- shadcn (radix-nova style) plus `sonner`, `tus-js-client` 4, `@supabase/supabase-js` 2.117;
- Vitest 5 + Testing Library;
- Supabase CLI local stack with pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-13-web-quotes-design.md`

## Global Constraints

- Run every command from the repository root `C:\Progetti\3D-Quote` (the parent folder `C:\Progetti` has an unrelated
  npm project that npm can escape into). Install web dependencies with `--workspace @3d-quote/web`.
- **Git and cloud:**
  - Commit on `develop`. Never push, never merge to `main`.
  - Never touch any cloud Supabase project. Migrations go to the local stack only.
- **Data access:** pages and components never call Supabase directly. Everything goes through hooks in
  `apps/web/src/data/`, which use `useSupabase()` and throw `AppError` (via `toAppError`).
- **Text:** every user-visible string goes through `t()`. Each key goes in **both** `apps/web/src/i18n/locales/it.json`
  and `en.json`; `i18n.test.ts` fails if the catalogs differ. Tests query by role and the Italian text.
- **Roles:** owner-only controls are hidden from operators, not disabled. Controls that change a quote are rendered only
  while the quote's status is `draft`.
- **Style:** Prettier (no semicolons, single quotes, width 100), ESLint with `jsx-a11y`. Comments are sparse and explain
  *why*. Run `npm run format` before each commit.
- **shadcn:** add components only with `npx shadcn add <name> -c apps/web`, then restore the touch-target sizes with
  `git checkout -- apps/web/src/components/ui/button.tsx apps/web/src/components/ui/label.tsx`, then
  `npm run format`.
- **Numbers and time:**
  - Money comes from the database as numbers and is only displayed (`useFormat().currency`); the web app never
    computes a price, except `unit price = item_total / quantity`, shown rounded to 2 decimals.
  - "Shop today" is the date in `Europe/Rome` (`shopToday()`).
- **Limits copied from the spec:**
  - 25 quotes per page; 100 MB (104 857 600 bytes) per model file; `.stl` and `.3mf` only;
  - at most 3 uploads at once;
  - slow-queue warning after more than 10 minutes queued;
  - Realtime refetch debounce 250 ms;
  - "Expires soon" when a sent quote's valid-until is between shop today and shop today + 7 days;
  - signed download URLs valid 60 s; tus `chunkSize` 6 MB.
- **Done means:** from the repo root, all of these pass:
  - `npm run build`, `npm run lint`, `npm run format:check`, `npm test`;
  - `supabase test db`; `supabase db diff` prints "No schema changes found"; `npm run check:types-fresh`.

## Review Focus

1. **An automatic pricing loop.** If `price-quote` keeps answering `skipped > 0` (another tab keeps changing the
   item), the editor must stop after one retry and show "Price not calculated" instead of calling forever. Pinned in
   Task 9 (`gives up after one retry and says so`).
2. **An upload that finishes after the quote stopped being a draft.** Another user sends the quote while a file uploads,
   so `create_quote_item` fails with `quote_not_draft`. The uploaded object must be removed and the page must turn
   read-only. Pinned in Task 8 (`an item that can't be created removes its file and refreshes the quote`).
3. **An item on a since-deactivated printer.** The printer select must still show that printer, and saving another
   setting (supports) must send the item's real printer id, not the first active printer. Pinned in Task 7
   (`keeps an inactive printer selected and sends it with other changes`).
4. **Enter, then blur, on a number field.** This must save once, not twice: each save re-slices the item. Pinned in
   Task 7 (`Enter then blur saves the layer height once`).
5. **A list URL past the last page** (a bookmark after quotes were deleted). PostgREST answers `PGRST103`; the list
   must go back to page 1 instead of showing an error. Pinned in Task 4 (`a page past the end goes back to page 1`).

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `supabase/schemas/08_quotes_list.sql` | The `quotes_list` view | 1 |
| `supabase/schemas/90_grants.sql` | Comment naming the view under the table grants | 1 |
| `supabase/migrations/<ts>_quotes_list.sql` | Generated: the view | 1 |
| `supabase/migrations/<ts>_quotes_list_setup.sql` | Hand-written: view grants, Realtime publication | 1 |
| `supabase/tests/database/12_quotes_list.test.sql` | pgTAP for the view and the publication | 1 |
| `apps/web/src/lib/database.types.ts` | Regenerated types | 1 |
| `apps/web/src/data/errors.ts` | New kinds and mappings; `fromFunctionCode`, `fromUploadResponse` | 2 |
| `apps/web/src/data/edge-functions.ts` | `invokeFunction` | 2 |
| `apps/web/src/test/fake-db.ts`, `fake-supabase.ts`, `render-app.tsx` | Fake `functions.invoke`; later `in`/`gte`/`lte`/`range`/count, Realtime, uploader | 2, 4, 8, 9 |
| `apps/web/src/lib/format.ts` | `shopToday`, `addDays`, `formatDuration`, `formatElapsed` | 3 |
| `apps/web/src/lib/use-now.ts` | `useNow`: the time, ticking each second while active | 3 |
| `apps/web/src/data/quote-rules.ts` | Pure rules: statuses, list params, slicing state, fit, file checks, pricing candidates, defaults | 3 |
| `apps/web/src/components/DataTable.tsx` | Opt-in sortable headers and pagination footer | 4 |
| `apps/web/src/data/quotes.ts` | Quote hooks (list, one quote, create, update, markup, delete, blockers, status, duplicate, refresh, price) | 4, 5, 6, 8, 9 |
| `apps/web/src/data/clients.ts` | `useClientOptions` | 4 |
| `apps/web/src/pages/QuotesPage.tsx` | List page | 4 |
| `apps/web/src/pages/quotes/QuoteStatusBadge.tsx` | Status badge | 4 |
| `apps/web/src/pages/quotes/QuoteFilters.tsx` | Search, status, client and date filters | 4 |
| `apps/web/src/pages/quotes/labels.ts` | `clientLabel`, `materialLabel` | 5, 7 |
| `apps/web/src/pages/quotes/ClientPicker.tsx` | Searchable client combobox with New client | 5 |
| `apps/web/src/pages/quotes/QuoteFields.tsx` | Client, valid until, notes, markup fields shared by both sheets | 5 |
| `apps/web/src/pages/quotes/quote-form.ts` | zod schema and conversions for the New quote and Edit details sheets | 5 |
| `apps/web/src/pages/quotes/NewQuoteSheet.tsx` | New quote sheet | 5 |
| `apps/web/src/pages/clients/ClientSheet.tsx` | Gains an `onCreated` callback | 5 |
| `apps/web/src/app/AppProviders.tsx` | Mounts `<Toaster>`; later the uploader context | 5, 8 |
| `apps/web/src/pages/QuoteEditorPage.tsx` | Editor page | 6 |
| `apps/web/src/pages/quote-editor/QuoteHeader.tsx` | Header and markup in effect | 6 |
| `apps/web/src/pages/quote-editor/QuoteDetailsSheet.tsx` | Edit details sheet | 6 |
| `apps/web/src/pages/quote-editor/QuoteActions.tsx` | Status actions, duplicate, delete and their dialogs | 6 |
| `apps/web/src/pages/quote-editor/SendQuoteDialog.tsx` | Mark as sent with blockers | 6 |
| `apps/web/src/pages/quote-editor/ConfirmActionDialog.tsx` | Confirm Mark accepted / Mark rejected | 6 |
| `apps/web/src/pages/quote-editor/InlineField.tsx` | Text field that saves on blur or Enter | 7 |
| `apps/web/src/data/quote-items.ts` | Item hooks | 6, 7, 8, 9 |
| `apps/web/src/pages/quote-editor/ItemCard.tsx` | One item | 7 |
| `apps/web/src/pages/quote-editor/ItemSettings.tsx` | Printer, material, quantity, layer height, infill, supports | 7 |
| `apps/web/src/pages/quote-editor/SlicingStatus.tsx` | Slicing state and results | 7 |
| `apps/web/src/pages/quote-editor/ItemPrice.tsx` | Price, breakdown and override | 7 |
| `apps/web/src/pages/quote-editor/OverrideDialog.tsx` | Override price dialog | 7 |
| `apps/web/src/data/model-upload.ts` | Uploader context and the tus implementation | 8 |
| `apps/web/src/test/fake-uploader.ts` | Controllable fake uploader | 8 |
| `apps/web/src/pages/quote-editor/use-uploads.ts` | Upload queue state | 8 |
| `apps/web/src/pages/quote-editor/UploadZone.tsx` | Drop zone, Choose files, upload rows | 8 |
| `apps/web/src/components/use-leave-guard.tsx`, `UnsavedChangesDialog.tsx` | Optional title and body texts | 8 |
| `apps/web/src/data/quote-live.ts` | `useQuoteLiveUpdates` | 9 |
| `apps/web/src/test/fake-realtime.ts` | Controllable fake Realtime | 9 |
| `apps/web/src/pages/quote-editor/use-auto-price.ts` | Automatic pricing | 9 |
| `apps/web/src/pages/quote-editor/QuoteTotals.tsx` | Total and Recalculate | 9 |
| `docs/...` | Data model, web app guide, functional analysis, Edge Functions, overview | 1, 10 |

---

### Task 1: The `quotes_list` view and the Realtime publication

**Files:**
- Create: `supabase/schemas/08_quotes_list.sql`
- Modify: `supabase/schemas/90_grants.sql`
- Create: `supabase/migrations/<timestamp>_quotes_list.sql` (generated), `supabase/migrations/<timestamp>_quotes_list_setup.sql`
- Create: `supabase/tests/database/12_quotes_list.test.sql`
- Modify: `apps/web/src/lib/database.types.ts` (generated)
- Modify: `docs/supabase/data-model.md`

**Interfaces:**
- Produces: view `public.quotes_list` with columns `id bigint, number text, number_year smallint, number_seq integer,
  status text, client_id bigint, client_name text, client_company text, valid_until date, sent_at timestamptz,
  created_at timestamptz, created_on date, created_by uuid, created_by_name text, item_count integer, total numeric`;
  `Tables<'quotes_list'>` in `database.types.ts` (every column typed nullable, as generated types do for views).
- Produces: `quote_items` and `slicing_jobs` in the `supabase_realtime` publication.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/12_quotes_list.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'staff.ql@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'outsider.ql@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000d1', 'Lia List', 'operator');
insert into public.clients (id, name, company) overriding system value values (920001, 'List Client', 'List Srl');
-- 22:30 UTC on 12 October is 00:30 on 13 October in Rome (CEST).
insert into public.quotes (id, client_id, created_by, created_at) overriding system value values
  (920001, 920001, '00000000-0000-4000-8000-0000000000d1', '2026-10-12 08:00:00+00'),
  (920002, 920001, '00000000-0000-4000-8000-0000000000d1', '2026-10-12 08:00:00+00'),
  (920003, 920001, '00000000-0000-4000-8000-0000000000d1', '2026-10-12 22:30:00+00');
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, computed_total, override_total, override_reason
) overriding system value values
  (920101, 920001, '920001/a/a.stl', 'a.stl', 'A', 10.50, null, null),
  (920102, 920001, '920001/b/b.stl', 'b.stl', 'B', 15.00, 20.00, 'Agreed'),
  (920103, 920002, '920002/c/c.stl', 'c.stl', 'C', 12.00, null, null),
  (920104, 920002, '920002/d/d.stl', 'd.stl', 'D', null, null, null);

-- Active staff
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select results_eq(
  $$select client_name, client_company, created_by_name, item_count, total
    from public.quotes_list where id = 920001$$,
  $$values ('List Client'::text, 'List Srl'::text, 'Lia List'::text, 2, 30.50::numeric)$$,
  'a fully priced quote sums its item totals, overrides included'
);
select results_eq(
  $$select item_count, total from public.quotes_list where id = 920002$$,
  $$values (2, null::numeric)$$,
  'one unpriced item leaves the total empty'
);
select results_eq(
  $$select item_count, total from public.quotes_list where id = 920003$$,
  $$values (0, null::numeric)$$,
  'a quote without items has no total'
);
select is(
  (select created_on from public.quotes_list where id = 920003),
  '2026-10-13'::date,
  'created_on is the creation date in Europe/Rome'
);
select is(
  (select number from public.quotes_list where id = 920001),
  (select number from public.quotes where id = 920001),
  'rows carry the quote number'
);

-- Signed in without a staff row: the view runs with the caller's RLS.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}';
select is((select count(*)::int from public.quotes_list), 0, 'users without a staff row see no quotes');

-- Anonymous
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select * from public.quotes_list$$, '42501', null, 'anon cannot read the view');
reset role;

select set_has(
  $$select tablename::text from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'$$,
  $$values ('quote_items'), ('slicing_jobs')$$,
  'quote_items and slicing_jobs publish Realtime changes'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db`
Expected: `12_quotes_list.test.sql` fails with `relation "public.quotes_list" does not exist`; the other 12 files pass.

- [ ] **Step 3: Declare the view**

Create `supabase/schemas/08_quotes_list.sql`:

```sql
-- The quotes list (home page). security_invoker: the caller's RLS on every joined table applies.
-- total is null while the quote has no items or any item has no price, so the list shows "—".

create view public.quotes_list
with (security_invoker = true) as
select
  q.id,
  q.number,
  q.number_year,
  q.number_seq,
  q.status,
  q.client_id,
  c.name as client_name,
  c.company as client_company,
  q.valid_until,
  q.sent_at,
  q.created_at,
  (q.created_at at time zone 'Europe/Rome')::date as created_on,
  q.created_by,
  s.display_name as created_by_name,
  i.item_count,
  case when i.item_count > 0 and i.unpriced_count = 0 then i.total end as total
from public.quotes q
join public.clients c on c.id = q.client_id
join public.staff s on s.user_id = q.created_by
cross join lateral (
  select
    count(*)::integer as item_count,
    count(*) filter (where qi.item_total is null)::integer as unpriced_count,
    sum(qi.item_total) as total
  from public.quote_items qi
  where qi.quote_id = q.id
) i;
```

In `supabase/schemas/90_grants.sql`, change the comment line

```sql
-- quotes (insert and update are column grants in the grants_and_setup migration)
```

to

```sql
-- quotes (insert and update are column grants in the grants_and_setup migration). The quotes_list view gets the
-- select above like every relation in public; its grants are repeated in the quotes_list_setup migration.
```

- [ ] **Step 4: Generate the migration and write the setup migration**

Run: `supabase db diff -f quotes_list`
Expected: a new `supabase/migrations/<timestamp>_quotes_list.sql` containing `create or replace view
"public"."quotes_list"` (plus Supabase's header lines) and nothing else. Open it and check that it keeps
`security_invoker`. If the option is missing, add `alter view public.quotes_list set (security_invoker = true);` as
the first statement of the setup migration below.

Run: `supabase migration new quotes_list_setup`, then put this in the created file:

```sql
-- Grants for the quotes_list view, mirrored in supabase/schemas/90_grants.sql (generated migrations carry none).
revoke all on public.quotes_list from public, anon, authenticated;
grant select on public.quotes_list to authenticated;
grant all on public.quotes_list to service_role;

-- Live slicing status in the quote editor. Realtime applies each table's select RLS to its subscribers. Publication
-- changes are not captured by the declarative schema, so they live only in migrations.
alter publication supabase_realtime add table public.quote_items, public.slicing_jobs;
```

- [ ] **Step 5: Rebuild and run the tests**

Run: `supabase db reset` then `supabase test db`
Expected: all 13 files pass, including `12_quotes_list.test.sql` (8 tests) and `01_structure.test.sql` (which checks
that anon has no privilege on any relation in `public`).

Run: `supabase db diff`
Expected: `No schema changes found`

- [ ] **Step 6: Regenerate the web app's types**

Run: `npm run gen:types`
Expected: `apps/web/src/lib/database.types.ts` gains `quotes_list` under `public.Views`. Then run
`npm run check:types-fresh` (up to date) and `npm run build` (passes).

- [ ] **Step 7: Document the view and the publication**

In `docs/supabase/data-model.md`:

1. After the `slicing_jobs` table section and before `## Storage`, add:

````markdown
## Views

### `quotes_list`

The quotes list (home page). `security_invoker = true`, so the caller's RLS on `quotes`, `clients`, `staff` and
`quote_items` applies: users who aren't active staff see no rows. Declared in `supabase/schemas/08_quotes_list.sql`.

| Column | Notes |
|---|---|
| `id`, `number`, `number_year`, `number_seq`, `status`, `client_id`, `valid_until`, `sent_at`, `created_at`, `created_by` | From `quotes` |
| `client_name`, `client_company` | From `clients` |
| `created_by_name` | `staff.display_name` of the creator |
| `created_on` | `created_at` as a date in `Europe/Rome`, for the date filter |
| `item_count` | Number of items |
| `total` | Sum of `item_total`; null when there are no items or any item is unpriced |

## Realtime

`quote_items` and `slicing_jobs` are in the `supabase_realtime` publication (migration `quotes_list_setup`; the
declarative schema can't express publications). The quote editor subscribes to them; Realtime applies each table's
`select` RLS, so only active staff receive changes.
````

2. In the `### Grants` table, add a row after `slicing_jobs`:

```markdown
| `quotes_list` (view) | — | — | — |
```

and after the table add the sentence: `` `quotes_list` is readable by `authenticated` and `service_role` only. ``

- [ ] **Step 8: Commit**

```bash
git add supabase/schemas/08_quotes_list.sql supabase/schemas/90_grants.sql supabase/migrations supabase/tests/database/12_quotes_list.test.sql apps/web/src/lib/database.types.ts docs/supabase/data-model.md
git commit -m "feat(db): add the quotes_list view and publish item and job changes to Realtime"
```

---

### Task 2: Error mapping and calling Edge Functions

**Files:**
- Modify: `apps/web/src/data/errors.ts`
- Modify: `apps/web/src/data/errors.test.ts`
- Create: `apps/web/src/data/edge-functions.ts`
- Create: `apps/web/src/data/edge-functions.test.ts`
- Modify: `apps/web/src/test/fake-db.ts`, `apps/web/src/test/fake-supabase.ts`, `apps/web/src/test/render-app.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Produces in `errors.ts`:
  - `AppErrorKind` gains `'notDraft' | 'notSendable' | 'sessionExpired'`;
  - `fromFunctionCode(code: string, cause?: unknown): AppError`;
  - `fromUploadResponse(status: number | null, body: string, cause?: unknown): AppError`.
- Produces in `edge-functions.ts`:
  - `type EdgeFunctionName = 'price-quote' | 'duplicate-quote'`;
  - `invokeFunction<T>(supabase: AppSupabaseClient, name: EdgeFunctionName, body: Record<string, unknown>): Promise<T>`.
- Produces in the test fakes:
  - `FunctionHandler = (body: unknown) => FunctionResult | Promise<FunctionResult>`;
  - `FunctionResult = { data: unknown } | { status: number; code: string } | { network: true }`;
  - `FakeDb#invoke(name, body)` and `FakeDb#functionCalls(name): unknown[]`;
  - `renderApp(path, { functions })`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/data/errors.test.ts`, replace the line

```ts
    [{ code: 'P0001', message: 'quote_not_draft' }, 'unknown'],
```

with

```ts
    [{ code: 'P0001', message: 'quote_not_draft' }, 'notDraft'],
    [{ code: 'P0001', message: 'quote_not_sendable' }, 'notSendable'],
    [{ code: 'P0001', message: 'something_else' }, 'unknown'],
    [{ code: 'P0002', message: 'quote_not_found' }, 'notFound'],
    [{ code: '22023', message: 'job_message_mismatch' }, 'invalid'],
```

and add these tests at the end of the file (add `fromFunctionCode, fromUploadResponse` to the import from
`./errors`):

```ts
describe('messages for quote errors', () => {
  test.each([
    [{ code: 'P0001', message: 'quote_not_sent' }, 'invalid', 'errors.quoteNotSent'],
    [{ code: 'P0001', message: 'retry_not_allowed' }, 'invalid', 'errors.retryNotAllowed'],
    [{ code: 'P0002', message: 'item_not_found' }, 'notFound', 'errors.notFound'],
    [{ code: 'P0002', message: 'model_not_found' }, 'notFound', 'errors.modelNotFound'],
    [{ code: '22023', message: 'printer_inactive' }, 'invalid', 'errors.printerInactive'],
    [{ code: '22023', message: 'material_inactive' }, 'invalid', 'errors.materialInactive'],
    [{ code: '22023', message: 'invalid_override' }, 'invalid', 'errors.invalidOverride'],
    [{ code: '22023', message: 'invalid_markup' }, 'invalid', 'errors.invalidMarkup'],
    [{ code: 'P0001', message: 'quote_not_draft' }, 'notDraft', 'errors.notDraft'],
    [{ code: 'P0001', message: 'quote_not_sendable' }, 'notSendable', 'errors.notSendable'],
  ])('%o → %s, %s', (error, kind, messageKey) => {
    expect(toAppError(error)).toMatchObject({ kind, messageKey })
  })
})

describe('fromFunctionCode', () => {
  test.each([
    ['not_authenticated', 'sessionExpired', 'errors.sessionExpired'],
    ['not_staff', 'forbidden', 'errors.forbidden'],
    ['quote_not_found', 'notFound', 'errors.notFound'],
    ['quote_not_draft', 'notDraft', 'errors.notDraft'],
    ['duplicate_failed', 'unknown', 'errors.duplicateFailed'],
    ['invalid_request', 'unknown', 'errors.unknown'],
    ['internal_error', 'unknown', 'errors.unknown'],
    ['', 'unknown', 'errors.unknown'],
  ])('%s → %s, %s', (code, kind, messageKey) => {
    expect(fromFunctionCode(code)).toMatchObject({ kind, messageKey })
  })
})

describe('fromUploadResponse', () => {
  test.each([
    [null, '', 'network', 'errors.network'],
    [403, '', 'notDraft', 'errors.uploadNotAllowed'],
    [400, '{"message":"new row violates row-level security policy"}', 'notDraft', 'errors.uploadNotAllowed'],
    [413, '', 'invalid', 'errors.fileTooLarge'],
    [400, '{"message":"The object exceeded the maximum allowed size"}', 'invalid', 'errors.fileTooLarge'],
    [500, 'boom', 'unknown', 'errors.unknown'],
  ])('%s %s → %s, %s', (status, body, kind, messageKey) => {
    expect(fromUploadResponse(status, body)).toMatchObject({ kind, messageKey })
  })
})
```

Create `apps/web/src/data/edge-functions.test.ts`:

```ts
import { expect, test } from 'vitest'
import { FakeDb } from '@/test/fake-db'
import { createFakeSupabase } from '@/test/fake-supabase'
import { invokeFunction } from './edge-functions'
import { AppError } from './errors'

function client(handlers: ConstructorParameters<typeof FakeDb>[2]) {
  return createFakeSupabase({ db: new FakeDb({}, {}, handlers) })
}

test('returns the data and records the call', async () => {
  const { client: supabase, db } = client({ 'price-quote': () => ({ data: { priced: 2, skipped: 0 } }) })
  await expect(invokeFunction(supabase, 'price-quote', { quote_id: 7 })).resolves.toEqual({
    priced: 2,
    skipped: 0,
  })
  expect(db.functionCalls('price-quote')).toEqual([{ quote_id: 7 }])
})

test('an error response becomes the AppError for its code', async () => {
  const { client: supabase } = client({
    'duplicate-quote': () => ({ status: 409, code: 'quote_not_draft' }),
  })
  const error = await invokeFunction(supabase, 'duplicate-quote', { quote_id: 7 }).catch((e) => e)
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({ kind: 'notDraft' })
})

test('a response without a code is unknown', async () => {
  const { client: supabase } = client({ 'price-quote': () => ({ status: 502, code: '' }) })
  await expect(invokeFunction(supabase, 'price-quote', { quote_id: 7 })).rejects.toMatchObject({
    kind: 'unknown',
  })
})

test('a request that never arrives is a network error', async () => {
  const { client: supabase } = client({ 'price-quote': () => ({ network: true }) })
  await expect(invokeFunction(supabase, 'price-quote', { quote_id: 7 })).rejects.toMatchObject({
    kind: 'network',
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/data/errors.test.ts src/data/edge-functions.test.ts`
Expected: FAIL. `fromFunctionCode`, `fromUploadResponse` and `./edge-functions` don't exist, and
`quote_not_draft` maps to `unknown`.

- [ ] **Step 3: Extend `errors.ts`**

Replace the `AppErrorKind` type with:

```ts
export type AppErrorKind =
  | 'duplicate'
  | 'inUse'
  | 'invalid'
  | 'forbidden'
  | 'lastOwner'
  | 'notFound'
  | 'notDraft'
  | 'notSendable'
  | 'sessionExpired'
  | 'network'
  | 'unknown'
```

Add, before `toAppError`:

```ts
/** Messages raised with errcode 22023 (invalid parameter) that have their own text. */
const INVALID_MESSAGES: Record<string, string> = {
  printer_inactive: 'errors.printerInactive',
  material_inactive: 'errors.materialInactive',
  invalid_override: 'errors.invalidOverride',
  invalid_markup: 'errors.invalidMarkup',
}
```

Replace the `switch (code)` cases for `P0001` with these, and add the `P0002` and `22023` cases:

```ts
    case 'P0001':
      if (message === 'last_owner') return new AppError('lastOwner', { cause: error })
      if (message === 'quote_not_draft') return new AppError('notDraft', { cause: error })
      if (message === 'quote_not_sendable') return new AppError('notSendable', { cause: error })
      if (message === 'quote_not_sent') {
        return new AppError('invalid', { messageKey: 'errors.quoteNotSent', cause: error })
      }
      if (message === 'retry_not_allowed') {
        return new AppError('invalid', { messageKey: 'errors.retryNotAllowed', cause: error })
      }
      break
    case 'P0002':
      return new AppError('notFound', {
        messageKey: message === 'model_not_found' ? 'errors.modelNotFound' : undefined,
        cause: error,
      })
    case '22023':
      return new AppError('invalid', { messageKey: INVALID_MESSAGES[message], cause: error })
```

(`messageKey: undefined` falls back to `errors.<kind>` in the constructor.)

Add at the end of the file:

```ts
/** The `{ code }` an Edge Function answers with (docs/supabase/edge-functions.md). */
export function fromFunctionCode(code: string, cause?: unknown): AppError {
  switch (code) {
    case 'not_authenticated':
      return new AppError('sessionExpired', { cause })
    case 'not_staff':
      return new AppError('forbidden', { cause })
    case 'quote_not_found':
      return new AppError('notFound', { cause })
    case 'quote_not_draft':
      return new AppError('notDraft', { cause })
    case 'duplicate_failed':
      return new AppError('unknown', { messageKey: 'errors.duplicateFailed', cause })
    default:
      return new AppError('unknown', { cause })
  }
}

/**
 * A failed resumable upload. `status` is null when no response arrived. Storage reports a policy refusal (the quote
 * left draft) and an oversized file in the body as well as the status, so both are checked.
 */
export function fromUploadResponse(status: number | null, body: string, cause?: unknown): AppError {
  if (status === null) return new AppError('network', { cause })
  if (status === 403 || /row-level security/i.test(body)) {
    return new AppError('notDraft', { messageKey: 'errors.uploadNotAllowed', cause })
  }
  if (status === 413 || /maximum allowed size|too large/i.test(body)) {
    return new AppError('invalid', { messageKey: 'errors.fileTooLarge', cause })
  }
  return new AppError('unknown', { cause })
}
```

- [ ] **Step 4: Add the fake `functions.invoke`**

In `apps/web/src/test/fake-db.ts`, add after the imports:

```ts
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
```

and after the `DbFailure` type:

```ts
/** What a fake Edge Function answers: data, an error response with `{ code }`, or no response at all. */
export type FunctionResult = { data: unknown } | { status: number; code: string } | { network: true }
export type FunctionHandler = (body: unknown) => FunctionResult | Promise<FunctionResult>
```

Change the `FakeDb` constructor to take the handlers as a third argument and add the log:

```ts
  private readonly functions: Record<string, FunctionHandler>
  private readonly functionLog: { name: string; body: unknown }[] = []

  constructor(
    tables: Record<string, Row[]> = {},
    rpcs: Record<string, (args: unknown) => unknown> = {},
    functions: Record<string, FunctionHandler> = {},
  ) {
    this.tables = Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
    )
    this.rpcs = rpcs
    this.functions = functions
  }
```

Add these methods after `rpc`:

```ts
  /** Answers like `supabase.functions.invoke`: `{ data, error }` with supabase-js's own error classes. */
  async invoke(name: string, body: unknown) {
    this.functionLog.push({ name, body })
    const handler = this.functions[name]
    const answer: FunctionResult = handler ? await handler(body) : { status: 404, code: 'not_found' }
    if ('data' in answer) return { data: answer.data, error: null }
    if ('network' in answer) {
      return { data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) }
    }
    const response = new Response(JSON.stringify({ code: answer.code }), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    })
    return { data: null, error: new FunctionsHttpError(response) }
  }

  functionCalls(name: string): unknown[] {
    return this.functionLog.filter((entry) => entry.name === name).map((entry) => entry.body)
  }
```

In `apps/web/src/test/fake-supabase.ts`, add to `client`:

```ts
    functions: {
      invoke: (name: string, options: { body?: unknown } = {}) => db.invoke(name, options.body),
    },
```

In `apps/web/src/test/render-app.tsx`, import `type FunctionHandler` from `./fake-db`, add the option

```ts
  /** Edge Function handlers by name, e.g. `{ 'price-quote': () => ({ data: { priced: 1, skipped: 0 } }) }`. */
  functions?: Record<string, FunctionHandler>
```

and pass it as the third `FakeDb` argument: `new FakeDb({...}, opts.rpc, opts.functions)`.

- [ ] **Step 5: Implement `invokeFunction`**

Create `apps/web/src/data/edge-functions.ts`:

```ts
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import type { AppSupabaseClient } from '@/lib/supabase'
import { AppError, fromFunctionCode } from './errors'

export type EdgeFunctionName = 'price-quote' | 'duplicate-quote'

async function codeOf(error: FunctionsHttpError): Promise<string> {
  try {
    const body: unknown = await (error.context as Response).json()
    if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string') {
      return body.code
    }
  } catch {
    // Not JSON (e.g. a gateway error page): no code.
  }
  return ''
}

/** Calls an Edge Function with the signed-in user's token; a failure becomes the AppError for its `{ code }`. */
export async function invokeFunction<T>(
  supabase: AppSupabaseClient,
  name: EdgeFunctionName,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) throw fromFunctionCode(await codeOf(error), error)
  if (error instanceof FunctionsFetchError) throw new AppError('network', { cause: error })
  throw new AppError('unknown', { cause: error })
}
```

- [ ] **Step 6: Add the error messages**

Merge into `apps/web/src/i18n/locales/it.json` under `errors`:

```json
"notDraft": "Il preventivo non è più una bozza e non si può modificare.",
"notSendable": "Il preventivo non può ancora essere inviato.",
"sessionExpired": "La sessione è scaduta. Accedi di nuovo.",
"quoteNotSent": "Solo un preventivo inviato può essere accettato o rifiutato.",
"retryNotAllowed": "Lo slicing di questo articolo non può essere riprovato ora.",
"modelNotFound": "Il file del modello non è stato trovato.",
"printerInactive": "La stampante scelta è disattivata.",
"materialInactive": "Il materiale scelto è disattivato.",
"invalidOverride": "Inserisci un prezzo valido e un motivo.",
"invalidMarkup": "Il ricarico non può essere negativo.",
"duplicateFailed": "Non è stato possibile copiare il preventivo. Non è stato creato nulla.",
"uploadNotAllowed": "Non si possono più caricare file su questo preventivo.",
"fileTooLarge": "Il file supera i 100 MB."
```

and into `en.json` under `errors`:

```json
"notDraft": "The quote is no longer a draft and can't be changed.",
"notSendable": "The quote can't be sent yet.",
"sessionExpired": "Your session has expired. Sign in again.",
"quoteNotSent": "Only a sent quote can be accepted or rejected.",
"retryNotAllowed": "Slicing can't be retried for this item right now.",
"modelNotFound": "The model file wasn't found.",
"printerInactive": "The chosen printer is deactivated.",
"materialInactive": "The chosen material is deactivated.",
"invalidOverride": "Enter a valid price and a reason.",
"invalidMarkup": "The markup can't be negative.",
"duplicateFailed": "The quote couldn't be copied. Nothing was created.",
"uploadNotAllowed": "Files can no longer be uploaded to this quote.",
"fileTooLarge": "The file is larger than 100 MB."
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/data src/i18n`
Expected: PASS.

- [ ] **Step 8: Format, lint, build and commit**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

```bash
git add apps/web/src/data/errors.ts apps/web/src/data/errors.test.ts apps/web/src/data/edge-functions.ts apps/web/src/data/edge-functions.test.ts apps/web/src/test apps/web/src/i18n/locales
git commit -m "feat(web): map quote and Edge Function errors; call Edge Functions through invokeFunction"
```

---

### Task 3: Pure quote rules and date helpers

**Files:**
- Modify: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`
- Create: `apps/web/src/lib/use-now.ts`
- Create: `apps/web/src/data/quote-rules.ts`, `apps/web/src/data/quote-rules.test.ts`

**Interfaces:**
- Produces in `lib/format.ts`:
  - `shopToday(now?: Date): string` (yyyy-mm-dd in Europe/Rome);
  - `addDays(date: string, days: number): string`;
  - `formatDuration(seconds: number): string` (h:mm);
  - `formatElapsed(seconds: number): string` (m:ss).
- Produces in `lib/use-now.ts`: `useNow(active: boolean): number`, the current time in ms, re-rendering every second
  while `active`.
- Produces in `data/quote-rules.ts`:
  - **Statuses:** `QUOTE_STATUSES`, `type QuoteStatus`.
  - **List params:** `QUOTE_SORTS`, `type QuoteSort`, `type SortDir`, `type QuoteListParams`, `DEFAULT_QUOTE_LIST`,
    `parseQuoteListParams(search: URLSearchParams): QuoteListParams`,
    `toQuoteListSearch(params: QuoteListParams): URLSearchParams`, `hasFilters(params): boolean`.
  - **Expiry:** `expiresSoon(quote: { status: string; valid_until: string }, today: string): boolean`.
  - **Slicing:** `type JobStatus`, `type ItemJob`, `type SlicingState`, `SLOW_QUEUE_MS`,
    `slicingState(item, now: number): SlicingState`, `isSlicingInProgress(item): boolean`.
  - **Fit:** `fitsPrinter(item, printer): boolean`.
  - **Files:** `MAX_MODEL_BYTES`, `MAX_PARALLEL_UPLOADS`, `type FileProblem`,
    `validateModelFile(file: { name: string; size: number }): FileProblem | null`,
    `descriptionFromFilename(name: string): string`, `safeObjectName(name: string): string`,
    `modelPath(quoteId: number, uploadId: string, filename: string): string`.
  - **Pricing and defaults:** `unpricedItems<T>(items: T[]): T[]`,
    `defaultCatalogChoice(items, activePrinterIds, activeMaterialIds): { printer_id: number | null; material_id: number | null }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/format.test.ts` (extend its import from `./format` with `addDays, formatDuration,
formatElapsed, shopToday`):

```ts
describe('shopToday', () => {
  test('is the date in Rome, which is ahead of UTC', () => {
    expect(shopToday(new Date('2026-10-12T22:30:00Z'))).toBe('2026-10-13')
    expect(shopToday(new Date('2026-10-12T21:59:00Z'))).toBe('2026-10-12')
    expect(shopToday(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16')
  })
})

test('addDays crosses months and years', () => {
  expect(addDays('2026-10-13', 30)).toBe('2026-11-12')
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
})

test('formatDuration shows hours and minutes', () => {
  expect(formatDuration(19800)).toBe('5:30')
  expect(formatDuration(59)).toBe('0:01')
  expect(formatDuration(36000)).toBe('10:00')
})

test('formatElapsed shows minutes and seconds', () => {
  expect(formatElapsed(65)).toBe('1:05')
  expect(formatElapsed(0)).toBe('0:00')
})
```

(If `format.test.ts` doesn't import `describe`, add it to the `vitest` import.)

Create `apps/web/src/data/quote-rules.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_QUOTE_LIST,
  MAX_MODEL_BYTES,
  SLOW_QUEUE_MS,
  defaultCatalogChoice,
  descriptionFromFilename,
  expiresSoon,
  fitsPrinter,
  hasFilters,
  isSlicingInProgress,
  modelPath,
  parseQuoteListParams,
  safeObjectName,
  slicingState,
  toQuoteListSearch,
  unpricedItems,
  validateModelFile,
  type ItemJob,
} from './quote-rules'

describe('list params', () => {
  test('an empty URL gives the defaults', () => {
    expect(parseQuoteListParams(new URLSearchParams())).toEqual(DEFAULT_QUOTE_LIST)
  })

  test('reads every param', () => {
    const params = parseQuoteListParams(
      new URLSearchParams(
        'q=rossi&status=sent,draft&client=4&from=2026-10-01&to=2026-10-31&sort=total&dir=asc&page=3',
      ),
    )
    expect(params).toEqual({
      q: 'rossi',
      status: ['draft', 'sent'],
      client: 4,
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'total',
      dir: 'asc',
      page: 3,
    })
  })

  test('bad values fall back to their defaults', () => {
    const params = parseQuoteListParams(
      new URLSearchParams('status=sent,bogus,sent&client=-2&from=2026-02-30&to=yesterday&sort=x&dir=up&page=0'),
    )
    expect(params).toEqual({ ...DEFAULT_QUOTE_LIST, status: ['sent'] })
  })

  test('round-trips, leaving defaults out of the URL', () => {
    expect(toQuoteListSearch(DEFAULT_QUOTE_LIST).toString()).toBe('')
    const params = { ...DEFAULT_QUOTE_LIST, q: 'Q-2026', status: ['sent' as const], page: 2 }
    expect(parseQuoteListParams(toQuoteListSearch(params))).toEqual(params)
  })

  test('hasFilters ignores sort and page', () => {
    expect(hasFilters({ ...DEFAULT_QUOTE_LIST, sort: 'total', page: 4 })).toBe(false)
    expect(hasFilters({ ...DEFAULT_QUOTE_LIST, q: ' x ' })).toBe(true)
    expect(hasFilters({ ...DEFAULT_QUOTE_LIST, to: '2026-10-01' })).toBe(true)
  })
})

test('expiresSoon: sent quotes within seven days of today', () => {
  const today = '2026-10-13'
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-13' }, today)).toBe(true)
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-20' }, today)).toBe(true)
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-21' }, today)).toBe(false)
  expect(expiresSoon({ status: 'sent', valid_until: '2026-10-12' }, today)).toBe(false)
  expect(expiresSoon({ status: 'draft', valid_until: '2026-10-14' }, today)).toBe(false)
})

describe('slicingState', () => {
  const NOW = Date.parse('2026-10-13T10:00:00Z')
  const job = (overrides: Partial<ItemJob>): ItemJob => ({
    id: 1,
    status: 'queued',
    error: null,
    queued_at: '2026-10-13T09:59:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  })
  const item = (overrides: Partial<Parameters<typeof slicingState>[0]> = {}) => ({
    printer_id: 1,
    material_id: 2,
    print_time_s: null,
    job: null,
    ...overrides,
  })

  test('waits for printer and material', () => {
    expect(slicingState(item({ printer_id: null }), NOW)).toEqual({ kind: 'waiting' })
    expect(slicingState(item({ material_id: null, job: job({}) }), NOW)).toEqual({ kind: 'waiting' })
  })
  test('queued, then slow after more than ten minutes', () => {
    expect(slicingState(item({ job: job({}) }), NOW)).toEqual({ kind: 'queued' })
    const exactly = new Date(NOW - SLOW_QUEUE_MS).toISOString()
    expect(slicingState(item({ job: job({ queued_at: exactly }) }), NOW)).toEqual({ kind: 'queued' })
    const longer = new Date(NOW - SLOW_QUEUE_MS - 1000).toISOString()
    expect(slicingState(item({ job: job({ queued_at: longer }) }), NOW)).toEqual({ kind: 'slow' })
  })
  test('slicing with the seconds since it started', () => {
    const running = job({ status: 'running', started_at: '2026-10-13T09:58:55Z' })
    expect(slicingState(item({ job: running }), NOW)).toEqual({ kind: 'slicing', elapsedS: 65 })
  })
  test('done once the item has results', () => {
    const succeeded = job({ status: 'succeeded' })
    expect(slicingState(item({ print_time_s: 19800, job: succeeded }), NOW)).toEqual({ kind: 'done' })
  })
  test('failed with the error', () => {
    const failed = job({ status: 'failed', error: 'Model is not manifold' })
    expect(slicingState(item({ job: failed }), NOW)).toEqual({
      kind: 'failed',
      error: 'Model is not manifold',
    })
  })
  test('no job and no results counts as queued', () => {
    expect(slicingState(item(), NOW)).toEqual({ kind: 'queued' })
  })
  test('isSlicingInProgress is true while queued or running', () => {
    expect(isSlicingInProgress(item({ job: job({}) }))).toBe(true)
    expect(isSlicingInProgress(item({ job: job({ status: 'running' }) }))).toBe(true)
    expect(isSlicingInProgress(item({ print_time_s: 10, job: job({ status: 'succeeded' }) }))).toBe(
      false,
    )
    expect(isSlicingInProgress(item({ job: job({ status: 'failed' }) }))).toBe(false)
    expect(isSlicingInProgress(item({ printer_id: null }))).toBe(false)
  })
})

test('fitsPrinter compares each axis with the build volume', () => {
  const printer = { build_x_mm: 250, build_y_mm: 210, build_z_mm: 220 }
  const box = (x: number, y: number, z: number) => ({ bbox_x_mm: x, bbox_y_mm: y, bbox_z_mm: z })
  expect(fitsPrinter(box(250, 210, 220), printer)).toBe(true)
  expect(fitsPrinter(box(250.1, 10, 10), printer)).toBe(false)
  expect(fitsPrinter(box(10, 211, 10), printer)).toBe(false)
  expect(fitsPrinter(box(10, 10, 221), printer)).toBe(false)
  expect(fitsPrinter({ bbox_x_mm: null, bbox_y_mm: null, bbox_z_mm: null }, printer)).toBe(true)
})

describe('model files', () => {
  test('validateModelFile checks extension, emptiness and size', () => {
    expect(validateModelFile({ name: 'part.STL', size: 10 })).toBeNull()
    expect(validateModelFile({ name: 'part.3mf', size: MAX_MODEL_BYTES })).toBeNull()
    expect(validateModelFile({ name: 'part.obj', size: 10 })).toBe('extension')
    expect(validateModelFile({ name: 'stl', size: 10 })).toBe('extension')
    expect(validateModelFile({ name: 'part.stl', size: 0 })).toBe('empty')
    expect(validateModelFile({ name: 'part.stl', size: MAX_MODEL_BYTES + 1 })).toBe('tooLarge')
  })
  test('descriptionFromFilename drops the extension', () => {
    expect(descriptionFromFilename('Staffa grande.stl')).toBe('Staffa grande')
    expect(descriptionFromFilename('a.b.3mf')).toBe('a.b')
  })
  test('safeObjectName keeps letters, digits, spaces and . - _ ( )', () => {
    expect(safeObjectName('Staffa (v2) - finale.stl')).toBe('Staffa (v2) - finale.stl')
    expect(safeObjectName('pezzo#1 perché?.stl')).toBe('pezzo_1 perch__.stl')
  })
  test('modelPath', () => {
    expect(modelPath(7, 'u-1', 'a.stl')).toBe('7/u-1/a.stl')
  })
})

test('unpricedItems: results, printer and material, no price', () => {
  const base = {
    id: 1,
    updated_at: 't',
    printer_id: 1,
    material_id: 2,
    print_time_s: 100,
    priced_at: null,
  }
  expect(unpricedItems([base])).toEqual([base])
  expect(unpricedItems([{ ...base, priced_at: 't' }])).toEqual([])
  expect(unpricedItems([{ ...base, print_time_s: null }])).toEqual([])
  expect(unpricedItems([{ ...base, printer_id: null }])).toEqual([])
})

test('defaultCatalogChoice takes the newest item with both, if still active', () => {
  const items = [
    { id: 1, printer_id: 10, material_id: 20 },
    { id: 3, printer_id: 11, material_id: 21 },
    { id: 4, printer_id: null, material_id: 22 },
  ]
  expect(defaultCatalogChoice(items, new Set([10, 11]), new Set([20, 21]))).toEqual({
    printer_id: 11,
    material_id: 21,
  })
  expect(defaultCatalogChoice(items, new Set([10]), new Set([20, 21]))).toEqual({
    printer_id: null,
    material_id: null,
  })
  expect(defaultCatalogChoice([], new Set(), new Set())).toEqual({
    printer_id: null,
    material_id: null,
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/lib/format.test.ts src/data/quote-rules.test.ts`
Expected: FAIL. The helpers and `./quote-rules` don't exist.

- [ ] **Step 3: Add the date helpers**

Append to `apps/web/src/lib/format.ts`:

```ts
/** Today's date (yyyy-mm-dd) in shop time, Europe/Rome, like `private.shop_today()` in the database. */
export function shopToday(now: Date = new Date()): string {
  // en-CA formats dates as yyyy-mm-dd.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** A yyyy-mm-dd date moved by whole days. */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() + days)
  return moved.toISOString().slice(0, 10)
}

/** Seconds as h:mm, rounded to the minute: 19800 → "5:30". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Seconds as m:ss: 65 → "1:05". */
export function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
```

Create `apps/web/src/lib/use-now.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * The current time in ms, refreshed every second while `active`. Components read time through this hook because
 * calling Date.now() while rendering is impure (and the React Compiler lint rejects it).
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
```

- [ ] **Step 4: Implement the rules**

Create `apps/web/src/data/quote-rules.ts`:

```ts
import { addDays } from '@/lib/format'

/** Pure rules behind the quotes screens (spec: docs/superpowers/specs/2026-10-13-web-quotes-design.md). */

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const QUOTE_SORTS = ['number', 'created', 'valid_until', 'total'] as const
export type QuoteSort = (typeof QUOTE_SORTS)[number]
export type SortDir = 'asc' | 'desc'

export type QuoteListParams = {
  q: string
  status: QuoteStatus[]
  client: number | null
  from: string | null
  to: string | null
  sort: QuoteSort
  dir: SortDir
  page: number
}

export const DEFAULT_QUOTE_LIST: QuoteListParams = {
  q: '',
  status: [],
  client: null,
  from: null,
  to: null,
  sort: 'created',
  dir: 'desc',
  page: 1,
}

function positiveInt(text: string | null): number | null {
  if (!text || !/^\d+$/.test(text)) return null
  const value = Number(text)
  return value > 0 && Number.isSafeInteger(value) ? value : null
}

/** A real calendar date written yyyy-mm-dd (2026-02-30 is not). */
function dateParam(text: string | null): string | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null
}

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value)
}

/** The list's search, filters, sort and page from the URL; anything malformed falls back to its default. */
export function parseQuoteListParams(search: URLSearchParams): QuoteListParams {
  const statuses = (search.get('status') ?? '').split(',')
  const sort = search.get('sort')
  const dir = search.get('dir')
  return {
    q: search.get('q') ?? '',
    status: QUOTE_STATUSES.filter((status) => statuses.includes(status)),
    client: positiveInt(search.get('client')),
    from: dateParam(search.get('from')),
    to: dateParam(search.get('to')),
    sort: isOneOf(QUOTE_SORTS, sort) ? sort : DEFAULT_QUOTE_LIST.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_QUOTE_LIST.dir,
    page: positiveInt(search.get('page')) ?? 1,
  }
}

/** The URL for `params`, without the values that are already the defaults. */
export function toQuoteListSearch(params: QuoteListParams): URLSearchParams {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status.length) search.set('status', params.status.join(','))
  if (params.client !== null) search.set('client', String(params.client))
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.sort !== DEFAULT_QUOTE_LIST.sort) search.set('sort', params.sort)
  if (params.dir !== DEFAULT_QUOTE_LIST.dir) search.set('dir', params.dir)
  if (params.page !== 1) search.set('page', String(params.page))
  return search
}

export function hasFilters(params: QuoteListParams): boolean {
  return (
    params.q.trim() !== '' ||
    params.status.length > 0 ||
    params.client !== null ||
    params.from !== null ||
    params.to !== null
  )
}

/** A sent quote whose valid-until date is between today and a week from today (shop dates). */
export function expiresSoon(quote: { status: string; valid_until: string }, today: string) {
  return (
    quote.status === 'sent' && quote.valid_until >= today && quote.valid_until <= addDays(today, 7)
  )
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** An item's newest slicing job, as the items query embeds it. */
export type ItemJob = {
  id: number
  status: JobStatus
  error: string | null
  queued_at: string
  started_at: string | null
  finished_at: string | null
}

type SlicingInput = {
  printer_id: number | null
  material_id: number | null
  print_time_s: number | null
  job: ItemJob | null
}

export type SlicingState =
  | { kind: 'waiting' }
  | { kind: 'queued' }
  | { kind: 'slow' }
  | { kind: 'slicing'; elapsedS: number }
  | { kind: 'done' }
  | { kind: 'failed'; error: string | null }

export const SLOW_QUEUE_MS = 10 * 60 * 1000

/** What the item card shows about slicing (functional analysis §7). */
export function slicingState(item: SlicingInput, now: number): SlicingState {
  if (item.printer_id === null || item.material_id === null) return { kind: 'waiting' }
  const job = item.job
  if (job?.status === 'failed') return { kind: 'failed', error: job.error }
  if (job?.status === 'running') {
    const started = Date.parse(job.started_at ?? job.queued_at)
    return { kind: 'slicing', elapsedS: Math.max(0, Math.floor((now - started) / 1000)) }
  }
  if (item.print_time_s !== null) return { kind: 'done' }
  if (job && now - Date.parse(job.queued_at) > SLOW_QUEUE_MS) return { kind: 'slow' }
  return { kind: 'queued' }
}

/** Queued or running: Mark as sent waits for it. Needs no clock, so it is safe to call while rendering. */
export function isSlicingInProgress(item: SlicingInput): boolean {
  const kind = slicingState(item, 0).kind
  return kind === 'queued' || kind === 'slicing'
}

type Bbox = { bbox_x_mm: number | null; bbox_y_mm: number | null; bbox_z_mm: number | null }
type BuildVolume = { build_x_mm: number; build_y_mm: number; build_z_mm: number }

/** False when any axis of the sliced model is larger than the printer's; true while there are no results. */
export function fitsPrinter(item: Bbox, printer: BuildVolume): boolean {
  if (item.bbox_x_mm === null || item.bbox_y_mm === null || item.bbox_z_mm === null) return true
  return (
    item.bbox_x_mm <= printer.build_x_mm &&
    item.bbox_y_mm <= printer.build_y_mm &&
    item.bbox_z_mm <= printer.build_z_mm
  )
}

/** The `models` bucket's limit: 100 MiB. */
export const MAX_MODEL_BYTES = 100 * 1024 * 1024
export const MAX_PARALLEL_UPLOADS = 3

export type FileProblem = 'extension' | 'empty' | 'tooLarge'

export function validateModelFile(file: { name: string; size: number }): FileProblem | null {
  if (!/.\.(stl|3mf)$/i.test(file.name)) return 'extension'
  if (file.size === 0) return 'empty'
  if (file.size > MAX_MODEL_BYTES) return 'tooLarge'
  return null
}

export function descriptionFromFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Storage rejects some characters in object keys; the original name is kept on the item. */
export function safeObjectName(name: string): string {
  return name.replace(/[^\w.\- ()]/g, '_')
}

/** `<quote_id>/<upload_id>/<file>`, the layout the `models` storage policies expect. */
export function modelPath(quoteId: number, uploadId: string, filename: string): string {
  return `${quoteId}/${uploadId}/${filename}`
}

type PricingInput = {
  printer_id: number | null
  material_id: number | null
  print_time_s: number | null
  priced_at: string | null
}

/** Items `price-quote` would price that have no price yet. */
export function unpricedItems<T extends PricingInput>(items: T[]): T[] {
  return items.filter(
    (item) =>
      item.printer_id !== null &&
      item.material_id !== null &&
      item.print_time_s !== null &&
      item.priced_at === null,
  )
}

/** Printer and material for a new item: the newest item's (§3.4) when both are still active, else none. */
export function defaultCatalogChoice(
  items: { id: number; printer_id: number | null; material_id: number | null }[],
  activePrinterIds: ReadonlySet<number>,
  activeMaterialIds: ReadonlySet<number>,
): { printer_id: number | null; material_id: number | null } {
  const newest = [...items]
    .sort((a, b) => b.id - a.id)
    .find((item) => item.printer_id !== null && item.material_id !== null)
  if (
    newest?.printer_id != null &&
    newest.material_id != null &&
    activePrinterIds.has(newest.printer_id) &&
    activeMaterialIds.has(newest.material_id)
  ) {
    return { printer_id: newest.printer_id, material_id: newest.material_id }
  }
  return { printer_id: null, material_id: null }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/lib/format.test.ts src/data/quote-rules.test.ts`
Expected: PASS.

- [ ] **Step 6: Format, lint and commit**

Run: `npm run format && npm run lint && npm run build`
Expected: all pass.

```bash
git add apps/web/src/lib/format.ts apps/web/src/lib/format.test.ts apps/web/src/lib/use-now.ts apps/web/src/data/quote-rules.ts apps/web/src/data/quote-rules.test.ts
git commit -m "feat(web): add the pure quote rules and shop-date helpers"
```

---

### Task 4: Quotes list

**Files:**
- Modify: `apps/web/src/test/fake-db.ts`, `apps/web/src/test/fake-db.test.ts`
- Modify: `apps/web/src/test/fixtures.ts`
- Modify: `apps/web/src/components/DataTable.tsx`
- Modify: `apps/web/src/data/query-keys.ts`
- Create: `apps/web/src/data/quotes.ts`
- Modify: `apps/web/src/data/clients.ts`
- Create: `apps/web/src/pages/quotes/QuoteStatusBadge.tsx`, `apps/web/src/pages/quotes/QuoteFilters.tsx`
- Create: `apps/web/src/pages/QuotesPage.tsx`, `apps/web/src/pages/QuotesPage.test.tsx`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/pages/ClientDetailPage.tsx` (reuse `QuoteStatusBadge`)
- Create (shadcn): `apps/web/src/components/ui/popover.tsx`, `apps/web/src/components/ui/checkbox.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `en.json`

**Interfaces:**
- Consumes (Task 3): `QuoteListParams`, `QuoteSort`, `QuoteStatus`, `QUOTE_STATUSES`, `parseQuoteListParams`,
  `toQuoteListSearch`, `hasFilters`, `expiresSoon`; (lib) `shopToday`.
- Produces in `data/quotes.ts`:
  - `QUOTES_PAGE_SIZE = 25`;
  - `type QuoteListRow` (`id, number, status: QuoteStatus, client_id, client_name, client_company,
    valid_until, created_at, created_by_name, item_count, total: number | null`);
  - `type QuoteListPage = { rows: QuoteListRow[]; count: number; outOfRange: boolean }`;
  - `useQuotesList(params: QuoteListParams)`.
- Produces in `data/clients.ts`: `type ClientOption = { id: number; name: string; company: string | null }`,
  `useClientOptions()`.
- Produces in `data/query-keys.ts`:
  - `quotesAll: ['quotes']`, `quoteLists: ['quotes', 'list']`, `quotesList(params)`;
  - `quote(id)`, `quoteItems(id)`, `sendBlockers(id)` (used from Task 6);
  - `clientOptions: ['clients', 'options']`.
- Produces in `components/DataTable.tsx`:
  - `type TableQuery<T>`;
  - `Column<T>.sortKey?: string`;
  - props `sort?: { key: string; dir: 'asc' | 'desc'; onSort: (key: string) => void }` and
    `pagination?: { page: number; pageSize: number; total: number; onPage: (page: number) => void }`.
- Produces: `QuoteStatusBadge({ status }: { status: string })`; `QuotesPage({ creating }: { creating?: boolean })`
  (`creating` is used from Task 5).
- Produces in the fakes: filters `['in', column, values]`, `['gte', column, value]` and `['lte', column, value]`;
  several `order()` calls with `nullsFirst`; `range(from, to)`; `select(columns, { count: 'exact' })` returning
  `count`; fixture `quoteListRow(overrides)`.

- [ ] **Step 1: Extend the fake query builder (test first)**

Add to `apps/web/src/test/fake-db.test.ts` inside `describe('from()', …)`:

```ts
  test('in, gte and lte filter and are recorded', async () => {
    const db = new FakeDb({
      quotes: [
        { id: 1, status: 'draft', day: '2026-10-01' },
        { id: 2, status: 'sent', day: '2026-10-05' },
        { id: 3, status: 'expired', day: '2026-10-09' },
      ],
    })
    const { data } = await db
      .from('quotes')
      .select('*')
      .in('status', ['sent', 'expired'])
      .gte('day', '2026-10-02')
      .lte('day', '2026-10-05')
    expect(data).toEqual([{ id: 2, status: 'sent', day: '2026-10-05' }])
    expect(db.calls('quotes')[0].filters).toEqual([
      ['in', 'status', ['sent', 'expired']],
      ['gte', 'day', '2026-10-02'],
      ['lte', 'day', '2026-10-05'],
    ])
  })

  test('orders by several columns with nulls last by default when ascending', async () => {
    const db = new FakeDb({
      t: [
        { id: 1, a: 1, b: null },
        { id: 2, a: 1, b: 5 },
        { id: 3, a: 0, b: 9 },
      ],
    })
    const asc = await db.from('t').select('*').order('a').order('b')
    expect((asc.data as { id: number }[]).map((r) => r.id)).toEqual([3, 2, 1])
    const desc = await db.from('t').select('*').order('b', { ascending: false, nullsFirst: false })
    expect((desc.data as { id: number }[]).map((r) => r.id)).toEqual([3, 2, 1])
  })

  test('range returns a window and count the full total', async () => {
    const db = new FakeDb({ t: [1, 2, 3, 4, 5].map((id) => ({ id })) })
    const { data, count } = await db.from('t').select('*', { count: 'exact' }).order('id').range(1, 2)
    expect(data).toEqual([{ id: 2 }, { id: 3 }])
    expect(count).toBe(5)
  })
```

Run: `npm test --workspace @3d-quote/web -- src/test/fake-db.test.ts`
Expected: FAIL (`in` is not a function).

Then change `apps/web/src/test/fake-db.ts`:

1. Widen `Filter`:

```ts
export type Filter =
  | ['eq', string, unknown]
  | ['ilike', string, string]
  | ['or', string]
  | ['in', string, unknown[]]
  | ['gte', string, unknown]
  | ['lte', string, unknown]
```

2. `Result.count` becomes `number | null`, and `result()` takes it:

```ts
function result(
  data: unknown,
  error: PostgrestError | null,
  status: number,
  count: number | null = null,
): Result {
  return { data, error, count, status, statusText: '' }
}
```

3. In `matches`, before the `or` branch:

```ts
  if (filter[0] === 'in') return filter[2].includes(row[filter[1]])
  if (filter[0] === 'gte') return compare(row[filter[1]], filter[2]) >= 0
  if (filter[0] === 'lte') return compare(row[filter[1]], filter[2]) <= 0
```

4. In `FakeQuery`, replace the `sort` field with `sorts`, and add `window` and `counting`:

```ts
  private sorts: { column: string; ascending: boolean; nullsFirst: boolean }[] = []
  private window: [number, number] | null = null
  private counting = false
```

replace `select` and `order`, and add `in`, `gte`, `lte`, `range`:

```ts
  /** Columns and embeds are not interpreted: rows come back as seeded (seed embedded fields directly). */
  select(_columns?: string, options: { count?: 'exact' } = {}) {
    if (this.op !== 'select') this.returning = true
    if (options.count) this.counting = true
    return this
  }
```

(keep the existing `eslint-disable-next-line` comment above it)

```ts
  in(column: string, values: unknown[]) {
    this.filters.push(['in', column, values])
    return this
  }
  gte(column: string, value: unknown) {
    this.filters.push(['gte', column, value])
    return this
  }
  lte(column: string, value: unknown) {
    this.filters.push(['lte', column, value])
    return this
  }
  /** Ordering inside an embedded resource (`referencedTable`) is the seed's job, so it is ignored here. */
  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string } = {},
  ) {
    if (!options.referencedTable) {
      const ascending = options.ascending ?? true
      // PostgreSQL's default: nulls sort as the largest value.
      this.sorts.push({ column, ascending, nullsFirst: options.nullsFirst ?? !ascending })
    }
    return this
  }
  range(from: number, to: number) {
    this.window = [from, to]
    return this
  }
```

5. In `run()`, replace the `else` (select) branch with:

```ts
    } else {
      affected = matching()
      affected.sort((a, b) => {
        for (const sort of this.sorts) {
          const x = a[sort.column]
          const y = b[sort.column]
          const xNull = x === null || x === undefined
          const yNull = y === null || y === undefined
          if (xNull && yNull) continue
          if (xNull || yNull) return (xNull ? -1 : 1) * (sort.nullsFirst ? 1 : -1)
          const order = compare(x, y) * (sort.ascending ? 1 : -1)
          if (order !== 0) return order
        }
        return 0
      })
      if (this.max !== null) affected = affected.slice(0, this.max)
    }
    const total = affected.length
    if (this.op === 'select' && this.window) {
      affected = affected.slice(this.window[0], this.window[1] + 1)
    }
```

and make the plain-select return pass the count: `if (this.mode === 'many') return result(data, null, 200, this.counting ? total : null)`.

Run: `npm test --workspace @3d-quote/web -- src/test/fake-db.test.ts`
Expected: PASS.

- [ ] **Step 2: Add the shadcn popover and checkbox**

Run: `npx shadcn add popover checkbox -c apps/web`, then
`git checkout -- apps/web/src/components/ui/button.tsx apps/web/src/components/ui/label.tsx` and `npm run format`.
Expected: `apps/web/src/components/ui/popover.tsx` and `checkbox.tsx` exist and `npm run build` passes.

- [ ] **Step 3: Write the failing page tests**

Add to `apps/web/src/test/fixtures.ts`:

```ts
/** A row of the quotes_list view. */
export function quoteListRow(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as number | undefined) ?? nextId++
  return {
    id,
    number: `Q-2026-${String(id).padStart(4, '0')}`,
    number_year: 2026,
    number_seq: id,
    status: 'draft',
    client_id: 1,
    client_name: 'Mario Rossi',
    client_company: 'Rossi Meccanica',
    valid_until: '2026-11-11',
    sent_at: null,
    created_at: '2026-10-12T08:00:00Z',
    created_on: '2026-10-12',
    created_by: 'user-1',
    created_by_name: 'Anna Rossi',
    item_count: 1,
    total: 39.24,
    ...overrides,
  }
}
```

Create `apps/web/src/pages/QuotesPage.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, quoteListRow } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function dataRows() {
  return screen.getAllByRole('row').slice(1)
}

test('shows quotes with client, status, total and creator', async () => {
  renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [
        quoteListRow({ id: 42, total: 39.24 }),
        quoteListRow({ id: 43, client_company: null, status: 'sent', total: null }),
      ],
    },
  })
  const first = await screen.findByRole('row', { name: /Q-2026-0042/ })
  expect(within(first).getByRole('link', { name: 'Q-2026-0042' })).toHaveAttribute(
    'href',
    '/quotes/42',
  )
  expect(within(first).getByText('Rossi Meccanica')).toBeInTheDocument()
  expect(within(first).getByText('Bozza')).toBeInTheDocument()
  expect(within(first).getByText('39,24 €')).toBeInTheDocument()
  expect(within(first).getByText('da Anna Rossi')).toBeInTheDocument()
  const second = screen.getByRole('row', { name: /Q-2026-0043/ })
  expect(within(second).getByText('Inviato')).toBeInTheDocument()
  expect(within(second).getByText('—')).toBeInTheDocument()
})

test('marks sent quotes that expire within a week', async () => {
  renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [
        quoteListRow({ id: 1, status: 'sent', valid_until: '2026-10-18' }),
        quoteListRow({ id: 2, status: 'sent', valid_until: '2026-10-25' }),
        quoteListRow({ id: 3, status: 'draft', valid_until: '2026-10-15' }),
      ],
    },
  })
  const soon = await screen.findByRole('row', { name: /Q-2026-0001/ })
  expect(within(soon).getByText('Scade a breve')).toBeInTheDocument()
  expect(screen.getAllByText('Scade a breve')).toHaveLength(1)
})

test('search and filters reach the query and the URL', async () => {
  const { db, user, router } = renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [quoteListRow({ id: 1 })],
      clients: [clientRow({ id: 1, name: 'Mario Rossi' })],
    },
  })
  await screen.findByRole('row', { name: /Q-2026-0001/ })

  await user.type(screen.getByRole('searchbox', { name: 'Cerca per numero o cliente' }), 'rossi')
  await waitFor(() => expect(router.state.location.search).toContain('q=rossi'))
  expect(db.calls('quotes_list').at(-1)?.filters).toContainEqual([
    'or',
    'number.ilike.%rossi%,client_name.ilike.%rossi%,client_company.ilike.%rossi%',
  ])

  await user.click(screen.getByRole('button', { name: /Stato/ }))
  await user.click(await screen.findByRole('checkbox', { name: 'Inviato' }))
  await waitFor(() => expect(router.state.location.search).toContain('status=sent'))
  expect(db.calls('quotes_list').at(-1)?.filters).toContainEqual(['in', 'status', ['sent']])
  await user.keyboard('{Escape}')

  await user.selectOptions(await screen.findByLabelText('Cliente'), 'Mario Rossi')
  await waitFor(() => expect(router.state.location.search).toContain('client=1'))
  expect(db.calls('quotes_list').at(-1)?.filters).toContainEqual(['eq', 'client_id', 1])

  fireEvent.change(screen.getByLabelText('Creato dal'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('Creato al'), { target: { value: '2026-10-31' } })
  await waitFor(() => expect(router.state.location.search).toContain('to=2026-10-31'))
  const filters = db.calls('quotes_list').at(-1)?.filters
  expect(filters).toContainEqual(['gte', 'created_on', '2026-10-01'])
  expect(filters).toContainEqual(['lte', 'created_on', '2026-10-31'])
})

test('a header click sorts by that column and a second click reverses it', async () => {
  const { user, router } = renderApp('/quotes', {
    session,
    tables: {
      quotes_list: [
        quoteListRow({ id: 1, total: 10 }),
        quoteListRow({ id: 2, total: null }),
        quoteListRow({ id: 3, total: 30 }),
      ],
    },
  })
  await screen.findByRole('row', { name: /Q-2026-0001/ })
  await user.click(screen.getByRole('button', { name: 'Totale' }))
  await waitFor(() => expect(router.state.location.search).toBe('?sort=total'))
  await waitFor(() =>
    expect(dataRows().map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Q-2026-0003',
      'Q-2026-0001',
      'Q-2026-0002',
    ]),
  )
  expect(screen.getByRole('columnheader', { name: 'Totale' })).toHaveAttribute(
    'aria-sort',
    'descending',
  )

  await user.click(screen.getByRole('button', { name: 'Totale' }))
  await waitFor(() =>
    expect(dataRows().map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Q-2026-0001',
      'Q-2026-0003',
      'Q-2026-0002',
    ]),
  )
  expect(router.state.location.search).toBe('?sort=total&dir=asc')
})

test('pages through 25 at a time', async () => {
  const rows = Array.from({ length: 26 }, (_, i) =>
    quoteListRow({ id: i + 1, created_at: `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00Z` }),
  )
  const { user, router } = renderApp('/quotes', { session, tables: { quotes_list: rows } })
  expect(await screen.findByText('1–25 di 26')).toBeInTheDocument()
  expect(dataRows()).toHaveLength(25)
  expect(screen.getByRole('button', { name: 'Precedente' })).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Successiva' }))
  expect(await screen.findByText('26–26 di 26')).toBeInTheDocument()
  expect(dataRows()).toHaveLength(1)
  expect(router.state.location.search).toBe('?page=2')
  expect(screen.getByRole('button', { name: 'Successiva' })).toBeDisabled()
})

test('a page past the end goes back to page 1', async () => {
  const { db, router } = renderApp('/quotes?page=4', {
    session,
    tables: { quotes_list: [quoteListRow({ id: 1 })] },
  })
  db.failNext('quotes_list', {
    code: 'PGRST103',
    message: 'Requested range not satisfiable',
  })
  expect(await screen.findByRole('row', { name: /Q-2026-0001/ })).toBeInTheDocument()
  expect(router.state.location.search).toBe('')
})

test('empty states, with and without filters', async () => {
  const { user, router } = renderApp('/quotes?status=sent', { session })
  expect(await screen.findByText('Nessun preventivo corrisponde ai filtri.')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'Cancella filtri' })[0])
  expect(await screen.findByText('Nessun preventivo.')).toBeInTheDocument()
  expect(router.state.location.search).toBe('')
})

test('New quote opens /quotes/new', async () => {
  const { user, router } = renderApp('/quotes', { session })
  await user.click(await screen.findByRole('button', { name: 'Nuovo preventivo' }))
  expect(router.state.location.pathname).toBe('/quotes/new')
})
```

In `apps/web/src/app/routes.test.tsx`, delete the `pages` constant and the `test.each(pages)(…)` test (the
quotes page is real now); the other tests keep using `/quotes`.

- [ ] **Step 4: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/QuotesPage.test.tsx`
Expected: FAIL. `/quotes` still shows the "In arrivo." placeholder.

- [ ] **Step 5: Add the list data hooks and query keys**

In `apps/web/src/data/query-keys.ts`, add the import `import type { QuoteListParams } from './quote-rules'` and these
keys:

```ts
  clientOptions: ['clients', 'options'] as const,
  quotesAll: ['quotes'] as const,
  quoteLists: ['quotes', 'list'] as const,
  quotesList: (params: QuoteListParams) => ['quotes', 'list', params] as const,
  quote: (id: number) => ['quotes', 'detail', id] as const,
  quoteItems: (id: number) => ['quotes', 'items', id] as const,
  sendBlockers: (id: number) => ['quotes', 'blockers', id] as const,
```

Append to `apps/web/src/data/clients.ts`:

```ts
export type ClientOption = Pick<Client, 'id' | 'name' | 'company'>

/** Every client's id and name, for pickers and filters. */
export function useClientOptions() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.clientOptions,
    queryFn: async (): Promise<ClientOption[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, company')
        .order('name')
      if (error) throw toAppError(error)
      return data
    },
  })
}
```

Create `apps/web/src/data/quotes.ts`:

```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSupabase } from '@/lib/supabase'
import { sanitizeSearch } from './clients'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'
import type { QuoteListParams, QuoteSort, QuoteStatus } from './quote-rules'

export const QUOTES_PAGE_SIZE = 25

/** A quotes_list row. View columns are typed nullable, but these come from not-null table columns. */
export type QuoteListRow = {
  id: number
  number: string
  status: QuoteStatus
  client_id: number
  client_name: string
  client_company: string | null
  valid_until: string
  created_at: string
  created_by_name: string
  item_count: number
  total: number | null
}

export type QuoteListPage = { rows: QuoteListRow[]; count: number; outOfRange: boolean }

const LIST_COLUMNS =
  'id, number, status, client_id, client_name, client_company, valid_until, created_at, created_by_name, item_count, total'

const SORT_COLUMN: Record<Exclude<QuoteSort, 'number'>, string> = {
  created: 'created_at',
  valid_until: 'valid_until',
  total: 'total',
}

export function useQuotesList(params: QuoteListParams) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quotesList(params),
    queryFn: async (): Promise<QuoteListPage> => {
      let query = supabase.from('quotes_list').select(LIST_COLUMNS, { count: 'exact' })
      const term = sanitizeSearch(params.q)
      if (term) {
        query = query.or(
          `number.ilike.%${term}%,client_name.ilike.%${term}%,client_company.ilike.%${term}%`,
        )
      }
      if (params.status.length) query = query.in('status', params.status)
      if (params.client !== null) query = query.eq('client_id', params.client)
      if (params.from) query = query.gte('created_on', params.from)
      if (params.to) query = query.lte('created_on', params.to)
      const ascending = params.dir === 'asc'
      if (params.sort === 'number') {
        query = query.order('number_year', { ascending }).order('number_seq', { ascending })
      } else {
        query = query.order(SORT_COLUMN[params.sort], { ascending, nullsFirst: false })
      }
      const first = (params.page - 1) * QUOTES_PAGE_SIZE
      const { data, error, count } = await query
        .order('id', { ascending: false })
        .range(first, first + QUOTES_PAGE_SIZE - 1)
      // PostgREST refuses a range that starts past the last row; the page goes back to 1.
      if (error?.code === 'PGRST103') return { rows: [], count: 0, outOfRange: true }
      if (error) throw toAppError(error)
      return { rows: data as QuoteListRow[], count: count ?? 0, outOfRange: false }
    },
    // Keep the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  })
}
```

- [ ] **Step 6: Make `DataTable` sortable and pageable**

In `apps/web/src/components/DataTable.tsx`:

1. Add the imports `import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'`,
   `import { Button } from '@/components/ui/button'` and `import { formatNumber, localeFor } from '@/lib/format'`.
   Drop the `UseQueryResult` import.
2. Replace the `Column` type and add `TableQuery`:

```ts
export type Column<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
  /** Makes the header a sort button; passed to `sort.onSort`. */
  sortKey?: string
}

/** What DataTable reads from a query; any `useQuery` result over `T[]` fits. */
export type TableQuery<T> = {
  isPending: boolean
  isError: boolean
  error: unknown
  data: T[] | undefined
  refetch: () => unknown
}
```

3. Change the props to

```ts
export function DataTable<T>({
  query,
  columns,
  rowKey,
  empty,
  caption,
  sort,
  pagination,
}: {
  query: TableQuery<T>
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  empty: ReactNode
  caption: string
  sort?: { key: string; dir: 'asc' | 'desc'; onSort: (key: string) => void }
  pagination?: { page: number; pageSize: number; total: number; onPage: (page: number) => void }
}) {
  const { t, i18n } = useTranslation()
```

4. Replace the header row's `TableHead` rendering with:

```tsx
            {columns.map((column) => {
              const active = sort !== undefined && column.sortKey === sort.key
              const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
              const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
              return (
                <TableHead key={column.key} className={column.className} aria-sort={ariaSort}>
                  {sort && column.sortKey ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium"
                      onClick={() => sort.onSort(column.sortKey as string)}
                    >
                      {column.header}
                      <Icon aria-hidden className={active ? 'size-3.5' : 'size-3.5 opacity-40'} />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              )
            })}
```

5. After `</Table>`, before the closing fragment, add the footer:

```tsx
      {pagination && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {t('common.pageRange', {
              from: formatNumber(
                (pagination.page - 1) * pagination.pageSize + 1,
                localeFor(i18n.language),
              ),
              to: formatNumber(
                Math.min(pagination.page * pagination.pageSize, pagination.total),
                localeFor(i18n.language),
              ),
              total: formatNumber(pagination.total, localeFor(i18n.language)),
            })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPage(pagination.page - 1)}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page * pagination.pageSize >= pagination.total}
              onClick={() => pagination.onPage(pagination.page + 1)}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Build the badge, the filters and the page**

Create `apps/web/src/pages/quotes/QuoteStatusBadge.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'

const VARIANT = {
  draft: 'secondary',
  sent: 'default',
  accepted: 'outline',
  rejected: 'destructive',
  expired: 'outline',
} as const

/** The status in words; the variant only adds emphasis. */
export function QuoteStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const variant = VARIANT[status as keyof typeof VARIANT] ?? 'secondary'
  return <Badge variant={variant}>{t(`quotes.status.${status}`)}</Badge>
}
```

In `apps/web/src/pages/ClientDetailPage.tsx`, replace
`<Badge variant="secondary">{t(`quotes.status.${q.status}`)}</Badge>` with `<QuoteStatusBadge status={q.status} />`
(import it from `./quotes/QuoteStatusBadge`; drop the now-unused `Badge` import).

Create `apps/web/src/pages/quotes/QuoteFilters.tsx`:

```tsx
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClientOptions } from '@/data/clients'
import { hasFilters, QUOTE_STATUSES, type QuoteListParams } from '@/data/quote-rules'
import { useDebouncedValue } from '@/lib/use-debounced-value'

export function QuoteFilters({
  params,
  onChange,
  onClear,
}: {
  params: QuoteListParams
  onChange: (change: Partial<QuoteListParams>) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const clients = useClientOptions()
  const [text, setText] = useState(params.q)
  const debounced = useDebouncedValue(text, 300)

  // Only once typing has settled (debounced caught up with text): Clear filters empties `text` at once, and the stale
  // debounced value must not put the old search back.
  useEffect(() => {
    if (debounced === text && debounced.trim() !== params.q.trim()) onChange({ q: debounced })
  }, [debounced, text, params.q, onChange])

  function toggleStatus(status: (typeof QUOTE_STATUSES)[number], checked: boolean) {
    const next = checked ? [...params.status, status] : params.status.filter((s) => s !== status)
    onChange({ status: QUOTE_STATUSES.filter((s) => next.includes(s)) })
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Input
        type="search"
        aria-label={t('quotes.search')}
        placeholder={t('quotes.search')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="max-w-xs"
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">
            {params.status.length
              ? t('quotes.filters.statusCount', { count: params.status.length })
              : t('quotes.filters.status')}
            <ChevronDown aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-48 gap-2">
          {QUOTE_STATUSES.map((status) => (
            <Label key={status} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={params.status.includes(status)}
                onCheckedChange={(checked) => toggleStatus(status, checked === true)}
              />
              {t(`quotes.status.${status}`)}
            </Label>
          ))}
        </PopoverContent>
      </Popover>
      <div className="grid gap-1">
        <Label htmlFor="filter-client">{t('quotes.filters.client')}</Label>
        <NativeSelect
          id="filter-client"
          value={params.client === null ? '' : String(params.client)}
          onChange={(event) =>
            onChange({ client: event.target.value ? Number(event.target.value) : null })
          }
        >
          <NativeSelectOption value="">{t('quotes.filters.anyClient')}</NativeSelectOption>
          {clients.data?.map((client) => (
            <NativeSelectOption key={client.id} value={String(client.id)}>
              {client.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="filter-from">{t('quotes.filters.from')}</Label>
        <Input
          id="filter-from"
          type="date"
          value={params.from ?? ''}
          onChange={(event) => onChange({ from: event.target.value || null })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="filter-to">{t('quotes.filters.to')}</Label>
        <Input
          id="filter-to"
          type="date"
          value={params.to ?? ''}
          onChange={(event) => onChange({ to: event.target.value || null })}
        />
      </div>
      {hasFilters(params) && (
        <Button
          variant="ghost"
          onClick={() => {
            setText('')
            onClear()
          }}
        >
          {t('quotes.filters.clear')}
        </Button>
      )}
    </div>
  )
}
```

Create `apps/web/src/pages/QuotesPage.tsx`:

```tsx
import { Clock, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DataTable, type Column, type TableQuery } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_QUOTE_LIST,
  expiresSoon,
  hasFilters,
  parseQuoteListParams,
  toQuoteListSearch,
  type QuoteListParams,
  type QuoteSort,
} from '@/data/quote-rules'
import { QUOTES_PAGE_SIZE, useQuotesList, type QuoteListRow } from '@/data/quotes'
import { shopToday } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { QuoteFilters } from './quotes/QuoteFilters'
import { QuoteStatusBadge } from './quotes/QuoteStatusBadge'

/** The quotes list. `creating` (the /quotes/new route) opens the New quote sheet over it. */
export function QuotesPage({ creating = false }: { creating?: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const params = parseQuoteListParams(searchParams)
  const list = useQuotesList(params)
  const [today] = useState(shopToday)

  const search = searchParams.toString()
  const update = useCallback(
    (change: Partial<QuoteListParams>) => {
      const current = parseQuoteListParams(new URLSearchParams(search))
      setSearchParams(toQuoteListSearch({ ...current, page: 1, ...change }), { replace: true })
    },
    [search, setSearchParams],
  )

  const outOfRange = list.data?.outOfRange === true
  useEffect(() => {
    if (outOfRange && params.page !== 1) update({ page: 1 })
  }, [outOfRange, params.page, update])

  function onSort(key: string) {
    const sort = key as QuoteSort
    const dir =
      sort === params.sort
        ? params.dir === 'asc'
          ? 'desc'
          : 'asc'
        : sort === 'valid_until'
          ? 'asc'
          : 'desc'
    update({ sort, dir })
  }

  const clearFilters = () =>
    update({ q: '', status: [], client: null, from: null, to: null, page: DEFAULT_QUOTE_LIST.page })

  const columns: Column<QuoteListRow>[] = [
    {
      key: 'number',
      sortKey: 'number',
      header: t('quotes.columns.number'),
      cell: (q) => (
        <Link to={`/quotes/${q.id}`} className="font-medium underline-offset-4 hover:underline">
          {q.number}
        </Link>
      ),
    },
    {
      key: 'client',
      header: t('quotes.columns.client'),
      cell: (q) => (
        <div className="grid">
          <span>{q.client_name}</span>
          {q.client_company && (
            <span className="text-xs text-muted-foreground">{q.client_company}</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('quotes.columns.status'),
      cell: (q) => <QuoteStatusBadge status={q.status} />,
    },
    {
      key: 'total',
      sortKey: 'total',
      header: t('quotes.columns.total'),
      className: 'text-right',
      cell: (q) => (q.total === null ? '—' : format.currency(q.total)),
    },
    {
      key: 'created',
      sortKey: 'created',
      header: t('quotes.columns.created'),
      className: 'hidden md:table-cell',
      cell: (q) => (
        <div className="grid">
          <span>{format.date(q.created_at)}</span>
          <span className="text-xs text-muted-foreground">
            {t('quotes.createdBy', { name: q.created_by_name })}
          </span>
        </div>
      ),
    },
    {
      key: 'validUntil',
      sortKey: 'valid_until',
      header: t('quotes.columns.validUntil'),
      cell: (q) => (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {format.date(q.valid_until)}
          {expiresSoon(q, today) && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Clock aria-hidden className="size-3.5" />
              {t('quotes.expiresSoon')}
            </span>
          )}
        </span>
      ),
    },
  ]

  const tableQuery: TableQuery<QuoteListRow> = {
    isPending: list.isPending,
    isError: list.isError,
    error: list.error,
    data: list.data?.rows,
    refetch: list.refetch,
  }
  const filtered = hasFilters(params)

  return (
    <section>
      <PageHeader
        title={t('nav.quotes')}
        actions={
          <Button onClick={() => navigate('/quotes/new')}>
            <Plus aria-hidden />
            {t('quotes.new')}
          </Button>
        }
      />
      <QuoteFilters params={params} onChange={update} onClear={clearFilters} />
      <DataTable
        query={tableQuery}
        columns={columns}
        rowKey={(q) => q.id}
        caption={t('nav.quotes')}
        sort={{ key: params.sort, dir: params.dir, onSort }}
        pagination={{
          page: params.page,
          pageSize: QUOTES_PAGE_SIZE,
          total: list.data?.count ?? 0,
          onPage: (page) => update({ page }),
        }}
        empty={
          filtered ? (
            <>
              {t('quotes.noMatches')}{' '}
              <Button variant="link" onClick={clearFilters}>
                {t('quotes.filters.clear')}
              </Button>
            </>
          ) : (
            t('quotes.empty')
          )
        }
      />
      {creating && null}
    </section>
  )
}
```

(`{creating && null}` is the hook Task 5 replaces with the New quote sheet; leave it as is for now.)

In `apps/web/src/app/routes.tsx`, import `QuotesPage` and add `'/quotes': <QuotesPage />,` to `SECTION_PAGES`.

- [ ] **Step 8: Add the list texts**

Merge into `it.json`:

```json
"common": {
  "previous": "Precedente",
  "next": "Successiva",
  "pageRange": "{{from}}–{{to}} di {{total}}"
},
"quotes": {
  "search": "Cerca per numero o cliente",
  "columns": {
    "number": "Numero",
    "client": "Cliente",
    "status": "Stato",
    "total": "Totale",
    "created": "Creato",
    "validUntil": "Valido fino al"
  },
  "createdBy": "da {{name}}",
  "expiresSoon": "Scade a breve",
  "empty": "Nessun preventivo.",
  "noMatches": "Nessun preventivo corrisponde ai filtri.",
  "filters": {
    "status": "Stato",
    "statusCount": "Stato ({{count}})",
    "client": "Cliente",
    "anyClient": "Tutti i clienti",
    "from": "Creato dal",
    "to": "Creato al",
    "clear": "Cancella filtri"
  }
}
```

and into `en.json`:

```json
"common": {
  "previous": "Previous",
  "next": "Next",
  "pageRange": "{{from}}–{{to}} of {{total}}"
},
"quotes": {
  "search": "Search by number or client",
  "columns": {
    "number": "Number",
    "client": "Client",
    "status": "Status",
    "total": "Total",
    "created": "Created",
    "validUntil": "Valid until"
  },
  "createdBy": "by {{name}}",
  "expiresSoon": "Expires soon",
  "empty": "No quotes yet.",
  "noMatches": "No quotes match these filters.",
  "filters": {
    "status": "Status",
    "statusCount": "Status ({{count}})",
    "client": "Client",
    "anyClient": "All clients",
    "from": "Created from",
    "to": "Created to",
    "clear": "Clear filters"
  }
}
```

(Merge means: add these keys next to the existing ones in `common` and `quotes`; keep `quotes.new` and
`quotes.status`.)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/pages/QuotesPage.test.tsx src/app src/test src/i18n`
Expected: PASS.

- [ ] **Step 10: Format, lint, build, run everything and commit**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

```bash
git add apps/web/src
git commit -m "feat(web): quotes list with search, filters, sorting and pages kept in the URL"
```

---

### Task 5: New quote sheet, client picker and toasts

**Files:**
- Create (shadcn): `apps/web/src/components/ui/command.tsx`, `dialog.tsx` (pulled in by command), `sonner.tsx`
- Modify: `apps/web/src/test/setup.ts`
- Modify: `apps/web/src/app/AppProviders.tsx`
- Modify: `apps/web/src/data/quotes.ts`
- Modify: `apps/web/src/pages/clients/ClientSheet.tsx`
- Create: `apps/web/src/pages/quotes/labels.ts`, `ClientPicker.tsx`, `quote-form.ts`, `QuoteFields.tsx`,
  `NewQuoteSheet.tsx`
- Create: `apps/web/src/pages/quotes/NewQuoteSheet.test.tsx`
- Modify: `apps/web/src/pages/QuotesPage.tsx`, `apps/web/src/app/routes.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `en.json`

**Interfaces:**
- Consumes: `useClients(search)`, `useClient(id)`, `type Client`, `type ClientOption` (Task 4), `useSettings()`,
  `shopToday`, `addDays`, `toInputNumber`, `numberField`, `nullIfEmpty`, `parseDecimal`.
- Produces in `data/quotes.ts`:
  - `type QuoteValues = { client_id: number; valid_until: string; notes: string | null }`;
  - `useCreateQuote()` (`mutateAsync(values: QuoteValues): Promise<number>`, the new id);
  - `useSetMarkupOverride()` (`mutateAsync({ quoteId: number, pct: number | null })`).
- Produces in `pages/quotes/quote-form.ts`: `quoteSchema(today: string)`, `type QuoteForm`
  (`{ client: ClientOption | null; valid_until: string; notes: string; markup: string }`),
  `quoteToForm(source, locale)`, `formToQuote(form): QuoteValues`, `formMarkup(form): number | null`.
- Produces:
  - `clientLabel(client: ClientOption): string` in `pages/quotes/labels.ts` ("Mario Rossi (Rossi Meccanica)");
  - `QuoteFields({ form, idPrefix, showMarkup })`;
  - `ClientPicker({ id, value, onChange, invalid })`;
  - `NewQuoteSheet({ clientId, onClose })`;
  - `ClientSheet({ onClose, onCreated? })`.
- Produces: a `<Toaster />` mounted in `AppProviders`; components call `toast` / `toast.error` from `sonner`.

- [ ] **Step 1: Add the shadcn components and the jsdom stubs**

Run: `npx shadcn add command sonner -c apps/web`, then
`git checkout -- apps/web/src/components/ui/button.tsx apps/web/src/components/ui/label.tsx` and `npm run format`.
Expected:
- new `command.tsx`, `dialog.tsx` and `sonner.tsx` in `apps/web/src/components/ui/`;
- `cmdk`, `sonner` and `next-themes` in `apps/web/package.json`.

`sonner.tsx` reads the theme with `useTheme()` from `next-themes`; without a provider that falls back to `system`, so
it needs no change.

Add to `apps/web/src/test/setup.ts`, after the `ResizeObserver` stub:

```ts
// jsdom has no matchMedia; sonner's Toaster reads the colour scheme with it.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList

// jsdom has no scrollIntoView; cmdk scrolls the highlighted option into view.
Element.prototype.scrollIntoView ??= function () {}
```

In `apps/web/src/app/AppProviders.tsx`, import `{ Toaster } from '@/components/ui/sonner'` and render it after the
children:

```tsx
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
```

Run: `npm run build && npm test`
Expected: both pass (nothing uses the new components yet).

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/pages/quotes/NewQuoteSheet.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { clientRow, operatorStaff } from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()
const mario = () => clientRow({ id: 1, name: 'Mario Rossi', company: 'Rossi Meccanica' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

async function openSheet() {
  return screen.findByRole('dialog', { name: 'Nuovo preventivo' })
}

test('opens with the client from the URL and the default validity', async () => {
  renderApp('/quotes/new?client=1', { session, tables: { clients: [mario()] } })
  const sheet = await openSheet()
  expect(await within(sheet).findByRole('combobox', { name: 'Cliente' })).toHaveTextContent(
    'Mario Rossi (Rossi Meccanica)',
  )
  // Settings fixture: 30 days of validity.
  expect(within(sheet).getByLabelText('Valido fino al')).toHaveValue('2026-11-12')
})

test('creates the quote and opens it', async () => {
  const { db, user, router } = renderApp('/quotes/new?client=1', {
    session,
    tables: { clients: [mario()] },
  })
  const sheet = await openSheet()
  await within(sheet).findByText('Mario Rossi (Rossi Meccanica)')
  await user.type(within(sheet).getByLabelText('Note'), 'Consegna urgente')
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes/1'))
  expect(db.calls('quotes')).toContainEqual({
    op: 'insert',
    filters: [],
    values: { client_id: 1, valid_until: '2026-11-12', notes: 'Consegna urgente' },
  })
  expect(db.rpcCalls('set_markup_override')).toEqual([])
})

test('requires a client and a date that is not in the past', async () => {
  const { db, user } = renderApp('/quotes/new', { session })
  const sheet = await openSheet()
  const validUntil = within(sheet).getByLabelText('Valido fino al')
  fireEvent.change(validUntil, { target: { value: '' } })
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  expect(await within(sheet).findAllByText('Campo obbligatorio.')).toHaveLength(2)

  fireEvent.change(validUntil, { target: { value: '2026-10-12' } })
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  expect(await within(sheet).findByText('Deve essere oggi o una data futura.')).toBeInTheDocument()
  expect(db.calls('quotes').filter((call) => call.op === 'insert')).toEqual([])
})

test('owners can set a markup override', async () => {
  const { db, user, router } = renderApp('/quotes/new?client=1', {
    session,
    tables: { clients: [mario()] },
    rpc: { set_markup_override: () => null },
  })
  const sheet = await openSheet()
  await within(sheet).findByText('Mario Rossi (Rossi Meccanica)')
  await user.type(within(sheet).getByLabelText('Ricarico personalizzato (%)'), '35,5')
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes/1'))
  expect(db.rpcCalls('set_markup_override')).toEqual([{ quote_id: 1, pct: 35.5 }])
})

test('operators do not see the markup field', async () => {
  renderApp('/quotes/new', { session, staff: operatorStaff })
  const sheet = await openSheet()
  expect(within(sheet).queryByLabelText('Ricarico personalizzato (%)')).not.toBeInTheDocument()
})

test('a markup that fails to save still opens the quote and says so', async () => {
  const { db, user, router } = renderApp('/quotes/new?client=1', {
    session,
    tables: { clients: [mario()] },
    rpc: { set_markup_override: () => null },
  })
  db.failNext('set_markup_override', { code: 'XX000', message: 'boom' })
  const sheet = await openSheet()
  await within(sheet).findByText('Mario Rossi (Rossi Meccanica)')
  await user.type(within(sheet).getByLabelText('Ricarico personalizzato (%)'), '35')
  await user.click(within(sheet).getByRole('button', { name: 'Crea preventivo' }))
  expect(
    await screen.findByText('Preventivo creato, ma il ricarico non è stato salvato.'),
  ).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes/1')
})

test('picks a client by searching', async () => {
  const { user } = renderApp('/quotes/new', {
    session,
    tables: { clients: [mario(), clientRow({ id: 2, name: 'Luca Verdi', company: null })] },
  })
  const sheet = await openSheet()
  await user.click(within(sheet).getByRole('combobox', { name: 'Cliente' }))
  await user.type(await screen.findByRole('combobox', { name: 'Cerca cliente' }), 'verdi')
  await user.click(await screen.findByRole('option', { name: 'Luca Verdi' }))
  expect(within(sheet).getByRole('combobox', { name: 'Cliente' })).toHaveTextContent('Luca Verdi')
})

test('creates a client inline and selects it', async () => {
  const { user } = renderApp('/quotes/new', { session })
  const sheet = await openSheet()
  await user.click(within(sheet).getByRole('combobox', { name: 'Cliente' }))
  await user.click(await screen.findByRole('option', { name: 'Nuovo cliente' }))
  const clientSheet = await screen.findByRole('dialog', { name: 'Nuovo cliente' })
  await user.type(within(clientSheet).getByLabelText('Nome'), 'Giulia Neri')
  await user.click(within(clientSheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Nuovo cliente' })).not.toBeInTheDocument(),
  )
  expect(
    within(await openSheet()).getByRole('combobox', { name: 'Cliente' }),
  ).toHaveTextContent('Giulia Neri')
})

test('closing the sheet goes back to the list', async () => {
  const { user, router } = renderApp('/quotes/new', { session })
  const sheet = await openSheet()
  await user.click(within(sheet).getByRole('button', { name: 'Chiudi' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes'))
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/quotes/NewQuoteSheet.test.tsx`
Expected: FAIL. `/quotes/new` still shows the placeholder.

- [ ] **Step 4: Add the create and markup hooks**

In `apps/web/src/data/quotes.ts`, change the TanStack import to
`import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'`, add
`import type { TablesInsert } from '@/lib/database.types'`, and append:

```ts
export type QuoteValues = { client_id: number; valid_until: string; notes: string | null }

/** Inserts a draft; the database assigns its number. Resolves to the new id. */
export function useCreateQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: QuoteValues): Promise<number> => {
      // A trigger assigns number, number_year and number_seq; the generated Insert type still requires them, and
      // staff may only insert client_id, valid_until and notes.
      const { data, error } = await supabase
        .from('quotes')
        .insert(values as TablesInsert<'quotes'>)
        .select('id')
        .single()
      if (error) throw toAppError(error)
      return data.id
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
  })
}

/** Owner only. `pct` null removes the override; every item's price breakdown is cleared. */
export function useSetMarkupOverride() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ quoteId, pct }: { quoteId: number; pct: number | null }) => {
      // The generated Args type says number, but the function accepts null to clear the override.
      const { error } = await supabase.rpc('set_markup_override', {
        quote_id: quoteId,
        pct: pct as number,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quotesAll }),
  })
}
```

- [ ] **Step 5: Let `ClientSheet` hand back the new client**

In `apps/web/src/pages/clients/ClientSheet.tsx`, change the signature, the doc comment and the success branch:

```tsx
/** New client; on save, goes to the new client's page, or hands the client to `onCreated` when given. */
export function ClientSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated?: (client: Client) => void
}) {
```

```tsx
      const created = await save.mutateAsync({ values: formToClient(values) })
      if (onCreated) onCreated(created)
      else navigate(`/clients/${created.id}`)
```

(import `type Client` from `@/data/clients`).

- [ ] **Step 6: The form schema, the client picker and the shared fields**

Create `apps/web/src/pages/quotes/quote-form.ts`:

```ts
import { z } from 'zod'
import type { ClientOption } from '@/data/clients'
import type { QuoteValues } from '@/data/quotes'
import { toInputNumber, type Locale } from '@/lib/format'
import { nullIfEmpty, numberField, parseDecimal } from '@/lib/forms'

/** New quote and Edit details. `today` is the shop date: valid-until may not be earlier. */
export function quoteSchema(today: string) {
  return z.object({
    client: z.custom<ClientOption | null>().refine((client) => client !== null, 'validation.required'),
    valid_until: z
      .string()
      .refine((value) => value !== '', 'validation.required')
      .refine((value) => value === '' || value >= today, 'validation.validUntilPast'),
    notes: z.string(),
    markup: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative', optional: true }),
  })
}

export type QuoteForm = z.infer<ReturnType<typeof quoteSchema>>

export function quoteToForm(
  source: {
    client: ClientOption | null
    valid_until: string
    notes: string | null
    markup_override_pct: number | null
  },
  locale: Locale,
): QuoteForm {
  return {
    client: source.client,
    valid_until: source.valid_until,
    notes: source.notes ?? '',
    markup: toInputNumber(source.markup_override_pct, locale),
  }
}

/** Only call on a validated form: the client is set. */
export function formToQuote(form: QuoteForm): QuoteValues {
  return {
    client_id: (form.client as ClientOption).id,
    valid_until: form.valid_until,
    notes: nullIfEmpty(form.notes),
  }
}

/** The markup override, or null when the field is empty. */
export function formMarkup(form: QuoteForm): number | null {
  return form.markup.trim() === '' ? null : parseDecimal(form.markup)
}
```

Create `apps/web/src/pages/quotes/labels.ts` (plain functions live outside component files, for React Refresh):

```ts
import type { ClientOption } from '@/data/clients'

export function clientLabel(client: ClientOption) {
  return client.company ? `${client.name} (${client.company})` : client.name
}
```

Create `apps/web/src/pages/quotes/ClientPicker.tsx`:

```tsx
import { ChevronsUpDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClients, type ClientOption } from '@/data/clients'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { ClientSheet } from '../clients/ClientSheet'
import { clientLabel } from './labels'

/** Searches clients on the server; the last option creates a new client and selects it. */
export function ClientPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: ClientOption | null
  onChange: (client: ClientOption) => void
  invalid?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const clients = useClients(debounced)
  const [creating, setCreating] = useState(false)

  function pick(client: ClientOption) {
    onChange({ id: client.id, name: client.name, company: client.company })
    setOpen(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            className="w-full justify-between font-normal"
          >
            {value ? (
              clientLabel(value)
            ) : (
              <span className="text-muted-foreground">{t('quotes.form.chooseClient')}</span>
            )}
            <ChevronsUpDown aria-hidden className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          {/* cmdk labels its input through the Command's `label`. */}
          <Command shouldFilter={false} label={t('quotes.form.clientSearch')}>
            <CommandInput
              placeholder={t('quotes.form.clientSearch')}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {clients.isPending && (
                <p role="status" className="p-3 text-sm text-muted-foreground">
                  {t('common.loading')}
                </p>
              )}
              {clients.data?.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">{t('quotes.form.noClients')}</p>
              )}
              {clients.data && clients.data.length > 0 && (
                <CommandGroup>
                  {clients.data.map((client) => (
                    <CommandItem key={client.id} value={String(client.id)} onSelect={() => pick(client)}>
                      {clientLabel(client)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="new-client"
                  onSelect={() => {
                    setOpen(false)
                    setCreating(true)
                  }}
                >
                  <Plus aria-hidden />
                  {t('quotes.form.newClient')}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {creating && (
        <ClientSheet
          onClose={() => setCreating(false)}
          onCreated={(client) => {
            pick(client)
            setCreating(false)
          }}
        />
      )}
    </>
  )
}
```

Create `apps/web/src/pages/quotes/QuoteFields.tsx`:

```tsx
import { Controller, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ClientPicker } from './ClientPicker'
import type { QuoteForm } from './quote-form'

/** Client, valid until, notes and (owners) the markup override: New quote and Edit details share them. */
export function QuoteFields({
  form,
  idPrefix,
  showMarkup,
}: {
  form: UseFormReturn<QuoteForm>
  idPrefix: string
  showMarkup: boolean
}) {
  const { t } = useTranslation()
  const {
    register,
    control,
    formState: { errors },
  } = form
  return (
    <>
      <FormField
        id={`${idPrefix}-client`}
        label={t('quotes.form.client')}
        error={errors.client?.message}
      >
        <Controller
          control={control}
          name="client"
          render={({ field }) => (
            <ClientPicker
              id={`${idPrefix}-client`}
              value={field.value}
              onChange={field.onChange}
              invalid={!!errors.client}
            />
          )}
        />
      </FormField>
      <FormField
        id={`${idPrefix}-valid-until`}
        label={t('quotes.form.validUntil')}
        error={errors.valid_until?.message}
      >
        <Input
          id={`${idPrefix}-valid-until`}
          type="date"
          aria-invalid={!!errors.valid_until}
          {...register('valid_until')}
        />
      </FormField>
      <FormField id={`${idPrefix}-notes`} label={t('quotes.form.notes')}>
        <Textarea id={`${idPrefix}-notes`} {...register('notes')} />
      </FormField>
      {showMarkup && (
        <FormField
          id={`${idPrefix}-markup`}
          label={t('quotes.form.markup')}
          error={errors.markup?.message}
        >
          <Input
            id={`${idPrefix}-markup`}
            inputMode="decimal"
            aria-invalid={!!errors.markup}
            aria-describedby={`${idPrefix}-markup-hint`}
            {...register('markup')}
          />
          <p id={`${idPrefix}-markup-hint`} className="text-xs text-muted-foreground">
            {t('quotes.form.markupHint')}
          </p>
        </FormField>
      )}
    </>
  )
}
```

- [ ] **Step 7: The sheet, its route and the list's New quote**

Create `apps/web/src/pages/quotes/NewQuoteSheet.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useStaff } from '@/auth/staff-context'
import { FormSheet } from '@/components/FormSheet'
import { QueryError } from '@/components/QueryError'
import { Button } from '@/components/ui/button'
import { useClient, type ClientOption } from '@/data/clients'
import { toAppError } from '@/data/errors'
import { useCreateQuote, useSetMarkupOverride } from '@/data/quotes'
import { useSettings } from '@/data/settings'
import { addDays, shopToday } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { formMarkup, formToQuote, quoteSchema, quoteToForm, type QuoteForm } from './quote-form'
import { QuoteFields } from './QuoteFields'

/** New quote; `clientId` (from /quotes/new?client=) pre-selects a client. Opens the editor once created. */
export function NewQuoteSheet({
  clientId,
  onClose,
}: {
  clientId: number | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const settings = useSettings()
  const client = useClient(clientId)
  // A disabled query (no client id) stays pending, so only wait for it when there is an id.
  const ready = settings.data !== undefined && (clientId === null || !client.isPending)

  if (!ready) {
    return (
      <FormSheet title={t('quotes.new')} dirty={false} onClose={onClose}>
        {settings.isError ? (
          <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <p role="status" className="text-muted-foreground">
            {t('common.loading')}
          </p>
        )}
      </FormSheet>
    )
  }
  return (
    <NewQuoteForm
      validityDays={settings.data.default_validity_days}
      client={client.data ?? null}
      onClose={onClose}
    />
  )
}

function NewQuoteForm({
  validityDays,
  client,
  onClose,
}: {
  validityDays: number
  client: ClientOption | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const { locale } = useFormat()
  const navigate = useNavigate()
  const create = useCreateQuote()
  const setMarkup = useSetMarkupOverride()
  const [today] = useState(shopToday)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<QuoteForm>({
    resolver: zodResolver(quoteSchema(today)),
    defaultValues: quoteToForm(
      {
        client: client && { id: client.id, name: client.name, company: client.company },
        valid_until: addDays(today, validityDays),
        notes: null,
        markup_override_pct: null,
      },
      locale,
    ),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    let id: number
    try {
      id = await create.mutateAsync(formToQuote(values))
    } catch (error) {
      setFormError(toAppError(error).messageKey)
      return
    }
    const markup = formMarkup(values)
    if (isOwner && markup !== null) {
      try {
        await setMarkup.mutateAsync({ quoteId: id, pct: markup })
      } catch {
        // The quote exists; open it rather than leave an orphan behind the sheet.
        toast.error(t('quotes.markupNotSaved'))
      }
    }
    navigate(`/quotes/${id}`)
  })

  return (
    <FormSheet title={t('quotes.new')} dirty={form.formState.isDirty} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <QuoteFields form={form} idPrefix="new-quote" showMarkup={isOwner} />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button type="submit" disabled={create.isPending || setMarkup.isPending}>
          {t('quotes.form.create')}
        </Button>
      </form>
    </FormSheet>
  )
}
```

In `apps/web/src/pages/QuotesPage.tsx`, import `NewQuoteSheet` from `./quotes/NewQuoteSheet` and replace
`{creating && null}` with:

```tsx
      {creating && (
        <NewQuoteSheet clientId={params.client} onClose={() => navigate('/quotes')} />
      )}
```

In `apps/web/src/app/routes.tsx`, replace the `quotes/new` route's element with `<QuotesPage creating />` (and drop
the `SectionPage` import if nothing else uses it — `SECTIONS` still falls back to it, so it stays).

- [ ] **Step 8: Add the texts**

Merge into `it.json`:

```json
"validation": {
  "validUntilPast": "Deve essere oggi o una data futura."
},
"quotes": {
  "markupNotSaved": "Preventivo creato, ma il ricarico non è stato salvato.",
  "form": {
    "client": "Cliente",
    "clientSearch": "Cerca cliente",
    "chooseClient": "Scegli un cliente",
    "noClients": "Nessun cliente trovato.",
    "newClient": "Nuovo cliente",
    "validUntil": "Valido fino al",
    "notes": "Note",
    "markup": "Ricarico personalizzato (%)",
    "markupHint": "Se vuoto si usa il ricarico predefinito.",
    "create": "Crea preventivo"
  }
}
```

and into `en.json`:

```json
"validation": {
  "validUntilPast": "Must be today or later."
},
"quotes": {
  "markupNotSaved": "Quote created, but the markup wasn't saved.",
  "form": {
    "client": "Client",
    "clientSearch": "Search clients",
    "chooseClient": "Choose a client",
    "noClients": "No clients found.",
    "newClient": "New client",
    "validUntil": "Valid until",
    "notes": "Notes",
    "markup": "Markup override (%)",
    "markupHint": "When empty, the default markup applies.",
    "create": "Create quote"
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/pages`
Expected: PASS, including `ClientsPage.test.tsx` (a client created from the Clients page still opens its page).

- [ ] **Step 10: Format, lint, build, run everything and commit**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

```bash
git add apps/web/package.json package-lock.json apps/web/src
git commit -m "feat(web): New quote sheet with a searchable client picker, inline new client and toasts"
```

---

### Task 6: Quote editor — header, details and lifecycle actions

**Files:**
- Modify: `apps/web/src/test/fake-db.ts`, `apps/web/src/test/fake-db.test.ts`, `apps/web/src/test/render-app.tsx`,
  `apps/web/src/test/fixtures.ts`
- Modify: `apps/web/src/data/quotes.ts`
- Create: `apps/web/src/data/quote-items.ts`
- Create: `apps/web/src/pages/QuoteEditorPage.tsx`, `apps/web/src/pages/QuoteEditorPage.test.tsx`
- Create: `apps/web/src/pages/quote-editor/QuoteHeader.tsx`, `QuoteDetailsSheet.tsx`, `QuoteActions.tsx`,
  `SendQuoteDialog.tsx`, `ConfirmActionDialog.tsx`
- Modify: `apps/web/src/app/routes.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `en.json`

**Interfaces:**
- Consumes:
  - from Task 5: `QuoteValues`, `useSetMarkupOverride`, `QuoteFields`, `quoteSchema`, `quoteToForm`, `formToQuote`,
    `formMarkup`, `clientLabel` (`pages/quotes/labels.ts`);
  - from Task 4: `QuoteStatusBadge`;
  - from Task 3: `ItemJob`, `isSlicingInProgress`;
  - from Task 2: `invokeFunction`.
- Produces in `data/quotes.ts`:
  - `type Quote = Tables<'quotes'> & { client: ClientOption; creator: { display_name: string } }`;
  - `useQuote(id: number | null)`;
  - `useUpdateQuote()` (`{ id, values: Partial<QuoteValues> }`), `useDeleteQuote()` (`mutateAsync(id)`);
  - `type SendBlocker = { quote_item_id: number | null; code: string }`, `useSendBlockers(quoteId, enabled)`;
  - `type QuoteOutcome = 'sent' | 'accepted' | 'rejected'`, `useMarkQuote()` (`{ quoteId, outcome }`);
  - `useDuplicateQuote()` (`mutateAsync(quoteId): Promise<number>`, the copy's id).
- Produces in `data/quote-items.ts`: `type QuoteItem = Tables<'quote_items'> & { job: ItemJob | null }`,
  `useQuoteItems(quoteId: number)`.
- Produces in the fakes:
  - `FakeDb#configure({ defaults?, embeds? })`;
  - `renderApp` configures quotes (insert defaults; `client` and `creator` embedded from the `clients` and `staff`
    tables) and quote items (`job` embedded as `[]` when not seeded);
  - fixtures `quoteItemRow(overrides)` and `jobRow(overrides)`.
- Produces: `QuoteEditorPage`, mounted at `/quotes/:id`. The items area lists descriptions only; Task 7 replaces it
  with item cards.

- [ ] **Step 1: Teach the fake about defaults and embedded rows (test first)**

Add to `apps/web/src/test/fake-db.test.ts`:

```ts
test('configure() fills insert defaults and embeds rows on select', async () => {
  const db = new FakeDb({ clients: [{ id: 1, name: 'Mario' }] }).configure({
    defaults: { quotes: () => ({ status: 'draft' }) },
    embeds: {
      quotes: (row, fake) => ({ client: fake.table('clients').find((c) => c.id === row.client_id) }),
    },
  })
  await db.from('quotes').insert({ client_id: 1 })
  const { data } = await db.from('quotes').select('*').single()
  expect(data).toEqual({ id: 1, status: 'draft', client_id: 1, client: { id: 1, name: 'Mario' } })
  expect(db.calls('quotes')[0]).toEqual({ op: 'insert', filters: [], values: { client_id: 1 } })
})
```

Run: `npm test --workspace @3d-quote/web -- src/test/fake-db.test.ts`
Expected: FAIL (`configure` is not a function).

In `apps/web/src/test/fake-db.ts`, add to `FakeDb`:

```ts
  private defaults: Record<string, () => Row> = {}
  private embeds: Record<string, (row: Row, db: FakeDb) => Row> = {}

  /**
   * What the real database adds: column defaults and trigger values on insert, and embedded resources on select
   * (only fields the row doesn't already carry, so seeded embeds win).
   */
  configure(options: {
    defaults?: Record<string, () => Row>
    embeds?: Record<string, (row: Row, db: FakeDb) => Row>
  }) {
    Object.assign(this.defaults, options.defaults)
    Object.assign(this.embeds, options.embeds)
    return this
  }

  /** @internal used by FakeQuery */
  defaultsFor(table: string): Row {
    return this.defaults[table]?.() ?? {}
  }

  /** @internal used by FakeQuery */
  withEmbeds(table: string, row: Row): Row {
    const embed = this.embeds[table]
    if (!embed) return { ...row }
    const extra = Object.fromEntries(
      Object.entries(embed(row, this)).filter(([key]) => !(key in row)),
    )
    return { ...row, ...extra }
  }
```

In `FakeQuery.run()`, the insert branch becomes:

```ts
      affected = list.map((values) => ({
        id: this.db.nextId(this.tableName),
        ...this.db.defaultsFor(this.tableName),
        ...values,
      }))
```

and `const data = affected.map((row) => ({ ...row }))` becomes
`const data = affected.map((row) => this.db.withEmbeds(this.tableName, row))`.

Run: `npm test --workspace @3d-quote/web -- src/test/fake-db.test.ts`
Expected: PASS.

In `apps/web/src/test/render-app.tsx`, after creating `db`, configure it (import `quoteRow` from `./fixtures`):

```ts
  db.configure({
    defaults: {
      // Column defaults and the numbering trigger.
      quotes: () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...defaults } = quoteRow()
        return defaults
      },
    },
    embeds: {
      quotes: (row, fake) => {
        const client = fake.table('clients').find((c) => c.id === row.client_id)
        const creator = fake.table('staff').find((s) => s.user_id === row.created_by)
        return {
          client: client ? { id: client.id, name: client.name, company: client.company } : null,
          creator: { display_name: creator?.display_name ?? '' },
        }
      },
      quote_items: () => ({ job: [] }),
    },
  })
```

Add to `apps/web/src/test/fixtures.ts` (import `type ItemJob` from `@/data/quote-rules`):

```ts
export function jobRow(overrides: Partial<ItemJob> = {}): ItemJob {
  return {
    id: nextId++,
    status: 'queued',
    error: null,
    queued_at: '2026-10-13T09:59:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  }
}

/** A quote item as the items query returns it; `job` is the newest slicing job (embedded as a 0–1 array). */
export function quoteItemRow(
  overrides: Partial<Tables<'quote_items'>> & { job?: ItemJob | null } = {},
) {
  const { job = null, ...rest } = overrides
  const id = rest.id ?? nextId++
  return {
    id,
    quote_id: 7,
    model_path: `7/u${id}/staffa.stl`,
    original_filename: 'staffa.stl',
    description: 'Staffa',
    printer_id: null,
    material_id: null,
    quantity: 1,
    layer_height_mm: 0.2,
    infill_percent: 20,
    supports: false,
    print_time_s: null,
    filament_g: null,
    bbox_x_mm: null,
    bbox_y_mm: null,
    bbox_z_mm: null,
    material_cost: null,
    machine_cost: null,
    energy_cost: null,
    failure_cost: null,
    setup_fee: null,
    markup_amount: null,
    markup_pct: null,
    computed_total: null,
    override_total: null,
    override_reason: null,
    item_total: null,
    priced_at: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    job: job ? [job] : [],
  }
}
```

- [ ] **Step 2: Write the failing page tests**

Create `apps/web/src/pages/QuoteEditorPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import type { FunctionHandler, Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  jobRow,
  materialRow,
  operatorStaff,
  printerRow,
  quoteItemRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function renderEditor(
  opts: {
    quote?: Partial<Tables<'quotes'>>
    items?: Row[]
    staff?: Tables<'staff'>
    rpc?: Record<string, (args: unknown) => unknown>
    functions?: Record<string, FunctionHandler>
  } = {},
) {
  return renderApp('/quotes/7', {
    session,
    staff: opts.staff,
    tables: {
      quotes: [quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, ...opts.quote })],
      clients: [clientRow({ id: 1, name: 'Mario Rossi', company: 'Rossi Meccanica' })],
      quote_items: opts.items ?? [],
      printers: [printerRow({ id: 11, name: 'MK4 #1' })],
      materials: [materialRow({ id: 21 })],
    },
    rpc: opts.rpc,
    functions: opts.functions,
  })
}

async function heading() {
  return screen.findByRole('heading', { level: 1, name: 'Q-2026-0007' })
}

test('shows the header with the markup in effect', async () => {
  renderEditor()
  await heading()
  expect(screen.getByText('Bozza')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Mario Rossi (Rossi Meccanica)' })).toHaveAttribute(
    'href',
    '/clients/1',
  )
  expect(screen.getByText('Creato da Anna Rossi il 12/10/2026')).toBeInTheDocument()
  expect(screen.getByText('11/11/2026')).toBeInTheDocument()
  expect(await screen.findByText('40 % (predefinito)')).toBeInTheDocument()
})

test('a markup override is labelled as such', async () => {
  renderEditor({ quote: { markup_override_pct: 35 } })
  expect(await screen.findByText('35 % (personalizzato)')).toBeInTheDocument()
})

test('draft actions for owners and operators', async () => {
  renderEditor()
  await heading()
  for (const name of ['Segna come inviato', 'Duplica', 'Elimina', 'Modifica dati']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
})

test('operators cannot delete a draft', async () => {
  renderEditor({ staff: operatorStaff })
  await heading()
  expect(screen.getByRole('button', { name: 'Duplica' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Elimina' })).not.toBeInTheDocument()
})

test('sent quotes can be accepted, rejected or duplicated, not edited', async () => {
  renderEditor({ quote: { status: 'sent' } })
  await heading()
  for (const name of ['Segna come accettato', 'Segna come rifiutato', 'Duplica']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  for (const name of ['Segna come inviato', 'Modifica dati', 'Elimina']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

test('expired quotes can only be duplicated', async () => {
  renderEditor({ quote: { status: 'expired' } })
  await heading()
  expect(screen.getByRole('button', { name: 'Duplica' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Segna come accettato' })).not.toBeInTheDocument()
})

test('Mark as sent lists what is missing', async () => {
  const { user } = renderEditor({
    items: [quoteItemRow({ id: 31, description: 'Staffa', printer_id: 11, material_id: 21 })],
    rpc: {
      get_quote_send_blockers: () => [
        { quote_item_id: null, code: 'valid_until_past' },
        { quote_item_id: 31, code: 'does_not_fit' },
      ],
    },
  })
  await user.click(await screen.findByRole('button', { name: 'Segna come inviato' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Q-2026-0007 non può ancora essere inviato',
  })
  expect(within(dialog).getByText('La data di validità è passata.')).toBeInTheDocument()
  expect(await within(dialog).findByText('Staffa: non entra in MK4 #1.')).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Segna come inviato' })).not.toBeInTheDocument()
})

test('Mark as sent confirms when nothing is missing', async () => {
  const { db, user } = renderEditor({
    rpc: { get_quote_send_blockers: () => [], mark_quote_sent: () => null },
  })
  await user.click(await screen.findByRole('button', { name: 'Segna come inviato' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Segnare Q-2026-0007 come inviato?' })
  await user.click(within(dialog).getByRole('button', { name: 'Segna come inviato' }))
  await waitFor(() => expect(db.rpcCalls('mark_quote_sent')).toEqual([{ quote_id: 7 }]))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

test('Mark as sent waits while an item is slicing', async () => {
  renderEditor({
    items: [quoteItemRow({ printer_id: 11, material_id: 21, job: jobRow({ status: 'running' }) })],
  })
  await heading()
  expect(await screen.findByRole('button', { name: 'Segna come inviato' })).toBeDisabled()
  expect(screen.getByText('Attendi la fine dello slicing.')).toBeInTheDocument()
})

test('Mark accepted asks first', async () => {
  const { db, user } = renderEditor({
    quote: { status: 'sent' },
    rpc: { mark_quote_accepted: () => null },
  })
  await user.click(await screen.findByRole('button', { name: 'Segna come accettato' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Segnare Q-2026-0007 come accettato?',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Segna come accettato' }))
  await waitFor(() => expect(db.rpcCalls('mark_quote_accepted')).toEqual([{ quote_id: 7 }]))
})

test('Duplicate opens the copy', async () => {
  const { db, user, router } = renderEditor({
    functions: { 'duplicate-quote': () => ({ data: { quote_id: 57 } }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Duplica' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes/57'))
  expect(db.functionCalls('duplicate-quote')).toEqual([{ quote_id: 7 }])
  expect(await screen.findByText('Copia creata.')).toBeInTheDocument()
})

test('a failed duplicate says nothing was created', async () => {
  const { user, router } = renderEditor({
    functions: { 'duplicate-quote': () => ({ status: 500, code: 'duplicate_failed' }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Duplica' }))
  expect(
    await screen.findByText('Non è stato possibile copiare il preventivo. Non è stato creato nulla.'),
  ).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes/7')
})

test('owners delete a draft and its files', async () => {
  const { db, user, router } = renderEditor({
    items: [quoteItemRow({ id: 31, model_path: '7/u31/staffa.stl' })],
  })
  await user.click(await screen.findByRole('button', { name: 'Elimina' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare Q-2026-0007?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/quotes'))
  expect(db.calls('quotes')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 7]] })
  expect(db.storageCalls('models')).toContainEqual({ op: 'remove', paths: ['7/u31/staffa.stl'] })
})

test('Edit details saves only what changed', async () => {
  const { db, user } = renderEditor({ rpc: { set_markup_override: () => null } })
  await user.click(await screen.findByRole('button', { name: 'Modifica dati' }))
  const sheet = await screen.findByRole('dialog', { name: 'Dati del preventivo' })
  await user.type(within(sheet).getByLabelText('Note'), 'Nuove note')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Dati del preventivo' })).not.toBeInTheDocument(),
  )
  expect(db.calls('quotes')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 7]],
    values: { notes: 'Nuove note' },
  })
  expect(db.rpcCalls('set_markup_override')).toEqual([])
})

test('owners change the markup from Edit details', async () => {
  const { db, user } = renderEditor({ rpc: { set_markup_override: () => null } })
  await user.click(await screen.findByRole('button', { name: 'Modifica dati' }))
  const sheet = await screen.findByRole('dialog', { name: 'Dati del preventivo' })
  await user.type(within(sheet).getByLabelText('Ricarico personalizzato (%)'), '30')
  await user.click(within(sheet).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(db.rpcCalls('set_markup_override')).toEqual([{ quote_id: 7, pct: 30 }]),
  )
  expect(db.calls('quotes').filter((call) => call.op === 'update')).toEqual([])
})

test('an unknown or malformed id shows not found', async () => {
  renderApp('/quotes/999', { session })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
})

test('a malformed id shows not found', async () => {
  renderApp('/quotes/abc', { session })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/QuoteEditorPage.test.tsx`
Expected: FAIL. `/quotes/7` matches no route, so every test sees "Pagina non trovata" or times out.

- [ ] **Step 4: Add the quote and item hooks**

Append to `apps/web/src/data/quotes.ts` (add `AppError` to the `./errors` import, `Tables` to the
`@/lib/database.types` type import, `import type { ClientOption } from './clients'` and
`import { invokeFunction } from './edge-functions'`):

```ts
export type Quote = Tables<'quotes'> & {
  client: ClientOption
  creator: { display_name: string }
}

/** One quote with its client and creator, or null when it doesn't exist. `id` null disables the query. */
export function useQuote(id: number | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quote(id ?? 0),
    enabled: id !== null,
    queryFn: async (): Promise<Quote | null> => {
      const { data, error } = await supabase
        .from('quotes')
        .select('*, client:clients(id, name, company), creator:staff(display_name)')
        .eq('id', id as number)
        .maybeSingle()
      if (error) throw toAppError(error)
      return data as Quote | null
    },
  })
}

/** Draft only: RLS hides other quotes from updates, so no row back means the quote left draft. */
export function useUpdateQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id: number; values: Partial<QuoteValues> }) => {
      const { data, error } = await supabase.from('quotes').update(values).eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quotesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
  })
}

/** Owner, draft only. Removes the items' files afterwards, on a best-effort basis. */
export function useDeleteQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const items = await supabase.from('quote_items').select('model_path').eq('quote_id', id)
      if (items.error) throw toAppError(items.error)
      const { data, error } = await supabase.from('quotes').delete().eq('id', id).select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notFound')
      const paths = items.data.map((item) => item.model_path)
      // A file left behind is an orphan for the cleanup job, not a reason to report the delete as failed.
      if (paths.length > 0) await supabase.storage.from('models').remove(paths)
    },
    // Only the lists: refetching the deleted quote would flash "not found" before leaving the page.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
  })
}

export type SendBlocker = { quote_item_id: number | null; code: string }

/** Why the quote can't be sent yet; empty means it can. Always fetched fresh when the dialog opens. */
export function useSendBlockers(quoteId: number, enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.sendBlockers(quoteId),
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<SendBlocker[]> => {
      const { data, error } = await supabase.rpc('get_quote_send_blockers', { quote_id: quoteId })
      if (error) throw toAppError(error)
      // quote_item_id is null for quote-level blockers, though the generated type says number.
      return data as SendBlocker[]
    },
  })
}

export type QuoteOutcome = 'sent' | 'accepted' | 'rejected'

export function useMarkQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ quoteId, outcome }: { quoteId: number; outcome: QuoteOutcome }) => {
      const args = { quote_id: quoteId }
      const { error } =
        outcome === 'sent'
          ? await supabase.rpc('mark_quote_sent', args)
          : outcome === 'accepted'
            ? await supabase.rpc('mark_quote_accepted', args)
            : await supabase.rpc('mark_quote_rejected', args)
      if (error) throw toAppError(error)
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quotesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
  })
}

/** Copies the quote into a new priced draft (Edge Function). Resolves to the copy's id. */
export function useDuplicateQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (quoteId: number): Promise<number> => {
      const result = await invokeFunction<{ quote_id: number }>(supabase, 'duplicate-quote', {
        quote_id: quoteId,
      })
      return result.quote_id
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ]),
  })
}
```

Create `apps/web/src/data/quote-items.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'
import type { ItemJob } from './quote-rules'

export type QuoteItem = Tables<'quote_items'> & { job: ItemJob | null }

const ITEM_COLUMNS = '*, job:slicing_jobs(id, status, error, queued_at, started_at, finished_at)'

/** The quote's items in creation order, each with its newest slicing job. */
export function useQuoteItems(quoteId: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.quoteItems(quoteId),
    queryFn: async (): Promise<QuoteItem[]> => {
      const { data, error } = await supabase
        .from('quote_items')
        .select(ITEM_COLUMNS)
        .eq('quote_id', quoteId)
        .order('id')
        .order('id', { referencedTable: 'job', ascending: false })
        .limit(1, { referencedTable: 'job' })
      if (error) throw toAppError(error)
      return data.map(({ job, ...item }) => ({
        ...item,
        job: (job[0] as ItemJob | undefined) ?? null,
      }))
    },
  })
}
```

- [ ] **Step 5: Header, details sheet and dialogs**

Create `apps/web/src/pages/quote-editor/ConfirmActionDialog.tsx`:

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

/** Confirms a status change. The confirm button is a plain Button so the dialog stays open to show `error`. */
export function ConfirmActionDialog({
  title,
  body,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  pending: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

Create `apps/web/src/pages/quote-editor/SendQuoteDialog.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QueryError } from '@/components/QueryError'
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
import { toAppError } from '@/data/errors'
import { usePrinters } from '@/data/printers'
import type { QuoteItem } from '@/data/quote-items'
import { useMarkQuote, useSendBlockers, type Quote, type SendBlocker } from '@/data/quotes'

/** Lists what stops the quote from being sent, or confirms sending it. */
export function SendQuoteDialog({
  quote,
  items,
  onClose,
}: {
  quote: Quote
  items: QuoteItem[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const blockers = useSendBlockers(quote.id, true)
  const printers = usePrinters()
  const mark = useMarkQuote()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setError(null)
    try {
      await mark.mutateAsync({ quoteId: quote.id, outcome: 'sent' })
      onClose()
    } catch (caught) {
      const appError = toAppError(caught)
      // Something changed since the check: show the new reasons instead of a generic error.
      if (appError.kind === 'notSendable') void blockers.refetch()
      else setError(t(appError.messageKey))
    }
  }

  function describe(blocker: SendBlocker) {
    const item = items.find((candidate) => candidate.id === blocker.quote_item_id)
    const printer = printers.data?.find((candidate) => candidate.id === item?.printer_id)
    return t(`quotes.editor.blockers.${blocker.code}`, {
      item: item?.description ?? '',
      printer: printer?.name ?? '',
    })
  }

  const list = blockers.data ?? []
  const blocked = list.length > 0
  const canSend = blockers.isSuccess && !blocked
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked
              ? t('quotes.editor.send.blockedTitle', { number: quote.number })
              : t('quotes.editor.send.title', { number: quote.number })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blockers.isPending
              ? t('quotes.editor.send.checking')
              : blocked
                ? t('quotes.editor.send.blockedBody')
                : t('quotes.editor.send.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {blockers.isError && (
          <QueryError error={blockers.error} onRetry={() => void blockers.refetch()} />
        )}
        {blocked && (
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {list.map((blocker, index) => (
              <li key={`${blocker.code}-${blocker.quote_item_id ?? index}`}>{describe(blocker)}</li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          {canSend && (
            <Button onClick={() => void confirm()} disabled={mark.isPending}>
              {t('quotes.editor.markSent')}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

Create `apps/web/src/pages/quote-editor/QuoteActions.tsx`:

```tsx
import { Copy, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useStaff } from '@/auth/staff-context'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import type { QuoteItem } from '@/data/quote-items'
import { isSlicingInProgress } from '@/data/quote-rules'
import { useDeleteQuote, useDuplicateQuote, useMarkQuote, type Quote } from '@/data/quotes'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { SendQuoteDialog } from './SendQuoteDialog'

type OpenDialog = 'send' | 'accepted' | 'rejected' | 'delete' | null

/** The actions the quote's status allows (functional analysis §4). */
export function QuoteActions({ quote, items }: { quote: Quote; items: QuoteItem[] }) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const navigate = useNavigate()
  const mark = useMarkQuote()
  const duplicate = useDuplicateQuote()
  const remove = useDeleteQuote()
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const [error, setError] = useState<string | null>(null)
  const slicing = items.some(isSlicingInProgress)

  function close() {
    setDialog(null)
    setError(null)
  }

  async function runDuplicate() {
    try {
      const id = await duplicate.mutateAsync(quote.id)
      toast.success(t('quotes.editor.duplicated'))
      navigate(`/quotes/${id}`)
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function confirmOutcome(outcome: 'accepted' | 'rejected') {
    setError(null)
    try {
      await mark.mutateAsync({ quoteId: quote.id, outcome })
      close()
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  async function confirmDelete() {
    setError(null)
    try {
      await remove.mutateAsync(quote.id)
      navigate('/quotes')
    } catch (caught) {
      setError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <>
      {quote.status === 'draft' && (
        <>
          <Button
            disabled={slicing}
            aria-describedby={slicing ? 'send-hint' : undefined}
            onClick={() => setDialog('send')}
          >
            <Send aria-hidden />
            {t('quotes.editor.markSent')}
          </Button>
          {slicing && (
            <span id="send-hint" className="self-center text-sm text-muted-foreground">
              {t('quotes.editor.waitSlicing')}
            </span>
          )}
        </>
      )}
      {quote.status === 'sent' && (
        <>
          <Button onClick={() => setDialog('accepted')}>{t('quotes.editor.markAccepted')}</Button>
          <Button variant="outline" onClick={() => setDialog('rejected')}>
            {t('quotes.editor.markRejected')}
          </Button>
        </>
      )}
      <Button variant="outline" disabled={duplicate.isPending} onClick={() => void runDuplicate()}>
        <Copy aria-hidden />
        {t('quotes.editor.duplicate')}
      </Button>
      {quote.status === 'draft' && isOwner && (
        <Button variant="outline" onClick={() => setDialog('delete')}>
          <Trash2 aria-hidden />
          {t('common.delete')}
        </Button>
      )}

      {dialog === 'send' && <SendQuoteDialog quote={quote} items={items} onClose={close} />}
      {(dialog === 'accepted' || dialog === 'rejected') && (
        <ConfirmActionDialog
          title={t(
            dialog === 'accepted' ? 'quotes.editor.acceptTitle' : 'quotes.editor.rejectTitle',
            { number: quote.number },
          )}
          body={t('quotes.editor.outcomeBody')}
          confirmLabel={t(
            dialog === 'accepted' ? 'quotes.editor.markAccepted' : 'quotes.editor.markRejected',
          )}
          pending={mark.isPending}
          error={error}
          onConfirm={() => void confirmOutcome(dialog)}
          onCancel={close}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDeleteDialog
          title={t('quotes.editor.deleteTitle', { number: quote.number })}
          pending={remove.isPending}
          error={error}
          onConfirm={() => void confirmDelete()}
          onCancel={close}
        />
      )}
    </>
  )
}
```

Create `apps/web/src/pages/quote-editor/QuoteDetailsSheet.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { FormSheet } from '@/components/FormSheet'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import {
  useSetMarkupOverride,
  useUpdateQuote,
  type Quote,
  type QuoteValues,
} from '@/data/quotes'
import { shopToday } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import {
  formMarkup,
  formToQuote,
  quoteSchema,
  quoteToForm,
  type QuoteForm,
} from '../quotes/quote-form'
import { QuoteFields } from '../quotes/QuoteFields'

/** Edit details of a draft. Saves only the fields that changed; a new markup reprices through automatic pricing. */
export function QuoteDetailsSheet({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const { locale } = useFormat()
  const update = useUpdateQuote()
  const setMarkup = useSetMarkupOverride()
  const [today] = useState(shopToday)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<QuoteForm>({
    resolver: zodResolver(quoteSchema(today)),
    defaultValues: quoteToForm(quote, locale),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    const next = formToQuote(values)
    const changed: Partial<QuoteValues> = {}
    if (next.client_id !== quote.client_id) changed.client_id = next.client_id
    if (next.valid_until !== quote.valid_until) changed.valid_until = next.valid_until
    if (next.notes !== quote.notes) changed.notes = next.notes
    const markup = formMarkup(values)
    try {
      if (Object.keys(changed).length > 0) await update.mutateAsync({ id: quote.id, values: changed })
      if (isOwner && markup !== quote.markup_override_pct) {
        await setMarkup.mutateAsync({ quoteId: quote.id, pct: markup })
      }
      onClose()
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <FormSheet
      title={t('quotes.editor.detailsTitle')}
      dirty={form.formState.isDirty}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <QuoteFields form={form} idPrefix="quote-details" showMarkup={isOwner} />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {t(formError)}
          </p>
        )}
        <Button
          type="submit"
          disabled={!form.formState.isDirty || update.isPending || setMarkup.isPending}
        >
          {t('common.save')}
        </Button>
      </form>
    </FormSheet>
  )
}
```

Create `apps/web/src/pages/quote-editor/QuoteHeader.tsx`:

```tsx
import { Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import type { Quote } from '@/data/quotes'
import { useSettings } from '@/data/settings'
import { useFormat } from '@/lib/use-format'
import { clientLabel } from '../quotes/labels'
import { QuoteStatusBadge } from '../quotes/QuoteStatusBadge'
import { QuoteDetailsSheet } from './QuoteDetailsSheet'

function Detail({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function QuoteHeader({ quote, actions }: { quote: Quote; actions: ReactNode }) {
  const { t } = useTranslation()
  const format = useFormat()
  const settings = useSettings()
  const [editing, setEditing] = useState(false)

  const markup =
    quote.markup_override_pct !== null
      ? t('quotes.editor.markupOverride', { pct: format.number(quote.markup_override_pct) })
      : settings.data
        ? t('quotes.editor.markupDefault', {
            pct: format.number(settings.data.default_markup_pct),
          })
        : '—'

  return (
    <div className="grid gap-4">
      <PageHeader title={quote.number} actions={actions} />
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t('quotes.columns.status')}>
          <QuoteStatusBadge status={quote.status} />
        </Detail>
        <Detail label={t('quotes.editor.client')}>
          <Link to={`/clients/${quote.client.id}`} className="underline-offset-4 hover:underline">
            {clientLabel(quote.client)}
          </Link>
        </Detail>
        <Detail label={t('quotes.columns.created')}>
          {t('quotes.editor.createdBy', {
            name: quote.creator.display_name,
            date: format.date(quote.created_at),
          })}
        </Detail>
        <Detail label={t('quotes.columns.validUntil')}>{format.date(quote.valid_until)}</Detail>
        <Detail label={t('quotes.editor.markup')}>{markup}</Detail>
        <Detail label={t('quotes.form.notes')} wide>
          <span className="whitespace-pre-wrap">{quote.notes ?? '—'}</span>
        </Detail>
      </dl>
      {quote.status === 'draft' && (
        <div>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t('quotes.editor.editDetails')}
          </Button>
        </div>
      )}
      {editing && <QuoteDetailsSheet quote={quote} onClose={() => setEditing(false)} />}
    </div>
  )
}
```

`PageHeader` puts its actions in a `flex gap-2` row; change that container in `apps/web/src/components/PageHeader.tsx`
to `flex flex-wrap gap-2` so the editor's buttons wrap on tablets.

- [ ] **Step 6: The page and its route**

Create `apps/web/src/pages/QuoteEditorPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { QueryError } from '@/components/QueryError'
import { useQuoteItems } from '@/data/quote-items'
import { useQuote, type Quote } from '@/data/quotes'
import { NotFoundMessage } from './NotFoundPage'
import { QuoteActions } from './quote-editor/QuoteActions'
import { QuoteHeader } from './quote-editor/QuoteHeader'

export function QuoteEditorPage() {
  const { t } = useTranslation()
  const { id: rawId } = useParams()
  const id = Number(rawId)
  const valid = Number.isInteger(id) && id > 0
  const quote = useQuote(valid ? id : null)

  if (!valid) return <NotFoundMessage />
  if (quote.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  if (quote.isError && quote.data === undefined) {
    return <QueryError error={quote.error} onRetry={() => void quote.refetch()} />
  }
  if (!quote.data) return <NotFoundMessage />
  return (
    <>
      {quote.isError && <QueryError error={quote.error} onRetry={() => void quote.refetch()} />}
      <QuoteEditor key={quote.data.id} quote={quote.data} />
    </>
  )
}

function QuoteEditor({ quote }: { quote: Quote }) {
  const { t } = useTranslation()
  const items = useQuoteItems(quote.id)
  const itemList = items.data ?? []

  return (
    <section className="grid gap-6">
      <QuoteHeader quote={quote} actions={<QuoteActions quote={quote} items={itemList} />} />
      <section aria-labelledby="quote-items-title" className="grid gap-4">
        <h2 id="quote-items-title" className="text-lg font-semibold">
          {t('quotes.editor.items')}
        </h2>
        {items.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : items.isError && items.data === undefined ? (
          <QueryError error={items.error} onRetry={() => void items.refetch()} />
        ) : (
          <ul className="grid gap-4">
            {itemList.map((item) => (
              <li key={item.id}>{item.description}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
```

In `apps/web/src/app/routes.tsx`, import `QuoteEditorPage` and add after the `quotes/new` route:

```tsx
          { path: 'quotes/:id', element: <QuoteEditorPage /> },
```

- [ ] **Step 7: Add the texts**

Merge into `it.json` under `quotes`:

```json
"editor": {
  "client": "Cliente",
  "createdBy": "Creato da {{name}} il {{date}}",
  "markup": "Ricarico",
  "markupDefault": "{{pct}} % (predefinito)",
  "markupOverride": "{{pct}} % (personalizzato)",
  "editDetails": "Modifica dati",
  "detailsTitle": "Dati del preventivo",
  "markSent": "Segna come inviato",
  "markAccepted": "Segna come accettato",
  "markRejected": "Segna come rifiutato",
  "duplicate": "Duplica",
  "duplicated": "Copia creata.",
  "waitSlicing": "Attendi la fine dello slicing.",
  "items": "Articoli",
  "send": {
    "title": "Segnare {{number}} come inviato?",
    "body": "I prezzi verranno bloccati e il preventivo non sarà più modificabile.",
    "checking": "Controllo in corso…",
    "blockedTitle": "{{number}} non può ancora essere inviato",
    "blockedBody": "Prima sistema questi punti:"
  },
  "blockers": {
    "not_draft": "Il preventivo non è più una bozza.",
    "no_items": "Il preventivo non ha articoli.",
    "valid_until_past": "La data di validità è passata.",
    "missing_printer_or_material": "{{item}}: scegli stampante e materiale.",
    "not_sliced": "{{item}}: lo slicing non è completato.",
    "not_priced": "{{item}}: il prezzo non è calcolato.",
    "does_not_fit": "{{item}}: non entra in {{printer}}."
  },
  "acceptTitle": "Segnare {{number}} come accettato?",
  "rejectTitle": "Segnare {{number}} come rifiutato?",
  "outcomeBody": "Lo stato non potrà più essere cambiato.",
  "deleteTitle": "Eliminare {{number}}?"
}
```

and into `en.json` under `quotes`:

```json
"editor": {
  "client": "Client",
  "createdBy": "Created by {{name}} on {{date}}",
  "markup": "Markup",
  "markupDefault": "{{pct}} % (default)",
  "markupOverride": "{{pct}} % (override)",
  "editDetails": "Edit details",
  "detailsTitle": "Quote details",
  "markSent": "Mark as sent",
  "markAccepted": "Mark accepted",
  "markRejected": "Mark rejected",
  "duplicate": "Duplicate",
  "duplicated": "Copy created.",
  "waitSlicing": "Wait for slicing to finish.",
  "items": "Items",
  "send": {
    "title": "Mark {{number}} as sent?",
    "body": "Prices will be frozen and the quote can no longer be changed.",
    "checking": "Checking…",
    "blockedTitle": "{{number}} can't be sent yet",
    "blockedBody": "Fix these first:"
  },
  "blockers": {
    "not_draft": "The quote is no longer a draft.",
    "no_items": "The quote has no items.",
    "valid_until_past": "The valid-until date has passed.",
    "missing_printer_or_material": "{{item}}: choose printer and material.",
    "not_sliced": "{{item}}: slicing hasn't finished.",
    "not_priced": "{{item}}: price not calculated.",
    "does_not_fit": "{{item}}: doesn't fit on {{printer}}."
  },
  "acceptTitle": "Mark {{number}} as accepted?",
  "rejectTitle": "Mark {{number}} as rejected?",
  "outcomeBody": "The status can't be changed afterwards.",
  "deleteTitle": "Delete {{number}}?"
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/pages src/test`
Expected: PASS. `NewQuoteSheet.test.tsx` now lands on a real editor for the created quote (the fake fills its
defaults and embeds the seeded client).

- [ ] **Step 9: Format, lint, build, run everything and commit**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

```bash
git add apps/web/src
git commit -m "feat(web): quote editor header, Edit details and the send, accept, reject, duplicate and delete actions"
```

---

### Task 7: Item cards — settings, slicing state, price and override

**Files:**
- Modify: `apps/web/src/data/quote-items.ts`
- Modify: `apps/web/src/pages/quotes/labels.ts`
- Create: `apps/web/src/pages/quote-editor/InlineField.tsx`, `ItemSettings.tsx`, `SlicingStatus.tsx`,
  `ItemPrice.tsx`, `OverrideDialog.tsx`, `ItemCard.tsx`
- Modify: `apps/web/src/pages/QuoteEditorPage.tsx`
- Create: `apps/web/src/pages/quote-editor/QuoteItems.test.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `en.json`

**Interfaces:**
- Consumes:
  - Task 6: `QuoteItem`, `useQuoteItems`; the fixtures `quoteItemRow` and `jobRow`;
  - Task 3: `slicingState`, `fitsPrinter`, `useNow`, `formatDuration`, `formatElapsed`;
  - catalog: `usePrinters`, `useMaterials`, `type Material`.
- Produces in `data/quote-items.ts`:
  - `type SliceSettings = { printer_id: number | null; material_id: number | null; layer_height_mm: number;
    infill_percent: number; supports: boolean }`;
  - `useUpdateItemSettings()` (`{ item, change: Partial<SliceSettings> }`; sends all five values);
  - `useUpdateItem()` (`{ item, values: { description?: string; quantity?: number } }`);
  - `useRemoveItem()` (`mutateAsync(item)`);
  - `useRetrySlicing()` (`mutate(item)`);
  - `useSetPriceOverride()` (`{ item, total, reason }`), `useClearPriceOverride()` (`mutate(item)`);
  - `useModelDownload()` (`mutateAsync(path): Promise<string>`, a 60-second signed URL);
  - every item mutation reloads the quote when it fails with `notDraft`.
- Produces:
  - `InlineField({ id, label, value, validate, onSave, disabled?, inputMode?, revertOnError? })`;
  - `ItemCard({ item, editable, notCalculated })`. Task 9 passes the real `notCalculated`; this task passes `false`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/quote-editor/QuoteItems.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Tables } from '@/lib/database.types'
import type { Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  jobRow,
  materialRow,
  operatorStaff,
  printerRow,
  quoteItemRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderItems(items: Row[], opts: { status?: string; staff?: Tables<'staff'> } = {}) {
  return renderApp('/quotes/7', {
    session,
    staff: opts.staff,
    tables: {
      quotes: [quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status: opts.status ?? 'draft' })],
      clients: [clientRow({ id: 1 })],
      quote_items: items,
      printers: [
        printerRow({ id: 11, name: 'MK4 #1' }),
        printerRow({ id: 12, name: 'MK3 #9', active: false }),
      ],
      materials: [
        materialRow({ id: 21, name: 'Prusament PLA', type: 'PLA', color: 'Black' }),
        materialRow({ id: 22, name: 'Prusament PETG', type: 'PETG', color: 'Galaxy' }),
      ],
    },
    rpc: {
      update_quote_item_settings: () => null,
      retry_slicing: () => 99,
      set_price_override: () => null,
      clear_price_override: () => null,
    },
  })
}

const sliced = { printer_id: 11, material_id: 21 }

async function card(name = 'Staffa') {
  return screen.findByRole('article', { name })
}

test('a select change saves all five slicing inputs', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  await within(item).findByRole('option', { name: 'Prusament PETG (PETG, Galaxy)' })
  await user.selectOptions(within(item).getByLabelText('Materiale'), 'Prusament PETG (PETG, Galaxy)')
  await waitFor(() =>
    expect(db.rpcCalls('update_quote_item_settings')).toEqual([
      {
        item_id: 31,
        printer_id: 11,
        material_id: 22,
        layer_height_mm: 0.2,
        infill_percent: 20,
        supports: false,
      },
    ]),
  )
})

test('keeps an inactive printer selected and sends it with other changes', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, printer_id: 12, material_id: 21 })])
  const item = await card()
  await within(item).findByRole('option', { name: 'MK3 #9 (disattivata)' })
  expect(within(item).getByLabelText('Stampante')).toHaveValue('12')
  await user.click(within(item).getByRole('switch', { name: 'Supporti' }))
  await waitFor(() =>
    expect(db.rpcCalls('update_quote_item_settings')).toEqual([
      {
        item_id: 31,
        printer_id: 12,
        material_id: 21,
        layer_height_mm: 0.2,
        infill_percent: 20,
        supports: true,
      },
    ]),
  )
})

test('Enter then blur saves the layer height once', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  const input = within(item).getByLabelText('Altezza layer (mm)')
  expect(input).toHaveValue('0,20')
  await user.clear(input)
  await user.type(input, '0,15{Enter}')
  await user.tab()
  await waitFor(() => expect(db.rpcCalls('update_quote_item_settings')).toHaveLength(1))
  expect(db.rpcCalls('update_quote_item_settings')[0]).toMatchObject({ layer_height_mm: 0.15 })
})

test('an invalid number shows its error and is not saved', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  const infill = within(item).getByLabelText('Riempimento (%)')
  await user.clear(infill)
  await user.type(infill, '150')
  await user.tab()
  expect(await within(item).findByText('Deve essere tra 0 e 100.')).toBeInTheDocument()
  expect(db.rpcCalls('update_quote_item_settings')).toEqual([])
})

test('quantity and description save to the item; a blank description comes back', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  const quantity = within(item).getByLabelText('Quantità')
  await user.clear(quantity)
  await user.type(quantity, '3')
  await user.tab()
  await waitFor(() =>
    expect(db.calls('quote_items')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 31]],
      values: { quantity: 3 },
    }),
  )

  const description = within(item).getByLabelText('Descrizione')
  await user.clear(description)
  await user.tab()
  expect(await within(item).findByText('Campo obbligatorio.')).toBeInTheDocument()
  expect(description).toHaveValue('Staffa')

  await user.clear(description)
  await user.type(description, 'Staffa grande{Enter}')
  await waitFor(() =>
    expect(db.calls('quote_items')).toContainEqual({
      op: 'update',
      filters: [['eq', 'id', 31]],
      values: { description: 'Staffa grande' },
    }),
  )
})

test('shows each slicing state', async () => {
  const { db, user } = renderItems([
    quoteItemRow({ id: 41, description: 'Attesa' }),
    quoteItemRow({ id: 42, description: 'Coda', ...sliced, job: jobRow() }),
    quoteItemRow({
      id: 43,
      description: 'Lento',
      ...sliced,
      job: jobRow({ queued_at: '2026-10-13T09:45:00Z' }),
    }),
    quoteItemRow({
      id: 44,
      description: 'In corso',
      ...sliced,
      job: jobRow({ status: 'running', started_at: '2026-10-13T09:58:55Z' }),
    }),
    quoteItemRow({
      id: 45,
      description: 'Fatto',
      ...sliced,
      print_time_s: 19800,
      filament_g: 120,
      bbox_x_mm: 100,
      bbox_y_mm: 80,
      bbox_z_mm: 40,
      job: jobRow({ status: 'succeeded' }),
    }),
    quoteItemRow({
      id: 46,
      description: 'Fallito',
      ...sliced,
      job: jobRow({ status: 'failed', error: 'Model is not manifold' }),
    }),
  ])
  expect(within(await card('Attesa')).getByText('Scegli stampante e materiale')).toBeInTheDocument()
  expect(within(await card('Coda')).getByText('In attesa dello slicing')).toBeInTheDocument()
  expect(
    within(await card('Lento')).getByText('Lo slicing sta richiedendo più del solito'),
  ).toBeInTheDocument()
  expect(within(await card('In corso')).getByText('Slicing in corso… 1:05')).toBeInTheDocument()
  const done = await card('Fatto')
  expect(within(done).getByText('5:30')).toBeInTheDocument()
  expect(within(done).getByText('120 g')).toBeInTheDocument()
  expect(within(done).getByText('100 × 80 × 40 mm')).toBeInTheDocument()
  const failed = await card('Fallito')
  expect(within(failed).getByText('Slicing non riuscito')).toBeInTheDocument()
  expect(within(failed).getByText('Model is not manifold')).toBeInTheDocument()
  await user.click(within(failed).getByRole('button', { name: 'Riprova lo slicing' }))
  await waitFor(() => expect(db.rpcCalls('retry_slicing')).toEqual([{ item_id: 46 }]))
})

test('warns when the model does not fit the printer', async () => {
  renderItems([
    quoteItemRow({
      id: 31,
      ...sliced,
      print_time_s: 100,
      bbox_x_mm: 300,
      bbox_y_mm: 10,
      bbox_z_mm: 10,
      job: jobRow({ status: 'succeeded' }),
    }),
  ])
  expect(await within(await card()).findByText('Non entra in MK4 #1')).toBeInTheDocument()
})

const priced = {
  ...sliced,
  quantity: 2,
  print_time_s: 19800,
  filament_g: 120,
  material_cost: 3,
  machine_cost: 8.25,
  energy_cost: 0.198,
  failure_cost: 1.1448,
  setup_fee: 5,
  markup_amount: 9.0557,
  markup_pct: 30,
  computed_total: 39.24,
  item_total: 39.24,
  priced_at: '2026-10-13T09:00:00Z',
  job: jobRow({ status: 'succeeded' }),
}

test('shows the price and its breakdown', async () => {
  const { user } = renderItems([quoteItemRow({ id: 31, ...priced })])
  const item = await card()
  expect(within(item).getAllByText('39,24 €').length).toBeGreaterThan(0)
  expect(within(item).getByText('19,62 €')).toBeInTheDocument()
  await user.click(within(item).getByText('Dettaglio prezzo'))
  expect(within(item).getByText('Ricarico (30 %)')).toBeInTheDocument()
  expect(within(item).getByText('9,06 €')).toBeInTheDocument()
  expect(within(item).getByText('Margine per stampe fallite')).toBeInTheDocument()
  expect(within(item).getByText('1,14 €')).toBeInTheDocument()
})

test('owners override a price with a reason', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...priced })])
  await user.click(within(await card()).getByRole('button', { name: 'Modifica prezzo' }))
  const dialog = await screen.findByRole('dialog', { name: 'Modifica il prezzo di Staffa' })
  const total = within(dialog).getByLabelText('Totale articolo')
  expect(total).toHaveValue('39,24')
  await user.clear(total)
  await user.type(total, '45')
  await user.type(within(dialog).getByLabelText('Motivo'), 'Accordo con il cliente')
  await user.click(within(dialog).getByRole('button', { name: 'Salva' }))
  await waitFor(() =>
    expect(db.rpcCalls('set_price_override')).toEqual([
      { item_id: 31, total: 45, reason: 'Accordo con il cliente' },
    ]),
  )
})

const overridden = {
  ...priced,
  override_total: 45,
  override_reason: 'Accordo',
  item_total: 45,
}

test('an override shows beside the computed price and owners can remove it', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...overridden })])
  const item = await card()
  expect(
    within(item).getByText('Prezzo modificato: 45,00 € (calcolato 39,24 €)'),
  ).toBeInTheDocument()
  expect(within(item).getByText('Motivo: Accordo')).toBeInTheDocument()
  await user.click(within(item).getByRole('button', { name: 'Ripristina prezzo calcolato' }))
  await waitFor(() => expect(db.rpcCalls('clear_price_override')).toEqual([{ item_id: 31 }]))
})

test('operators see an override but cannot change prices', async () => {
  renderItems([quoteItemRow({ id: 31, ...overridden })], { staff: operatorStaff })
  const item = await card()
  expect(within(item).getByText('Motivo: Accordo')).toBeInTheDocument()
  expect(within(item).queryByRole('button', { name: 'Modifica prezzo' })).not.toBeInTheDocument()
  expect(
    within(item).queryByRole('button', { name: 'Ripristina prezzo calcolato' }),
  ).not.toBeInTheDocument()
})

test('removing an item deletes it and its file', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  await user.click(within(await card()).getByRole('button', { name: 'Rimuovi' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Rimuovere Staffa?' })
  await user.click(within(dialog).getByRole('button', { name: 'Elimina' }))
  await waitFor(() =>
    expect(db.calls('quote_items')).toContainEqual({ op: 'delete', filters: [['eq', 'id', 31]] }),
  )
  await waitFor(() =>
    expect(db.storageCalls('models')).toContainEqual({ op: 'remove', paths: ['7/u31/staffa.stl'] }),
  )
})

test('an edit on a quote that has left draft turns the page read-only', async () => {
  const { db, user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  const item = await card()
  // Someone else sent the quote meanwhile.
  db.table('quotes')[0].status = 'sent'
  db.failNext('update_quote_item_settings', { code: 'P0001', message: 'quote_not_draft' })
  await user.click(within(item).getByRole('switch', { name: 'Supporti' }))
  expect(
    await screen.findByText('Il preventivo non è più una bozza e non si può modificare.'),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(within(item).queryByRole('switch', { name: 'Supporti' })).not.toBeInTheDocument(),
  )
  expect(screen.getByText('Inviato')).toBeInTheDocument()
})

test('a sent quote shows its items read-only', async () => {
  renderItems([quoteItemRow({ id: 31, ...priced })], { status: 'sent' })
  const item = await card()
  expect(await within(item).findByText('MK4 #1')).toBeInTheDocument()
  expect(within(item).getByText('Prusament PLA (PLA, Black)')).toBeInTheDocument()
  expect(within(item).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(item).queryByRole('combobox')).not.toBeInTheDocument()
  expect(within(item).queryByRole('switch')).not.toBeInTheDocument()
  expect(within(item).queryByRole('button', { name: 'Rimuovi' })).not.toBeInTheDocument()
})

test('Download opens a signed link', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const { user } = renderItems([quoteItemRow({ id: 31, ...sliced })])
  await user.click(within(await card()).getByRole('button', { name: 'Scarica staffa.stl' }))
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      'https://storage.test/models/7/u31/staffa.stl',
      '_blank',
      'noopener',
    ),
  )
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/quote-editor/QuoteItems.test.tsx`
Expected: FAIL. The editor lists only descriptions, with no `article` cards.

- [ ] **Step 3: Add the item mutations**

In `apps/web/src/data/quote-items.ts`, change the imports to

```ts
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Tables } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { AppError, toAppError } from './errors'
import { queryKeys } from './query-keys'
import type { ItemJob } from './quote-rules'
```

and append:

```ts
export type SliceSettings = {
  printer_id: number | null
  material_id: number | null
  layer_height_mm: number
  infill_percent: number
  supports: boolean
}

/** An item change can move the quote's total, so the list refreshes too. */
function refreshItems(queryClient: QueryClient, quoteId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
  ])
}

/** Every edit fails once the quote has left draft; reloading the quote turns the editor read-only. */
function refreshIfNotDraft(queryClient: QueryClient, error: unknown, quoteId: number) {
  if (error instanceof AppError && error.kind === 'notDraft') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) })
  }
}

/**
 * Sends all five slicing inputs: the item's current values with `change` applied. Any difference clears the
 * results and queues a new slice; no difference does nothing.
 */
export function useUpdateItemSettings() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ item, change }: { item: QuoteItem; change: Partial<SliceSettings> }) => {
      const next: SliceSettings = {
        printer_id: item.printer_id,
        material_id: item.material_id,
        layer_height_mm: item.layer_height_mm,
        infill_percent: item.infill_percent,
        supports: item.supports,
        ...change,
      }
      // Printer and material may still be null; the generated Args type says number.
      const { error } = await supabase.rpc('update_quote_item_settings', {
        item_id: item.id,
        printer_id: next.printer_id as number,
        material_id: next.material_id as number,
        layer_height_mm: next.layer_height_mm,
        infill_percent: next.infill_percent,
        supports: next.supports,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, { item }) => refreshItems(queryClient, item.quote_id),
    onError: (error, { item }) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** Description or quantity. RLS hides items of quotes that left draft, so no row back means exactly that. */
export function useUpdateItem() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      item,
      values,
    }: {
      item: QuoteItem
      values: { description?: string; quantity?: number }
    }) => {
      const { data, error } = await supabase
        .from('quote_items')
        .update(values)
        .eq('id', item.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
    },
    onSuccess: (_data, { item }) => refreshItems(queryClient, item.quote_id),
    onError: (error, { item }) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** Deletes the item, then its file on a best-effort basis (a leftover is an orphan for the cleanup job). */
export function useRemoveItem() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: QuoteItem) => {
      const { data, error } = await supabase
        .from('quote_items')
        .delete()
        .eq('id', item.id)
        .select('id')
      if (error) throw toAppError(error)
      if (data.length === 0) throw new AppError('notDraft')
      await supabase.storage.from('models').remove([item.model_path])
    },
    onSuccess: (_data, item) => refreshItems(queryClient, item.quote_id),
    onError: (error, item) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

export function useRetrySlicing() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: QuoteItem) => {
      const { error } = await supabase.rpc('retry_slicing', { item_id: item.id })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, item) => refreshItems(queryClient, item.quote_id),
    onError: (error, item) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** Owner only: sets the item total by hand; the computed breakdown is kept. */
export function useSetPriceOverride() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ item, total, reason }: { item: QuoteItem; total: number; reason: string }) => {
      const { error } = await supabase.rpc('set_price_override', {
        item_id: item.id,
        total,
        reason,
      })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, { item }) => refreshItems(queryClient, item.quote_id),
    onError: (error, { item }) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

export function useClearPriceOverride() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: QuoteItem) => {
      const { error } = await supabase.rpc('clear_price_override', { item_id: item.id })
      if (error) throw toAppError(error)
    },
    onSuccess: (_data, item) => refreshItems(queryClient, item.quote_id),
    onError: (error, item) => refreshIfNotDraft(queryClient, error, item.quote_id),
  })
}

/** A download link for a model file, valid for 60 seconds. */
export function useModelDownload() {
  const supabase = useSupabase()
  return useMutation({
    mutationFn: async (path: string): Promise<string> => {
      const { data, error } = await supabase.storage.from('models').createSignedUrl(path, 60)
      if (error) throw toAppError(error)
      return data.signedUrl
    },
  })
}
```

- [ ] **Step 4: The inline field**

Create `apps/web/src/pages/quote-editor/InlineField.tsx`:

```tsx
import { useState } from 'react'
import { FormField } from '@/components/FormField'
import { Input } from '@/components/ui/input'
import { toAppError } from '@/data/errors'

/**
 * A text field that saves on blur or Enter when the text changed; Escape puts the saved value back. While the user
 * isn't editing it shows `value`, so a refetch updates it. `validate` returns an i18n key or null.
 */
export function InlineField({
  id,
  label,
  value,
  validate,
  onSave,
  disabled,
  inputMode,
  revertOnError = false,
}: {
  id: string
  label: string
  value: string
  validate: (text: string) => string | null
  onSave: (text: string) => Promise<unknown>
  disabled?: boolean
  inputMode?: 'decimal' | 'numeric' | 'text'
  revertOnError?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function commit() {
    // Enter commits and clears the draft, so the blur that follows finds nothing to save.
    if (draft === null) return
    const problem = validate(draft)
    if (problem) {
      setError(problem)
      if (revertOnError) setDraft(null)
      return
    }
    setError(null)
    setDraft(null)
    if (draft.trim() === value.trim()) return
    try {
      await onSave(draft)
    } catch (caught) {
      setError(toAppError(caught).messageKey)
    }
  }

  return (
    <FormField id={id} label={label} error={error ?? undefined}>
      <Input
        id={id}
        value={draft ?? value}
        inputMode={inputMode}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void commit()
          } else if (event.key === 'Escape') {
            setDraft(null)
            setError(null)
          }
        }}
      />
    </FormField>
  )
}
```

- [ ] **Step 5: Settings, slicing status, price and override**

Add to `apps/web/src/pages/quotes/labels.ts` (with the imports `import type { TFunction } from 'i18next'` and
`import type { Material } from '@/data/materials'`):

```ts
/** "Prusament PLA (PLA, Black)". */
export function materialLabel(material: Material, t: TFunction) {
  const type = material.type === 'other' ? t('materials.types.other') : material.type
  return `${material.name} (${[type, material.color].filter(Boolean).join(', ')})`
}
```

Create `apps/web/src/pages/quote-editor/ItemSettings.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ZodType } from 'zod'
import { FormField } from '@/components/FormField'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import { useMaterials } from '@/data/materials'
import { usePrinters } from '@/data/printers'
import {
  useUpdateItem,
  useUpdateItemSettings,
  type QuoteItem,
  type SliceSettings,
} from '@/data/quote-items'
import { toInputNumber } from '@/lib/format'
import { numberField, parseDecimal } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'
import { materialLabel } from '../quotes/labels'
import { InlineField } from './InlineField'

// The database's limits: layer_height_mm numeric(3,2) > 0, infill 0..100, quantity > 0.
const LAYER_HEIGHT = numberField({ gt: 0, max: 9.99, decimals: 2, rangeError: 'validation.layerHeight' })
const INFILL = numberField({ min: 0, max: 100, decimals: 0, rangeError: 'validation.percent' })
const QUANTITY = numberField({ min: 1, max: 2147483647, decimals: 0, rangeError: 'validation.quantity' })

function check(schema: ZodType) {
  return (text: string) => {
    const result = schema.safeParse(text)
    return result.success ? null : (result.error.issues[0]?.message ?? 'validation.number')
  }
}

function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** Printer, material, quantity, layer height, infill and supports; each saves as soon as it changes. */
export function ItemSettings({ item, editable }: { item: QuoteItem; editable: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const printers = usePrinters()
  const materials = useMaterials()
  const settings = useUpdateItemSettings()
  const update = useUpdateItem()
  const busy = settings.isPending || update.isPending
  const printer = printers.data?.find((p) => p.id === item.printer_id)
  const material = materials.data?.find((m) => m.id === item.material_id)

  if (!editable) {
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <ReadOnly label={t('quotes.item.printer')}>{printer?.name ?? '—'}</ReadOnly>
        <ReadOnly label={t('quotes.item.material')}>
          {material ? materialLabel(material, t) : '—'}
        </ReadOnly>
        <ReadOnly label={t('quotes.item.quantity')}>{format.number(item.quantity)}</ReadOnly>
        <ReadOnly label={t('quotes.item.layerHeight')}>
          {format.number(item.layer_height_mm, 2)}
        </ReadOnly>
        <ReadOnly label={t('quotes.item.infill')}>{format.number(item.infill_percent)}</ReadOnly>
        <ReadOnly label={t('quotes.item.supports')}>
          {t(item.supports ? 'common.yes' : 'common.no')}
        </ReadOnly>
      </dl>
    )
  }

  const save = (change: Partial<SliceSettings>) => settings.mutateAsync({ item, change })
  const saveNow = (change: Partial<SliceSettings>) => {
    save(change).catch((caught: unknown) => toast.error(t(toAppError(caught).messageKey)))
  }
  // Show a change being saved at once, instead of the old value until the refetch lands.
  const current = {
    printer_id: item.printer_id,
    material_id: item.material_id,
    supports: item.supports,
    ...(settings.isPending ? settings.variables?.change : undefined),
  }
  // Deactivated choices stay listed for the item that already uses them, so the select shows the truth.
  const printerOptions = (printers.data ?? []).filter((p) => p.active || p.id === item.printer_id)
  const materialOptions = (materials.data ?? []).filter((m) => m.active || m.id === item.material_id)
  const id = `item-${item.id}`

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id={`${id}-printer`} label={t('quotes.item.printer')}>
        <NativeSelect
          id={`${id}-printer`}
          className="w-full"
          value={current.printer_id === null ? '' : String(current.printer_id)}
          disabled={busy}
          onChange={(event) =>
            saveNow({ printer_id: event.target.value ? Number(event.target.value) : null })
          }
        >
          <NativeSelectOption value="">{t('quotes.item.choose')}</NativeSelectOption>
          {printerOptions.map((p) => (
            <NativeSelectOption key={p.id} value={String(p.id)}>
              {p.active ? p.name : t('quotes.item.inactivePrinter', { name: p.name })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id={`${id}-material`} label={t('quotes.item.material')}>
        <NativeSelect
          id={`${id}-material`}
          className="w-full"
          value={current.material_id === null ? '' : String(current.material_id)}
          disabled={busy}
          onChange={(event) =>
            saveNow({ material_id: event.target.value ? Number(event.target.value) : null })
          }
        >
          <NativeSelectOption value="">{t('quotes.item.choose')}</NativeSelectOption>
          {materialOptions.map((m) => (
            <NativeSelectOption key={m.id} value={String(m.id)}>
              {m.active
                ? materialLabel(m, t)
                : t('quotes.item.inactiveMaterial', { name: materialLabel(m, t) })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <InlineField
        id={`${id}-quantity`}
        label={t('quotes.item.quantity')}
        value={String(item.quantity)}
        inputMode="numeric"
        disabled={busy}
        validate={check(QUANTITY)}
        onSave={async (text) => {
          const quantity = Number(text.trim())
          if (quantity !== item.quantity) await update.mutateAsync({ item, values: { quantity } })
        }}
      />
      <InlineField
        id={`${id}-layer-height`}
        label={t('quotes.item.layerHeight')}
        value={toInputNumber(item.layer_height_mm, format.locale, 2)}
        inputMode="decimal"
        disabled={busy}
        validate={check(LAYER_HEIGHT)}
        onSave={async (text) => {
          const layerHeight = parseDecimal(text) as number
          if (layerHeight !== item.layer_height_mm) await save({ layer_height_mm: layerHeight })
        }}
      />
      <InlineField
        id={`${id}-infill`}
        label={t('quotes.item.infill')}
        value={String(item.infill_percent)}
        inputMode="numeric"
        disabled={busy}
        validate={check(INFILL)}
        onSave={async (text) => {
          const infill = Number(text.trim())
          if (infill !== item.infill_percent) await save({ infill_percent: infill })
        }}
      />
      <div className="flex items-center gap-2 self-end pb-2">
        <Switch
          id={`${id}-supports`}
          checked={current.supports}
          disabled={busy}
          onCheckedChange={(checked) => saveNow({ supports: checked })}
        />
        <Label htmlFor={`${id}-supports`}>{t('quotes.item.supports')}</Label>
      </div>
    </div>
  )
}
```

Create `apps/web/src/pages/quote-editor/SlicingStatus.tsx`:

```tsx
import { Clock, Loader2, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useRetrySlicing, type QuoteItem } from '@/data/quote-items'
import { slicingState } from '@/data/quote-rules'
import { formatDuration, formatElapsed } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { useNow } from '@/lib/use-now'

/** The item's slicing state and, once done, its results (functional analysis §7). */
export function SlicingStatus({ item, editable }: { item: QuoteItem; editable: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const retry = useRetrySlicing()
  const ticking = item.job?.status === 'queued' || item.job?.status === 'running'
  const now = useNow(ticking)
  const state = slicingState(item, now)

  switch (state.kind) {
    case 'waiting':
      return <p className="text-sm text-muted-foreground">{t('quotes.item.slicing.waiting')}</p>
    case 'queued':
    case 'slicing':
      return (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {state.kind === 'queued'
            ? t('quotes.item.slicing.queued')
            : t('quotes.item.slicing.slicing', { elapsed: formatElapsed(state.elapsedS) })}
        </p>
      )
    case 'slow':
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <Clock aria-hidden className="size-4" />
          {t('quotes.item.slicing.slow')}
        </p>
      )
    case 'failed':
      return (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-destructive">{t('quotes.item.slicing.failed')}</p>
          {state.error && <p className="text-sm">{state.error}</p>}
          {editable && (
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={retry.isPending}
                onClick={() =>
                  retry.mutate(item, {
                    onError: (caught) => toast.error(t(toAppError(caught).messageKey)),
                  })
                }
              >
                <RotateCw aria-hidden />
                {t('quotes.item.slicing.retry')}
              </Button>
            </div>
          )}
        </div>
      )
    case 'done':
      return (
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('quotes.item.results.printTime')}</dt>
            <dd>{formatDuration(item.print_time_s ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('quotes.item.results.filament')}</dt>
            <dd>{t('quotes.item.results.grams', { value: format.number(item.filament_g ?? 0) })}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('quotes.item.results.bbox')}</dt>
            <dd>
              {t('quotes.item.results.bboxValue', {
                x: format.number(item.bbox_x_mm ?? 0),
                y: format.number(item.bbox_y_mm ?? 0),
                z: format.number(item.bbox_z_mm ?? 0),
              })}
            </dd>
          </div>
        </dl>
      )
  }
}
```

Create `apps/web/src/pages/quote-editor/OverrideDialog.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toAppError } from '@/data/errors'
import { useSetPriceOverride, type QuoteItem } from '@/data/quote-items'
import { toInputNumber } from '@/lib/format'
import { numberField, parseDecimal, requiredText } from '@/lib/forms'
import { useFormat } from '@/lib/use-format'

const overrideSchema = z.object({
  total: numberField({ min: 0, decimals: 2, rangeError: 'validation.nonNegative' }),
  reason: requiredText(500),
})
type OverrideForm = z.infer<typeof overrideSchema>

/** Owner only: the item total by hand, with a reason staff can see. */
export function OverrideDialog({ item, onClose }: { item: QuoteItem; onClose: () => void }) {
  const { t } = useTranslation()
  const { locale } = useFormat()
  const setOverride = useSetPriceOverride()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OverrideForm>({
    resolver: zodResolver(overrideSchema),
    defaultValues: {
      total: toInputNumber(item.override_total ?? item.computed_total, locale, 2),
      reason: item.override_reason ?? '',
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await setOverride.mutateAsync({
        item,
        total: parseDecimal(values.total) as number,
        reason: values.reason.trim(),
      })
      onClose()
    } catch (error) {
      setFormError(toAppError(error).messageKey)
    }
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('quotes.item.overrideDialog.title', { name: item.description })}</DialogTitle>
          <DialogDescription>{t('quotes.item.overrideDialog.body')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField
            id="override-total"
            label={t('quotes.item.overrideDialog.total')}
            error={errors.total?.message}
          >
            <Input
              id="override-total"
              inputMode="decimal"
              aria-invalid={!!errors.total}
              {...register('total')}
            />
          </FormField>
          <FormField
            id="override-reason"
            label={t('quotes.item.overrideDialog.reason')}
            error={errors.reason?.message}
          >
            <Textarea id="override-reason" aria-invalid={!!errors.reason} {...register('reason')} />
          </FormField>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={setOverride.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

(If the generated `DialogContent` has no `showCloseButton` prop, add one the way `sheet.tsx` has it: a boolean
prop that skips rendering the built-in close button, whose label is untranslated English.)

Create `apps/web/src/pages/quote-editor/ItemPrice.tsx`:

```tsx
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useStaff } from '@/auth/staff-context'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { useClearPriceOverride, type QuoteItem } from '@/data/quote-items'
import { useFormat } from '@/lib/use-format'
import { OverrideDialog } from './OverrideDialog'

/** Item total and unit price, the stored breakdown, and the owner's override. */
export function ItemPrice({
  item,
  editable,
  notCalculated,
}: {
  item: QuoteItem
  editable: boolean
  notCalculated: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { isOwner } = useStaff()
  const clear = useClearPriceOverride()
  const [overriding, setOverriding] = useState(false)
  const canOverride = editable && isOwner

  const lines: [string, number | null][] = [
    [t('quotes.item.price.material'), item.material_cost],
    [t('quotes.item.price.machine'), item.machine_cost],
    [t('quotes.item.price.energy'), item.energy_cost],
    [t('quotes.item.price.failure'), item.failure_cost],
    [t('quotes.item.price.setupFee'), item.setup_fee],
    [t('quotes.item.price.markup', { pct: format.number(item.markup_pct ?? 0) }), item.markup_amount],
    [t('quotes.item.price.computed'), item.computed_total],
  ]

  return (
    <div className="grid gap-2">
      {item.item_total !== null ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-1">
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.item.price.total')}</dt>
            <dd className="text-lg font-semibold">{format.currency(item.item_total)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('quotes.item.price.unit')}</dt>
            <dd>{format.currency(item.item_total / item.quantity)}</dd>
          </div>
        </dl>
      ) : (
        item.print_time_s !== null && (
          <p className="text-sm text-muted-foreground">
            {t(notCalculated ? 'quotes.item.price.notCalculated' : 'quotes.item.price.calculating')}
          </p>
        )
      )}
      {item.override_total !== null && (
        <div className="text-sm">
          <p>
            {t('quotes.item.price.overridden', {
              total: format.currency(item.override_total),
              computed: item.computed_total === null ? '—' : format.currency(item.computed_total),
            })}
          </p>
          {item.override_reason && (
            <p className="text-muted-foreground">
              {t('quotes.item.price.reason', { reason: item.override_reason })}
            </p>
          )}
        </div>
      )}
      {item.computed_total !== null && (
        <details className="text-sm">
          <summary className="cursor-pointer">{t('quotes.item.price.breakdown')}</summary>
          <dl className="mt-2 grid max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {lines.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd className="text-right tabular-nums">{format.currency(value ?? 0)}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}
      {canOverride && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOverriding(true)}>
            {t('quotes.item.price.override')}
          </Button>
          {item.override_total !== null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate(item, {
                  onError: (caught) => toast.error(t(toAppError(caught).messageKey)),
                })
              }
            >
              {t('quotes.item.price.removeOverride')}
            </Button>
          )}
        </div>
      )}
      {overriding && <OverrideDialog item={item} onClose={() => setOverriding(false)} />}
    </div>
  )
}
```

- [ ] **Step 6: The card, and the editor uses it**

Create `apps/web/src/pages/quote-editor/ItemCard.tsx`:

```tsx
import { FileBox, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { Button } from '@/components/ui/button'
import { toAppError } from '@/data/errors'
import { usePrinters } from '@/data/printers'
import {
  useModelDownload,
  useRemoveItem,
  useUpdateItem,
  type QuoteItem,
} from '@/data/quote-items'
import { fitsPrinter } from '@/data/quote-rules'
import { InlineField } from './InlineField'
import { ItemPrice } from './ItemPrice'
import { ItemSettings } from './ItemSettings'
import { SlicingStatus } from './SlicingStatus'

/** One quote item. `editable` is true while the quote is a draft. */
export function ItemCard({
  item,
  editable,
  notCalculated,
}: {
  item: QuoteItem
  editable: boolean
  notCalculated: boolean
}) {
  const { t } = useTranslation()
  const printers = usePrinters()
  const update = useUpdateItem()
  const remove = useRemoveItem()
  const download = useModelDownload()
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const printer = printers.data?.find((p) => p.id === item.printer_id)
  const titleId = `item-${item.id}-title`

  async function openDownload() {
    try {
      const url = await download.mutateAsync(item.model_path)
      window.open(url, '_blank', 'noopener')
    } catch (caught) {
      toast.error(t(toAppError(caught).messageKey))
    }
  }

  async function confirmRemove() {
    setRemoveError(null)
    try {
      await remove.mutateAsync(item)
      setRemoving(false)
    } catch (caught) {
      setRemoveError(t(toAppError(caught).messageKey))
    }
  }

  return (
    <article aria-labelledby={titleId} className="grid gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h3 id={titleId} className={editable ? 'sr-only' : 'font-medium'}>
            {item.description}
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <FileBox aria-hidden className="size-4" />
            {item.original_filename}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={download.isPending}
              aria-label={t('quotes.item.download', { name: item.original_filename })}
              onClick={() => void openDownload()}
            >
              {t('quotes.item.downloadShort')}
            </Button>
          </p>
        </div>
        {editable && (
          <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}>
            <Trash2 aria-hidden />
            {t('quotes.item.remove')}
          </Button>
        )}
      </div>
      {editable && (
        <InlineField
          id={`item-${item.id}-description`}
          label={t('quotes.item.description')}
          value={item.description}
          disabled={update.isPending}
          revertOnError
          validate={(text) => (text.trim() ? null : 'validation.required')}
          onSave={(text) => update.mutateAsync({ item, values: { description: text.trim() } })}
        />
      )}
      <ItemSettings item={item} editable={editable} />
      <SlicingStatus item={item} editable={editable} />
      {printer && !fitsPrinter(item, printer) && (
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <TriangleAlert aria-hidden className="size-4" />
          {t('quotes.item.doesNotFit', { printer: printer.name })}
        </p>
      )}
      <ItemPrice item={item} editable={editable} notCalculated={notCalculated} />
      {removing && (
        <ConfirmDeleteDialog
          title={t('quotes.item.removeTitle', { name: item.description })}
          body={t('quotes.item.removeBody')}
          pending={remove.isPending}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onCancel={() => {
            setRemoving(false)
            setRemoveError(null)
          }}
        />
      )}
    </article>
  )
}
```

In `apps/web/src/pages/QuoteEditorPage.tsx`, import `ItemCard` from `./quote-editor/ItemCard` and replace the
`<ul>` of descriptions with:

```tsx
          <ul className="grid gap-4">
            {itemList.map((item) => (
              <li key={item.id}>
                <ItemCard
                  item={item}
                  editable={quote.status === 'draft'}
                  notCalculated={false}
                />
              </li>
            ))}
          </ul>
```

- [ ] **Step 7: Add the texts**

Merge into `it.json`:

```json
"validation": {
  "layerHeight": "Tra 0,01 e 9,99 mm.",
  "quantity": "Almeno 1."
},
"quotes": {
  "item": {
    "description": "Descrizione",
    "download": "Scarica {{name}}",
    "downloadShort": "Scarica",
    "remove": "Rimuovi",
    "removeTitle": "Rimuovere {{name}}?",
    "removeBody": "L'articolo e il suo file verranno eliminati.",
    "printer": "Stampante",
    "material": "Materiale",
    "choose": "Scegli…",
    "inactivePrinter": "{{name}} (disattivata)",
    "inactiveMaterial": "{{name}} (disattivato)",
    "quantity": "Quantità",
    "layerHeight": "Altezza layer (mm)",
    "infill": "Riempimento (%)",
    "supports": "Supporti",
    "doesNotFit": "Non entra in {{printer}}",
    "slicing": {
      "waiting": "Scegli stampante e materiale",
      "queued": "In attesa dello slicing",
      "slow": "Lo slicing sta richiedendo più del solito",
      "slicing": "Slicing in corso… {{elapsed}}",
      "failed": "Slicing non riuscito",
      "retry": "Riprova lo slicing"
    },
    "results": {
      "printTime": "Tempo di stampa per copia",
      "filament": "Filamento per copia",
      "grams": "{{value}} g",
      "bbox": "Ingombro",
      "bboxValue": "{{x}} × {{y}} × {{z}} mm"
    },
    "price": {
      "total": "Totale articolo",
      "unit": "Prezzo unitario",
      "calculating": "Calcolo del prezzo…",
      "notCalculated": "Prezzo non calcolato",
      "breakdown": "Dettaglio prezzo",
      "material": "Materiale",
      "machine": "Macchina",
      "energy": "Energia",
      "failure": "Margine per stampe fallite",
      "setupFee": "Costo di avvio",
      "markup": "Ricarico ({{pct}} %)",
      "computed": "Totale calcolato",
      "overridden": "Prezzo modificato: {{total}} (calcolato {{computed}})",
      "reason": "Motivo: {{reason}}",
      "override": "Modifica prezzo",
      "removeOverride": "Ripristina prezzo calcolato"
    },
    "overrideDialog": {
      "title": "Modifica il prezzo di {{name}}",
      "body": "Il prezzo calcolato resta visibile accanto a quello modificato.",
      "total": "Totale articolo",
      "reason": "Motivo"
    }
  }
}
```

and into `en.json`:

```json
"validation": {
  "layerHeight": "Between 0.01 and 9.99 mm.",
  "quantity": "At least 1."
},
"quotes": {
  "item": {
    "description": "Description",
    "download": "Download {{name}}",
    "downloadShort": "Download",
    "remove": "Remove",
    "removeTitle": "Remove {{name}}?",
    "removeBody": "The item and its file will be deleted.",
    "printer": "Printer",
    "material": "Material",
    "choose": "Choose…",
    "inactivePrinter": "{{name}} (inactive)",
    "inactiveMaterial": "{{name}} (inactive)",
    "quantity": "Quantity",
    "layerHeight": "Layer height (mm)",
    "infill": "Infill (%)",
    "supports": "Supports",
    "doesNotFit": "Doesn't fit on {{printer}}",
    "slicing": {
      "waiting": "Choose printer and material",
      "queued": "Waiting to slice",
      "slow": "Slicing is taking longer than usual",
      "slicing": "Slicing… {{elapsed}}",
      "failed": "Slicing failed",
      "retry": "Retry slicing"
    },
    "results": {
      "printTime": "Print time per copy",
      "filament": "Filament per copy",
      "grams": "{{value}} g",
      "bbox": "Bounding box",
      "bboxValue": "{{x}} × {{y}} × {{z}} mm"
    },
    "price": {
      "total": "Item total",
      "unit": "Unit price",
      "calculating": "Calculating price…",
      "notCalculated": "Price not calculated",
      "breakdown": "Price breakdown",
      "material": "Material",
      "machine": "Machine",
      "energy": "Energy",
      "failure": "Failure allowance",
      "setupFee": "Setup fee",
      "markup": "Markup ({{pct}} %)",
      "computed": "Computed total",
      "overridden": "Overridden: {{total}} (computed {{computed}})",
      "reason": "Reason: {{reason}}",
      "override": "Override price",
      "removeOverride": "Remove override"
    },
    "overrideDialog": {
      "title": "Override the price of {{name}}",
      "body": "The computed price stays visible beside the override.",
      "total": "Item total",
      "reason": "Reason"
    }
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/pages`
Expected: PASS.

- [ ] **Step 9: Format, lint, build, run everything and commit**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

```bash
git add apps/web/src
git commit -m "feat(web): item cards that save settings on change, show slicing state, price, breakdown and overrides"
```

---

### Task 8: Model uploads

**Files:**
- Modify: `apps/web/package.json` (add `tus-js-client`), `package-lock.json`
- Create (shadcn): `apps/web/src/components/ui/progress.tsx`
- Create: `apps/web/src/data/model-upload.ts`
- Modify: `apps/web/src/data/quote-items.ts`, `apps/web/src/data/quotes.ts`
- Modify: `apps/web/src/app/AppProviders.tsx`, `apps/web/src/app/App.tsx`
- Create: `apps/web/src/test/fake-uploader.ts`; modify `apps/web/src/test/render-app.tsx`
- Modify: `apps/web/src/components/use-leave-guard.tsx`, `apps/web/src/components/UnsavedChangesDialog.tsx`
- Create: `apps/web/src/pages/quote-editor/use-uploads.ts`, `apps/web/src/pages/quote-editor/UploadZone.tsx`
- Modify: `apps/web/src/pages/QuoteEditorPage.tsx`
- Create: `apps/web/src/pages/quote-editor/QuoteUploads.test.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `en.json`

**Interfaces:**
- Consumes:
  - Task 3: `validateModelFile`, `FileProblem`, `modelPath`, `safeObjectName`, `descriptionFromFilename`,
    `defaultCatalogChoice`, `MAX_PARALLEL_UPLOADS`;
  - Task 2: `fromUploadResponse`;
  - Task 7: `refreshItems` (private to `quote-items.ts`).
- Produces in `data/model-upload.ts`:
  - `type UploadOptions = { onProgress: (fraction: number) => void; signal: AbortSignal }`;
  - `type ModelUploader = (file: File, path: string, options: UploadOptions) => Promise<void>`;
  - `ModelUploaderContext`, `useModelUploader()`, `createTusUploader(supabase, env)`.
- Produces in `data/quote-items.ts`: `type NewItem = { quoteId; path; filename; printer_id; material_id }`,
  `useCreateQuoteItem()` (removes the uploaded object when creation fails).
- Produces in `data/quotes.ts`: `useRefreshQuote()`, returning `(quoteId: number) => Promise<void>`.
- Produces:
  - `AppProviders({ client, queryClient, uploader, children })`;
  - `renderApp(...)` returns `uploader: FakeUploader`;
  - `useLeaveGuard(dirty, { titleKey?, bodyKey? })`;
  - `useUploads(quoteId, items, onNotDraft)` returning `{ rows, rejected, busy, add, retry, cancel, dismiss,
    dismissRejected }`;
  - `UploadZone({ uploads, empty })`.

- [ ] **Step 1: Install tus-js-client and add the progress bar**

Run: `npm install tus-js-client@4 --workspace @3d-quote/web`
Expected: `tus-js-client` 4.x in `apps/web/package.json` dependencies.

Run: `npx shadcn add progress -c apps/web`, then
`git checkout -- apps/web/src/components/ui/button.tsx apps/web/src/components/ui/label.tsx` and `npm run format`.

- [ ] **Step 2: The uploader context, the tus implementation and the fake**

Create `apps/web/src/data/model-upload.ts`:

```ts
import { createContext, useContext } from 'react'
import { Upload, type DetailedError } from 'tus-js-client'
import type { SupabaseEnv } from '@/lib/env'
import type { AppSupabaseClient } from '@/lib/supabase'
import { AppError, fromUploadResponse } from './errors'

export type UploadOptions = { onProgress: (fraction: number) => void; signal: AbortSignal }

/** Uploads `file` to `models/<path>`. Rejects with an AppError, or with an AbortError once `signal` aborts. */
export type ModelUploader = (file: File, path: string, options: UploadOptions) => Promise<void>

export const ModelUploaderContext = createContext<ModelUploader | null>(null)

export function useModelUploader(): ModelUploader {
  const uploader = useContext(ModelUploaderContext)
  if (!uploader) throw new Error('useModelUploader must be used inside <ModelUploaderContext>')
  return uploader
}

// Supabase's resumable endpoint requires 6 MB chunks.
const CHUNK_SIZE = 6 * 1024 * 1024

function toUploadError(error: Error | DetailedError): AppError {
  const response = 'originalResponse' in error ? error.originalResponse : null
  return fromUploadResponse(response ? response.getStatus() : null, response?.getBody() ?? '', error)
}

/**
 * Resumable (TUS) uploads to Supabase Storage: progress events, and retries that resume after a dropped
 * connection. The models storage policies apply because the request carries the user's token.
 */
export function createTusUploader(supabase: AppSupabaseClient, env: SupabaseEnv): ModelUploader {
  const endpoint = `${env.url.replace(/\/+$/, '')}/storage/v1/upload/resumable`
  return async (file, path, { onProgress, signal }) => {
    // Read per upload: a long session refreshes its token.
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new AppError('sessionExpired')
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint,
        retryDelays: [0, 3000, 5000, 10000],
        headers: { authorization: `Bearer ${token}`, apikey: env.publishableKey },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: CHUNK_SIZE,
        metadata: {
          bucketName: 'models',
          objectName: path,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        onProgress: (sent, total) => onProgress(total > 0 ? sent / total : 0),
        onSuccess: () => resolve(),
        onError: (error) => reject(toUploadError(error)),
      })
      signal.addEventListener(
        'abort',
        () => {
          void upload.abort(true)
          reject(new DOMException('Upload cancelled', 'AbortError'))
        },
        { once: true },
      )
      upload.start()
    })
  }
}
```

Create `apps/web/src/test/fake-uploader.ts`:

```ts
import { act } from '@testing-library/react'
import type { ModelUploader } from '@/data/model-upload'

export type FakeUpload = {
  file: File
  path: string
  aborted: boolean
  progress: (fraction: number) => Promise<void>
  succeed: () => Promise<void>
  fail: (error: unknown) => Promise<void>
}

/** Uploads that tests advance, finish or fail by hand. */
export class FakeUploader {
  readonly uploads: FakeUpload[] = []

  readonly upload: ModelUploader = (file, path, { onProgress, signal }) =>
    new Promise<void>((resolve, reject) => {
      const entry: FakeUpload = {
        file,
        path,
        aborted: false,
        progress: (fraction) => act(async () => onProgress(fraction)),
        succeed: () => act(async () => resolve()),
        fail: (error) => act(async () => reject(error)),
      }
      signal.addEventListener('abort', () => {
        entry.aborted = true
        reject(new DOMException('Upload cancelled', 'AbortError'))
      })
      this.uploads.push(entry)
    })
}
```

In `apps/web/src/app/AppProviders.tsx`, add the prop and the provider:

```tsx
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/ui/sonner'
import { ModelUploaderContext, type ModelUploader } from '@/data/model-upload'
import { SupabaseContext, type AppSupabaseClient } from '@/lib/supabase'

export function AppProviders({
  client,
  queryClient,
  uploader,
  children,
}: {
  client: AppSupabaseClient
  queryClient: QueryClient
  uploader: ModelUploader
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext value={client}>
        <ModelUploaderContext value={uploader}>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ModelUploaderContext>
      </SupabaseContext>
    </QueryClientProvider>
  )
}
```

In `apps/web/src/app/App.tsx`, inside `ConfiguredApp`, create the uploader once and pass it:

```tsx
  const [uploader] = useState(() => createTusUploader(client, env))
```

```tsx
    <AppProviders client={client} queryClient={queryClient} uploader={uploader}>
```

(import `createTusUploader` from `@/data/model-upload`).

In `apps/web/src/test/render-app.tsx`, import `FakeUploader` from `./fake-uploader`, create
`const uploader = new FakeUploader()` before rendering, pass `uploader={uploader.upload}` to `AppProviders`, and return
it: `return { ...fake, router, user, queryClient, uploader }`.

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 3: Write the failing tests**

Create `apps/web/src/pages/quote-editor/QuoteUploads.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fromUploadResponse } from '@/data/errors'
import type { Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  materialRow,
  printerRow,
  quoteItemRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function renderUploads(opts: { items?: Row[]; status?: string; printers?: Row[] } = {}) {
  return renderApp('/quotes/7', {
    session,
    tables: {
      quotes: [
        quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status: opts.status ?? 'draft' }),
      ],
      clients: [clientRow({ id: 1 })],
      quote_items: opts.items ?? [],
      printers: opts.printers ?? [printerRow({ id: 11, name: 'MK4 #1' })],
      materials: [materialRow({ id: 21 })],
    },
    rpc: { create_quote_item: () => 99 },
  })
}

function stl(name = 'Staffa.stl', size?: number) {
  const file = new File(['solid part'], name, { type: 'model/stl' })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}

async function dropFiles(files: File[]) {
  const zone = await screen.findByRole('group', { name: 'Trascina qui i file STL o 3MF' })
  fireEvent.drop(zone, { dataTransfer: { files } })
}

test('rejects files that are not STL or 3MF, empty or over 100 MB', async () => {
  const { user, uploader } = renderUploads()
  expect(await screen.findByText('Aggiungi i file dei modelli per iniziare.')).toBeInTheDocument()
  await dropFiles([stl('part.obj'), stl('empty.stl', 0), stl('huge.stl', 100 * 1024 * 1024 + 1)])
  expect(
    await screen.findByText('part.obj: sono accettati solo file STL e 3MF.'),
  ).toBeInTheDocument()
  expect(screen.getByText('empty.stl: il file è vuoto.')).toBeInTheDocument()
  expect(screen.getByText('huge.stl: supera i 100 MB.')).toBeInTheDocument()
  expect(uploader.uploads).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Ignora part.obj' }))
  expect(
    screen.queryByText('part.obj: sono accettati solo file STL e 3MF.'),
  ).not.toBeInTheDocument()
})

test("uploads with progress, then creates the item with the previous item's printer and material", async () => {
  const { db, uploader } = renderUploads({
    items: [quoteItemRow({ id: 31, printer_id: 11, material_id: 21 })],
  })
  await screen.findByRole('article', { name: 'Staffa' })
  await dropFiles([stl('Staffa nuova.stl')])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  const upload = uploader.uploads[0]
  expect(upload.path).toMatch(/^7\/[0-9a-f-]{36}\/Staffa nuova\.stl$/)

  await upload.progress(0.5)
  expect(
    screen.getByRole('progressbar', { name: 'Caricamento di Staffa nuova.stl' }),
  ).toHaveAttribute('aria-valuenow', '50')

  await upload.succeed()
  await waitFor(() =>
    expect(db.rpcCalls('create_quote_item')).toEqual([
      {
        quote_id: 7,
        model_path: upload.path,
        original_filename: 'Staffa nuova.stl',
        description: 'Staffa nuova',
        printer_id: 11,
        material_id: 21,
      },
    ]),
  )
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
})

test('leaves printer and material empty when the previous ones are no longer active', async () => {
  const { db, uploader } = renderUploads({
    items: [quoteItemRow({ id: 31, printer_id: 12, material_id: 21 })],
    printers: [printerRow({ id: 12, name: 'MK3 #9', active: false })],
  })
  await screen.findByRole('article', { name: 'Staffa' })
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  await uploader.uploads[0].succeed()
  await waitFor(() => expect(db.rpcCalls('create_quote_item')).toHaveLength(1))
  expect(db.rpcCalls('create_quote_item')[0]).not.toHaveProperty('printer_id')
  expect(db.rpcCalls('create_quote_item')[0]).not.toHaveProperty('material_id')
})

test('a failed upload can be retried without choosing the file again', async () => {
  const { user, uploader } = renderUploads()
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  await uploader.uploads[0].fail(fromUploadResponse(null, ''))
  expect(
    await screen.findByText('Impossibile contattare il server. Controlla la connessione e riprova.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Riprova Staffa.stl' }))
  await waitFor(() => expect(uploader.uploads).toHaveLength(2))
  expect(uploader.uploads[1].file).toBe(uploader.uploads[0].file)
  expect(uploader.uploads[1].path).not.toBe(uploader.uploads[0].path)
})

test('runs at most three uploads at once', async () => {
  const { uploader } = renderUploads()
  await dropFiles([stl('a.stl'), stl('b.stl'), stl('c.stl'), stl('d.stl')])
  await waitFor(() => expect(uploader.uploads).toHaveLength(3))
  expect(screen.getByText('In attesa')).toBeInTheDocument()
  await uploader.uploads[0].succeed()
  await waitFor(() => expect(uploader.uploads).toHaveLength(4))
  expect(uploader.uploads[3].file.name).toBe('d.stl')
})

test('Cancel stops an upload', async () => {
  const { user, uploader } = renderUploads()
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: 'Annulla Staffa.stl' }))
  expect(uploader.uploads[0].aborted).toBe(true)
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
})

test("an item that can't be created removes its file and refreshes the quote", async () => {
  const { db, uploader } = renderUploads()
  db.failNext('create_quote_item', { code: 'P0001', message: 'quote_not_draft' })
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  const quoteReads = db.calls('quotes').length
  await uploader.uploads[0].succeed()
  expect(
    await screen.findByText('Il preventivo non è più una bozza e non si può modificare.'),
  ).toBeInTheDocument()
  expect(db.storageCalls('models')).toContainEqual({
    op: 'remove',
    paths: [uploader.uploads[0].path],
  })
  await waitFor(() => expect(db.calls('quotes').length).toBeGreaterThan(quoteReads))
})

test('leaving during an upload asks first, and cancels it', async () => {
  const { user, router, uploader } = renderUploads()
  await dropFiles([stl()])
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })
  await user.click(within(nav).getByRole('link', { name: 'Clienti' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Caricamenti in corso' })
  expect(within(dialog).getByText('I caricamenti in corso verranno annullati.')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Scarta' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/clients'))
  expect(uploader.uploads[0].aborted).toBe(true)
})

test('Choose files uploads through the file input', async () => {
  const { user, uploader } = renderUploads()
  await user.upload(await screen.findByLabelText('Scegli file'), stl())
  await waitFor(() => expect(uploader.uploads).toHaveLength(1))
})

test('a sent quote has no upload zone', async () => {
  renderUploads({ status: 'sent' })
  await screen.findByRole('heading', { level: 1, name: 'Q-2026-0007' })
  expect(
    screen.queryByRole('group', { name: 'Trascina qui i file STL o 3MF' }),
  ).not.toBeInTheDocument()
})
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/quote-editor/QuoteUploads.test.tsx`
Expected: FAIL. There is no upload zone.

- [ ] **Step 5: Item creation, quote refresh and the leave guard's texts**

Append to `apps/web/src/data/quote-items.ts`, changing its `./quote-rules` import to
`import { descriptionFromFilename, type ItemJob } from './quote-rules'`:

```ts
export type NewItem = {
  quoteId: number
  path: string
  filename: string
  printer_id: number | null
  material_id: number | null
}

/** Creates the item for an uploaded file (queued for slicing when printer and material are set). */
export function useCreateQuoteItem() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ quoteId, path, filename, printer_id, material_id }: NewItem) => {
      const { data, error } = await supabase.rpc('create_quote_item', {
        quote_id: quoteId,
        model_path: path,
        original_filename: filename,
        description: descriptionFromFilename(filename),
        ...(printer_id !== null && material_id !== null ? { printer_id, material_id } : {}),
      })
      if (error) {
        // Without its item the file is an orphan: remove it now, on a best-effort basis.
        await supabase.storage.from('models').remove([path])
        throw toAppError(error)
      }
      return data
    },
    onSuccess: (_id, { quoteId }) => refreshItems(queryClient, quoteId),
  })
}
```

Append to `apps/web/src/data/quotes.ts`:

```ts
/** Reloads a quote and its items, e.g. after an action found that it is no longer a draft. */
export function useRefreshQuote() {
  const queryClient = useQueryClient()
  return useCallback(
    async (quoteId: number) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) }),
      ])
    },
    [queryClient],
  )
}
```

(add `import { useCallback } from 'react'`).

In `apps/web/src/components/UnsavedChangesDialog.tsx`, add optional `titleKey` and `bodyKey` props (defaults
`'common.unsaved.title'` and `'common.unsaved.body'`) and use them in `AlertDialogTitle` and
`AlertDialogDescription`:

```tsx
export function UnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
  titleKey = 'common.unsaved.title',
  bodyKey = 'common.unsaved.body',
}: {
  open: boolean
  onStay: () => void
  onDiscard: () => void
  titleKey?: string
  bodyKey?: string
}) {
```

```tsx
          <AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
          <AlertDialogDescription>{t(bodyKey)}</AlertDialogDescription>
```

In `apps/web/src/components/use-leave-guard.tsx`, take the texts as an option and pass them on:

```tsx
export function useLeaveGuard(
  dirty: boolean,
  texts: { titleKey?: string; bodyKey?: string } = {},
) {
```

```tsx
      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        onStay={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
        titleKey={texts.titleKey}
        bodyKey={texts.bodyKey}
      />
```

- [ ] **Step 6: The upload queue and the zone**

Create `apps/web/src/pages/quote-editor/use-uploads.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { toAppError } from '@/data/errors'
import { useMaterials } from '@/data/materials'
import { useModelUploader } from '@/data/model-upload'
import { usePrinters } from '@/data/printers'
import { useCreateQuoteItem, type QuoteItem } from '@/data/quote-items'
import {
  defaultCatalogChoice,
  MAX_PARALLEL_UPLOADS,
  modelPath,
  safeObjectName,
  validateModelFile,
  type FileProblem,
} from '@/data/quote-rules'

export type UploadRow = {
  key: string
  name: string
  status: 'waiting' | 'uploading' | 'creating' | 'failed'
  progress: number
  /** i18n key of the failure. */
  error: string | null
}

export type RejectedFile = { key: string; name: string; problem: FileProblem }

export type Uploads = ReturnType<typeof useUploads>

/**
 * The editor's upload queue: at most MAX_PARALLEL_UPLOADS at once; each finished upload becomes an item. The files
 * stay in memory so a failed upload can be retried without choosing it again. Nothing survives a reload.
 */
export function useUploads(quoteId: number, items: QuoteItem[], onNotDraft: () => void) {
  const uploader = useModelUploader()
  const create = useCreateQuoteItem()
  const printers = usePrinters()
  const materials = useMaterials()
  const [rows, setRows] = useState<UploadRow[]>([])
  const [rejected, setRejected] = useState<RejectedFile[]>([])
  const files = useRef(new Map<string, File>())
  const waiting = useRef<string[]>([])
  const running = useRef(0)
  const controllers = useRef(new Map<string, AbortController>())
  // Uploads finish later; they must see the items and catalog of that moment, not of when they started.
  const latest = useRef({ items, printers: printers.data, materials: materials.data, onNotDraft })
  useEffect(() => {
    latest.current = { items, printers: printers.data, materials: materials.data, onNotDraft }
  })

  // Leaving the page cancels what is still uploading.
  useEffect(() => {
    const active = controllers.current
    return () => active.forEach((controller) => controller.abort())
  }, [])

  function patch(key: string, change: Partial<UploadRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  function drop(key: string) {
    files.current.delete(key)
    setRows((current) => current.filter((row) => row.key !== key))
  }

  function catalogDefaults() {
    const { items: now, printers: printerList, materials: materialList } = latest.current
    return defaultCatalogChoice(
      now,
      new Set((printerList ?? []).filter((p) => p.active).map((p) => p.id)),
      new Set((materialList ?? []).filter((m) => m.active).map((m) => m.id)),
    )
  }

  async function run(key: string) {
    const file = files.current.get(key)
    if (!file) return
    const controller = new AbortController()
    controllers.current.set(key, controller)
    patch(key, { status: 'uploading', progress: 0, error: null })
    const path = modelPath(quoteId, crypto.randomUUID(), safeObjectName(file.name))
    try {
      await uploader(file, path, {
        signal: controller.signal,
        onProgress: (progress) => patch(key, { progress }),
      })
      patch(key, { status: 'creating', progress: 1 })
      await create.mutateAsync({ quoteId, path, filename: file.name, ...catalogDefaults() })
      drop(key)
    } catch (caught) {
      if (controller.signal.aborted) {
        drop(key)
        return
      }
      const error = toAppError(caught)
      patch(key, { status: 'failed', error: error.messageKey })
      if (error.kind === 'notDraft') latest.current.onNotDraft()
    } finally {
      controllers.current.delete(key)
    }
  }

  function pump() {
    while (running.current < MAX_PARALLEL_UPLOADS && waiting.current.length > 0) {
      const key = waiting.current.shift() as string
      running.current += 1
      void run(key).finally(() => {
        running.current -= 1
        pump()
      })
    }
  }

  function add(list: File[]) {
    const accepted: UploadRow[] = []
    const refused: RejectedFile[] = []
    for (const file of list) {
      const key = crypto.randomUUID()
      const problem = validateModelFile(file)
      if (problem) {
        refused.push({ key, name: file.name, problem })
        continue
      }
      files.current.set(key, file)
      accepted.push({ key, name: file.name, status: 'waiting', progress: 0, error: null })
      waiting.current.push(key)
    }
    if (refused.length) setRejected((current) => [...current, ...refused])
    if (accepted.length) setRows((current) => [...current, ...accepted])
    pump()
  }

  function retry(key: string) {
    patch(key, { status: 'waiting', progress: 0, error: null })
    waiting.current.push(key)
    pump()
  }

  function cancel(key: string) {
    if (waiting.current.includes(key)) {
      waiting.current = waiting.current.filter((candidate) => candidate !== key)
      drop(key)
      return
    }
    controllers.current.get(key)?.abort()
  }

  return {
    rows,
    rejected,
    /** Uploads that leaving the page would cancel. */
    busy: rows.some((row) => row.status !== 'failed'),
    add,
    retry,
    cancel,
    dismiss: drop,
    dismissRejected: (key: string) =>
      setRejected((current) => current.filter((file) => file.key !== key)),
  }
}
```

Create `apps/web/src/pages/quote-editor/UploadZone.tsx`:

```tsx
import { Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { Uploads } from './use-uploads'

/** Drop zone and Choose files (the button is the main path on tablets), rejected files and upload rows. */
export function UploadZone({ uploads, empty }: { uploads: Uploads; empty: boolean }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div className="grid gap-3">
      <div
        role="group"
        aria-label={t('quotes.upload.drop')}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          uploads.add([...event.dataTransfer.files])
        }}
        className={cn(
          'grid place-items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center',
          over && 'border-primary bg-muted',
        )}
      >
        {empty && <p className="font-medium">{t('quotes.upload.empty')}</p>}
        <p className="text-sm text-muted-foreground">
          {t('quotes.upload.drop')} · {t('quotes.upload.hint')}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept=".stl,.3mf"
          tabIndex={-1}
          aria-label={t('quotes.upload.choose')}
          className="sr-only"
          onChange={(event) => {
            uploads.add([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <Button type="button" onClick={() => input.current?.click()}>
          <Upload aria-hidden />
          {t('quotes.upload.choose')}
        </Button>
      </div>

      {uploads.rejected.length > 0 && (
        <ul className="grid gap-1">
          {uploads.rejected.map((file) => (
            <li key={file.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-destructive">
                {t(`quotes.upload.rejected.${file.problem}`, { name: file.name })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('quotes.upload.dismiss', { name: file.name })}
                onClick={() => uploads.dismissRejected(file.key)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {uploads.rows.length > 0 && (
        <ul className="grid gap-2">
          {uploads.rows.map((row) => (
            <li key={row.key} className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{row.name}</span>
                {row.status === 'failed' ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t('quotes.upload.retry', { name: row.name })}
                      onClick={() => uploads.retry(row.key)}
                    >
                      {t('common.retry')}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('quotes.upload.dismiss', { name: row.name })}
                      onClick={() => uploads.dismiss(row.key)}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ) : (
                  row.status !== 'creating' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('quotes.upload.cancel', { name: row.name })}
                      onClick={() => uploads.cancel(row.key)}
                    >
                      {t('common.cancel')}
                    </Button>
                  )
                )}
              </div>
              {row.status === 'failed' ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(row.error ?? 'errors.unknown')}
                </p>
              ) : (
                <>
                  <Progress
                    value={Math.round(row.progress * 100)}
                    aria-label={t('quotes.upload.progress', { name: row.name })}
                  />
                  {row.status === 'waiting' && (
                    <span className="text-xs text-muted-foreground">
                      {t('quotes.upload.waiting')}
                    </span>
                  )}
                  {row.status === 'creating' && (
                    <span className="text-xs text-muted-foreground">
                      {t('quotes.upload.creating')}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 7: The editor uses them**

Replace `QuoteEditor` in `apps/web/src/pages/QuoteEditorPage.tsx` with:

```tsx
function QuoteEditor({ quote }: { quote: Quote }) {
  const { t } = useTranslation()
  const items = useQuoteItems(quote.id)
  const itemList = items.data ?? []
  const editable = quote.status === 'draft'
  const refreshQuote = useRefreshQuote()
  const uploads = useUploads(quote.id, itemList, () => void refreshQuote(quote.id))
  const guard = useLeaveGuard(uploads.busy, {
    titleKey: 'quotes.upload.leaveTitle',
    bodyKey: 'quotes.upload.leaveBody',
  })

  return (
    <section className="grid gap-6">
      <QuoteHeader quote={quote} actions={<QuoteActions quote={quote} items={itemList} />} />
      <section aria-labelledby="quote-items-title" className="grid gap-4">
        <h2 id="quote-items-title" className="text-lg font-semibold">
          {t('quotes.editor.items')}
        </h2>
        {items.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : items.isError && items.data === undefined ? (
          <QueryError error={items.error} onRetry={() => void items.refetch()} />
        ) : (
          <ul className="grid gap-4">
            {itemList.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} editable={editable} notCalculated={false} />
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <UploadZone uploads={uploads} empty={items.isSuccess && itemList.length === 0} />
        )}
      </section>
      {guard.dialog}
    </section>
  )
}
```

and add the imports `useLeaveGuard` (`@/components/use-leave-guard`), `useRefreshQuote` (from `@/data/quotes`, next
to `useQuote`), `UploadZone` (`./quote-editor/UploadZone`) and `useUploads` (`./quote-editor/use-uploads`).

- [ ] **Step 8: Add the texts**

Merge into `it.json` under `quotes`:

```json
"upload": {
  "drop": "Trascina qui i file STL o 3MF",
  "hint": "STL o 3MF, massimo 100 MB ciascuno.",
  "choose": "Scegli file",
  "empty": "Aggiungi i file dei modelli per iniziare.",
  "rejected": {
    "extension": "{{name}}: sono accettati solo file STL e 3MF.",
    "empty": "{{name}}: il file è vuoto.",
    "tooLarge": "{{name}}: supera i 100 MB."
  },
  "dismiss": "Ignora {{name}}",
  "cancel": "Annulla {{name}}",
  "retry": "Riprova {{name}}",
  "progress": "Caricamento di {{name}}",
  "waiting": "In attesa",
  "creating": "Creazione dell'articolo…",
  "leaveTitle": "Caricamenti in corso",
  "leaveBody": "I caricamenti in corso verranno annullati."
}
```

and into `en.json` under `quotes`:

```json
"upload": {
  "drop": "Drop STL or 3MF files here",
  "hint": "STL or 3MF, up to 100 MB each.",
  "choose": "Choose files",
  "empty": "Add model files to start.",
  "rejected": {
    "extension": "{{name}}: only STL and 3MF files are accepted.",
    "empty": "{{name}}: the file is empty.",
    "tooLarge": "{{name}}: larger than 100 MB."
  },
  "dismiss": "Dismiss {{name}}",
  "cancel": "Cancel {{name}}",
  "retry": "Retry {{name}}",
  "progress": "Uploading {{name}}",
  "waiting": "Waiting",
  "creating": "Creating the item…",
  "leaveTitle": "Uploads in progress",
  "leaveBody": "Uploads in progress will be cancelled."
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/pages src/components`
Expected: PASS, including `ClientDetailPage.test.tsx` (its leave guard keeps the default texts).

- [ ] **Step 10: Format, lint, build, run everything and commit**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

```bash
git add apps/web/package.json package-lock.json apps/web/src
git commit -m "feat(web): resumable model uploads with progress, retry, cancel and three at a time"
```

---

### Task 9: Live slicing updates, automatic pricing and totals

**Files:**
- Create: `apps/web/src/test/fake-realtime.ts`; modify `apps/web/src/test/fake-supabase.ts`
- Create: `apps/web/src/data/quote-live.ts`
- Modify: `apps/web/src/data/quotes.ts`, `apps/web/src/data/quote-items.ts`
- Create: `apps/web/src/pages/quote-editor/use-auto-price.ts`, `apps/web/src/pages/quote-editor/QuoteTotals.tsx`
- Modify: `apps/web/src/pages/QuoteEditorPage.tsx`
- Create: `apps/web/src/pages/quote-editor/QuoteLive.test.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `en.json`

**Interfaces:**
- Consumes:
  - Task 3: `unpricedItems`;
  - Task 2: `invokeFunction`;
  - Task 8: `useRefreshQuote`;
  - Task 7: `ItemCard`'s `notCalculated` prop.
- Produces in `data/quotes.ts`: `type PriceResult = { priced: number; skipped: number }`, `usePriceQuote()`
  (`mutateAsync(quoteId)`, which resolves after the items have been refetched).
- Produces in `data/quote-items.ts`: `useCachedQuoteItems()`, returning
  `(quoteId: number) => QuoteItem[]` (what the cache holds right now).
- Produces in `data/quote-live.ts`: `useQuoteLiveUpdates(quoteId: number, itemIds: number[])`.
- Produces in `pages/quote-editor/use-auto-price.ts`: `useAutoPrice(quote, items)` returning
  `{ recalculate: () => void; pricing: boolean; notCalculated: (item: QuoteItem) => boolean }`.
- Produces in the fakes: `FakeRealtime` with `channels`, `filters(table)`, `emit(table)` and `reconnect()`;
  `createFakeSupabase` / `renderApp` return `realtime`.

- [ ] **Step 1: The fake Realtime**

Create `apps/web/src/test/fake-realtime.ts`:

```ts
import { act } from '@testing-library/react'

type Callback = (payload: unknown) => void
type Listener = { table: string; filter?: string; callback: Callback }

class FakeChannel {
  readonly name: string
  readonly listeners: Listener[] = []
  private onStatus: ((status: string) => void) | undefined

  constructor(name: string) {
    this.name = name
  }

  on(
    _type: 'postgres_changes',
    options: { event: string; schema: string; table: string; filter?: string },
    callback: Callback,
  ) {
    this.listeners.push({ table: options.table, filter: options.filter, callback })
    return this
  }

  subscribe(onStatus?: (status: string) => void) {
    this.onStatus = onStatus
    queueMicrotask(() => onStatus?.('SUBSCRIBED'))
    return this
  }

  /** @internal used by FakeRealtime */
  status(status: string) {
    this.onStatus?.(status)
  }
}

/** Stands in for supabase.channel(): tests deliver changes and reconnects by hand. */
export class FakeRealtime {
  readonly channels: FakeChannel[] = []

  readonly channel = (name: string) => {
    const channel = new FakeChannel(name)
    this.channels.push(channel)
    return channel
  }

  readonly removeChannel = async (channel: FakeChannel) => {
    const index = this.channels.indexOf(channel)
    if (index >= 0) this.channels.splice(index, 1)
    return 'ok' as const
  }

  /** The filters of the open listeners on `table`. */
  filters(table: string) {
    return this.channels.flatMap((channel) =>
      channel.listeners.filter((l) => l.table === table).map((l) => l.filter),
    )
  }

  /** Delivers a change on `table` to every open listener. */
  emit(table: string) {
    return act(async () => {
      for (const channel of [...this.channels]) {
        for (const listener of channel.listeners) {
          if (listener.table === table) listener.callback({ table, eventType: 'UPDATE' })
        }
      }
    })
  }

  /** Every open channel drops and comes back. */
  reconnect() {
    return act(async () => {
      for (const channel of [...this.channels]) {
        channel.status('CHANNEL_ERROR')
        channel.status('SUBSCRIBED')
      }
    })
  }
}
```

In `apps/web/src/test/fake-supabase.ts`, import `FakeRealtime`, create `const realtime = new FakeRealtime()` next to
`db`, add `channel: realtime.channel` and `removeChannel: realtime.removeChannel` to `client`, and return it:
`return { client: client as unknown as AppSupabaseClient, auth, db, realtime }`.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/pages/quote-editor/QuoteLive.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { FakeDb, FunctionHandler, Row } from '@/test/fake-db'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  jobRow,
  materialRow,
  printerRow,
  quoteItemRow,
  quoteRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'

const session = fakeSession()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

function renderLive(
  items: Row[],
  opts: { status?: string; functions?: Record<string, FunctionHandler> } = {},
) {
  return renderApp('/quotes/7', {
    session,
    tables: {
      quotes: [
        quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, status: opts.status ?? 'draft' }),
      ],
      clients: [clientRow({ id: 1 })],
      quote_items: items,
      printers: [printerRow({ id: 11 })],
      materials: [materialRow({ id: 21 })],
    },
    functions: opts.functions,
  })
}

const queued = { printer_id: 11, material_id: 21, job: jobRow() }
const results = {
  print_time_s: 19800,
  filament_g: 120,
  bbox_x_mm: 10,
  bbox_y_mm: 10,
  bbox_z_mm: 10,
}
const sliced = {
  printer_id: 11,
  material_id: 21,
  ...results,
  job: jobRow({ status: 'succeeded' }),
}
const priced = {
  ...sliced,
  computed_total: 39.24,
  item_total: 39.24,
  priced_at: '2026-10-13T09:00:00Z',
}
const noPricing = { 'price-quote': () => ({ data: { priced: 0, skipped: 0 } }) }

test("subscribes to the quote's items and their jobs", async () => {
  const { realtime } = renderLive([
    quoteItemRow({ id: 31, ...queued }),
    quoteItemRow({ id: 32, description: 'Perno', ...queued }),
  ])
  await screen.findByRole('article', { name: 'Staffa' })
  await waitFor(() =>
    expect(realtime.filters('slicing_jobs')).toEqual(['quote_item_id=in.(31,32)']),
  )
  expect(realtime.filters('quote_items')).toEqual(['quote_id=eq.7'])
})

test('a change refetches the items', async () => {
  const { db, realtime } = renderLive([quoteItemRow({ id: 31, ...queued })], {
    functions: noPricing,
  })
  const item = await screen.findByRole('article', { name: 'Staffa' })
  expect(within(item).getByText('In attesa dello slicing')).toBeInTheDocument()
  Object.assign(db.table('quote_items')[0], { ...results, job: [jobRow({ status: 'succeeded' })] })
  await realtime.emit('slicing_jobs')
  expect(await within(item).findByText('5:30')).toBeInTheDocument()
})

test('refetches after reconnecting, to catch changes missed meanwhile', async () => {
  const { db, realtime } = renderLive([quoteItemRow({ id: 31, ...queued })], {
    functions: noPricing,
  })
  const item = await screen.findByRole('article', { name: 'Staffa' })
  await waitFor(() => expect(realtime.filters('slicing_jobs')).toEqual(['quote_item_id=in.(31)']))
  Object.assign(db.table('quote_items')[0], { ...results, job: [jobRow({ status: 'succeeded' })] })
  await realtime.reconnect()
  expect(await within(item).findByText('5:30')).toBeInTheDocument()
})

test('leaving the page closes the channel', async () => {
  const { user, realtime } = renderLive([quoteItemRow({ id: 31, ...queued })])
  await screen.findByRole('article', { name: 'Staffa' })
  const nav = screen.getByRole('navigation', { name: 'Navigazione principale' })
  await user.click(within(nav).getByRole('link', { name: 'Clienti' }))
  await waitFor(() => expect(realtime.channels).toHaveLength(0))
})

test('prices sliced items once and shows the price', async () => {
  let db!: FakeDb
  const rendered = renderLive([quoteItemRow({ id: 31, ...sliced })], {
    functions: {
      'price-quote': () => {
        Object.assign(db.table('quote_items')[0], {
          computed_total: 39.24,
          item_total: 39.24,
          priced_at: '2026-10-13T10:00:00Z',
          updated_at: '2026-10-13T10:00:00Z',
        })
        return { data: { priced: 1, skipped: 0 } }
      },
    },
  })
  db = rendered.db
  const item = await screen.findByRole('article', { name: 'Staffa' })
  expect((await within(item).findAllByText('39,24 €')).length).toBeGreaterThan(0)
  expect(db.functionCalls('price-quote')).toEqual([{ quote_id: 7 }])
})

test('gives up after one retry and says so', async () => {
  const { db } = renderLive([quoteItemRow({ id: 31, ...sliced })], {
    functions: { 'price-quote': () => ({ data: { priced: 0, skipped: 1 } }) },
  })
  const item = await screen.findByRole('article', { name: 'Staffa' })
  expect(await within(item).findByText('Prezzo non calcolato')).toBeInTheDocument()
  expect(db.functionCalls('price-quote')).toHaveLength(2)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(db.functionCalls('price-quote')).toHaveLength(2)
})

test('Recalculate prices calls price-quote even when everything is priced', async () => {
  const { db, user } = renderLive([quoteItemRow({ id: 31, ...priced })], {
    functions: { 'price-quote': () => ({ data: { priced: 1, skipped: 0 } }) },
  })
  await user.click(await screen.findByRole('button', { name: 'Ricalcola prezzi' }))
  await waitFor(() => expect(db.functionCalls('price-quote')).toHaveLength(1))
})

test('the total sums the item totals', async () => {
  renderLive([
    quoteItemRow({ id: 31, ...priced }),
    quoteItemRow({ id: 32, description: 'Perno', ...priced, computed_total: 10.5, item_total: 10.5 }),
  ])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(await within(total).findByText('49,74 €')).toBeInTheDocument()
  expect(within(total).getByText('Prezzi IVA esclusa.')).toBeInTheDocument()
})

test('the total is — while an item has no price', async () => {
  renderLive([quoteItemRow({ id: 31, ...priced }), quoteItemRow({ id: 32, description: 'Perno' })])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(within(total).getByText('—')).toBeInTheDocument()
})

test('a failed pricing call offers Retry', async () => {
  const { db, user } = renderLive([quoteItemRow({ id: 31, ...sliced })], {
    functions: { 'price-quote': () => ({ network: true }) },
  })
  expect(
    await screen.findByText('Impossibile contattare il server. Controlla la connessione e riprova.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  await waitFor(() => expect(db.functionCalls('price-quote')).toHaveLength(2))
})

test('a sent quote is never priced automatically', async () => {
  const { db } = renderLive([quoteItemRow({ id: 31, ...sliced })], {
    status: 'sent',
    functions: noPricing,
  })
  await screen.findByRole('article', { name: 'Staffa' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(db.functionCalls('price-quote')).toEqual([])
  expect(screen.queryByRole('button', { name: 'Ricalcola prezzi' })).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/quote-editor/QuoteLive.test.tsx`
Expected: FAIL. No channel is opened, nothing calls `price-quote`, and there is no total.

- [ ] **Step 4: Pricing and live-update hooks**

Append to `apps/web/src/data/quotes.ts`:

```ts
export type PriceResult = { priced: number; skipped: number }

/** Prices the draft's sliced items (Edge Function). Resolves once the items have been refetched. */
export function usePriceQuote() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (quoteId: number) =>
      invokeFunction<PriceResult>(supabase, 'price-quote', { quote_id: quoteId }),
    onSuccess: (_result, quoteId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quoteLists }),
      ]),
  })
}
```

Append to `apps/web/src/data/quote-items.ts` (add `import { useCallback } from 'react'`):

```ts
/** Reads the quote's items from the cache as they are right now (fresher than the last render). */
export function useCachedQuoteItems() {
  const queryClient = useQueryClient()
  return useCallback(
    (quoteId: number) =>
      queryClient.getQueryData<QuoteItem[]>(queryKeys.quoteItems(quoteId)) ?? [],
    [queryClient],
  )
}
```

Create `apps/web/src/data/quote-live.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSupabase } from '@/lib/supabase'
import { queryKeys } from './query-keys'

let channelSeq = 0

/**
 * Refetches the quote's items whenever Realtime reports a change to them or to their slicing jobs. Events only
 * trigger a refetch (debounced 250 ms); their payloads are never merged, so the database stays the source.
 */
export function useQuoteLiveUpdates(quoteId: number, itemIds: number[]) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const ids = [...itemIds].sort((a, b) => a - b).join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.quoteItems(quoteId) })
      }, 250)
    }
    // A fresh topic per subscription: supabase-js reuses a channel with the same topic, and the old one may still
    // be closing.
    let channel = supabase
      .channel(`quote-${quoteId}-${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_items', filter: `quote_id=eq.${quoteId}` },
        refresh,
      )
    if (ids) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slicing_jobs', filter: `quote_item_id=in.(${ids})` },
        refresh,
      )
    }
    let subscribedBefore = false
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      // Back after a drop: changes made meanwhile were never delivered.
      if (subscribedBefore) refresh()
      subscribedBefore = true
    })
    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [supabase, queryClient, quoteId, ids])
}
```

- [ ] **Step 5: Automatic pricing and the totals**

Create `apps/web/src/pages/quote-editor/use-auto-price.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toAppError } from '@/data/errors'
import { useCachedQuoteItems, type QuoteItem } from '@/data/quote-items'
import { unpricedItems } from '@/data/quote-rules'
import { usePriceQuote, useRefreshQuote, type Quote } from '@/data/quotes'

/**
 * Calls price-quote when a draft has items with results and no price. One call at a time; a trigger during a call
 * queues one more. If items are still unpriced after a call that skipped some, it retries once, then gives up on
 * those items (by id and updated_at) until they change. A saved quantity or markup clears priced_at and changes
 * updated_at, so it needs no call of its own.
 */
export function useAutoPrice(quote: Quote, items: QuoteItem[] | undefined) {
  const { t } = useTranslation()
  const price = usePriceQuote()
  const refreshQuote = useRefreshQuote()
  const cachedItems = useCachedQuoteItems()
  const [gaveUp, setGaveUp] = useState<ReadonlyMap<number, string>>(() => new Map())
  const flight = useRef({ running: false, again: false })

  async function run() {
    const state = flight.current
    if (state.running) {
      state.again = true
      return
    }
    state.running = true
    // The cache, not the last render: the refetch has landed by the time mutateAsync resolves.
    const pending = () => unpricedItems(cachedItems(quote.id))
    try {
      do {
        state.again = false
        const result = await price.mutateAsync(quote.id)
        if (result.skipped > 0 && pending().length > 0) await price.mutateAsync(quote.id)
        const left = pending()
        if (left.length > 0) {
          setGaveUp((current) => {
            const next = new Map(current)
            for (const item of left) next.set(item.id, item.updated_at)
            return next
          })
        }
      } while (state.again)
    } catch (caught) {
      const error = toAppError(caught)
      if (error.kind === 'notDraft') void refreshQuote(quote.id)
      else {
        toast.error(t(error.messageKey), {
          action: { label: t('common.retry'), onClick: () => void run() },
        })
      }
    } finally {
      state.running = false
    }
  }

  // The effect below must call the latest run(); a ref keeps it out of the effect's dependencies.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  const candidates =
    quote.status === 'draft'
      ? unpricedItems(items ?? [])
          .filter((item) => gaveUp.get(item.id) !== item.updated_at)
          .map((item) => `${item.id}@${item.updated_at}`)
          .join(',')
      : ''
  useEffect(() => {
    if (candidates) void runRef.current()
  }, [candidates])

  return {
    recalculate: () => void run(),
    pricing: price.isPending,
    notCalculated: (item: QuoteItem) => gaveUp.get(item.id) === item.updated_at,
  }
}
```

Create `apps/web/src/pages/quote-editor/QuoteTotals.tsx`:

```tsx
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { QuoteItem } from '@/data/quote-items'
import { useFormat } from '@/lib/use-format'

/** The quote total: the sum of the (rounded) item totals, or — while any item has no price. */
export function QuoteTotals({
  items,
  editable,
  pricing,
  onRecalculate,
}: {
  items: QuoteItem[]
  editable: boolean
  pricing: boolean
  onRecalculate: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const total =
    items.length > 0 && items.every((item) => item.item_total !== null)
      ? items.reduce((sum, item) => sum + (item.item_total ?? 0), 0)
      : null

  return (
    <section
      aria-labelledby="quote-total-title"
      className="flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4"
    >
      <div>
        <h2 id="quote-total-title" className="text-sm text-muted-foreground">
          {t('quotes.editor.total')}
        </h2>
        <p className="text-2xl font-semibold">{total === null ? '—' : format.currency(total)}</p>
        <p className="text-xs text-muted-foreground">{t('quotes.editor.netOfVat')}</p>
      </div>
      {editable && (
        <Button variant="outline" disabled={pricing} onClick={onRecalculate}>
          <RefreshCw aria-hidden />
          {t('quotes.editor.recalculate')}
        </Button>
      )}
    </section>
  )
}
```

- [ ] **Step 6: The editor uses them**

In `apps/web/src/pages/QuoteEditorPage.tsx`, inside `QuoteEditor`, after the `guard` line add:

```tsx
  const pricing = useAutoPrice(quote, items.data)
  useQuoteLiveUpdates(
    quote.id,
    itemList.map((item) => item.id),
  )
```

pass `notCalculated={pricing.notCalculated(item)}` to `ItemCard` (instead of `false`), and after the `UploadZone`
block, still inside the items `<section>`, add:

```tsx
        {items.isSuccess && (
          <QuoteTotals
            items={itemList}
            editable={editable}
            pricing={pricing.pricing}
            onRecalculate={pricing.recalculate}
          />
        )}
```

Imports: `useQuoteLiveUpdates` from `@/data/quote-live`, `QuoteTotals` from `./quote-editor/QuoteTotals`,
`useAutoPrice` from `./quote-editor/use-auto-price`.

- [ ] **Step 7: Add the texts**

Merge into `it.json` under `quotes.editor`:

```json
"total": "Totale",
"netOfVat": "Prezzi IVA esclusa.",
"recalculate": "Ricalcola prezzi"
```

and into `en.json` under `quotes.editor`:

```json
"total": "Total",
"netOfVat": "Prices net of VAT.",
"recalculate": "Recalculate prices"
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/pages`
Expected: PASS. Earlier editor tests that seed sliced but unpriced items now also trigger a `price-quote` call; with
no handler the fake answers 404 and a toast appears, which those tests don't assert on.

- [ ] **Step 9: Format, lint, build, run everything and commit**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

```bash
git add apps/web/src
git commit -m "feat(web): live slicing updates over Realtime, automatic pricing and the quote total"
```

---

### Task 10: Documentation and final verification

**Files:**
- Modify: `docs/frontend/web-app.md`
- Modify: `docs/frontend/functional-analysis.md`
- Modify: `docs/supabase/edge-functions.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/superpowers/specs/2026-10-13-web-quotes-design.md`

- [ ] **Step 1: Update the web app guide**

In `docs/frontend/web-app.md`:

1. In **Structure**, change the `data/` line to

```
├── data/             # one TanStack Query module per entity (quotes and quote items included), AppError mapping,
│                     # query keys, Edge Function calls, the model uploader, quote rules and live updates
```

2. Add this section after **Conventions**:

````markdown
## Quotes

- **List:** `QuotesPage` reads the `quotes_list` view. Search, filters, sort and page live in the URL
  (`parseQuoteListParams` / `toQuoteListSearch` in `src/data/quote-rules.ts`). `/quotes/new` is the same page with
  the New quote sheet open.
- **Editor:** `QuoteEditorPage` with its parts in `src/pages/quote-editor/`. Item changes save as soon as they happen
  (selects and switches at once, text and numbers on blur or Enter, through `InlineField`).
- **Uploads:** `useModelUploader()` (`src/data/model-upload.ts`) uploads with `tus-js-client` to
  `/storage/v1/upload/resumable` in 6 MB chunks; `useUploads` runs at most three at a time and keeps files in memory
  for Retry. Tests get a `FakeUploader` (`renderApp(...).uploader`) and finish, fail or advance each upload by hand.
- **Live status:** `useQuoteLiveUpdates` subscribes to `quote_items` and `slicing_jobs` (Supabase Realtime) and
  refetches the items on any change. Tests drive it with `renderApp(...).realtime` (`emit`, `reconnect`).
- **Pricing:** `useAutoPrice` calls the `price-quote` Edge Function whenever a draft has items with results and no
  price; it retries once, then shows "Price not calculated" until the item changes. Edge Functions are called through
  `invokeFunction` (`src/data/edge-functions.ts`); tests pass handlers with `renderApp(path, { functions })`.
- **Test fake:** `FakeDb#configure({ defaults, embeds })` adds what the database would: `renderApp` fills a new
  quote's defaults and embeds its `client` and `creator`, and gives items an empty `job` unless seeded.

### Simulating a slice locally

The slicer worker doesn't exist yet. With the local stack running, slice the oldest queued job by hand in Studio's
SQL editor (`http://127.0.0.1:54323`), which runs as `postgres`:

```sql
select msg_id, message->>'job_id' as job_id from public.worker_claim_job(300, 3);
-- then, with the two values it returned:
select public.worker_complete_job(
  <msg_id>, <job_id>,
  '{"print_time_s": 19800, "filament_g": 120.5, "filament_mm": 40000, "layer_count": 266,
    "bbox_x_mm": 100, "bbox_y_mm": 80, "bbox_z_mm": 40, "slicer_version": "manual"}'::jsonb
);
```

An open editor shows the results without reloading, then prices the item.
````

3. In **Not done yet**, replace the **Quotes** bullet with:

```markdown
- **PDF export** — next spec.
- **Orphaned model files** — files whose item was never created or whose removal failed stay in `models` until a
  cleanup job exists.
```

- [ ] **Step 2: The other docs**

- `docs/frontend/functional-analysis.md` §3.4, **Item card** table: change the File row to
  `| File | Original file name and a download link. The size isn't shown: it isn't stored on the item. |`.
- `docs/supabase/edge-functions.md`, at the end of **Calling them**, add:
  `The web app calls both through \`invokeFunction\` (\`apps/web/src/data/edge-functions.ts\`), which turns the \`{ code }\` into an \`AppError\`.`
- `docs/architecture/overview.md`:
  - in the sequence diagram, change `status change (Realtime or polling)` to `status change (Realtime)`;
  - remove the open question **Status updates** (decided: Realtime, see the web quotes spec).
- `docs/superpowers/specs/2026-10-13-web-quotes-design.md`: change `- **Status:** Draft — awaiting review` to
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
- build, lint, format and web tests pass;
- `supabase test db` passes all 13 files;
- `supabase db diff` prints `No schema changes found`;
- `check:types-fresh` says the types are up to date.

- [ ] **Step 4: Manual smoke check in the browser**

With `supabase start` running (which also serves the Edge Functions), run `npm run dev`. Sign in as
`owner@3dquote.local` / `password123`, then:

1. Create a printer, a material and a client if the local database has none.
2. **Quotes → New quote:** pick the client, create the quote, and check that the editor opens with a `Q-<year>-…`
   number.
3. Drop or choose a small `.stl` and watch it upload. Choose a printer and material: the card shows "Waiting to
   slice".
4. Simulate the slice with the SQL in the web app guide. The card turns Done without a reload, then shows a price.
   The total and the list's Total column show it too.
5. Change the quantity (the price changes); set and remove an override; Mark as sent; Duplicate; delete the
   duplicate.
6. Switch the language to English and back.

Note anything that differs from the spec in the final report rather than fixing it silently.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: document the quotes screens, uploads, live updates and automatic pricing"
```

## Not done yet

- PDF export (next spec).
- The slicer worker; until it exists, slices are simulated with SQL.
- Deploying functions and migrations to the cloud project.
- Cleanup of orphaned model files.
