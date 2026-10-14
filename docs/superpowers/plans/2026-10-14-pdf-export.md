# PDF Export and VAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shop VAT rate that is frozen on each quote when it is sent, show Net / VAT / Total incl. VAT in the quote
editor, and export a quote as an Italian or English PDF built in the browser.

**Architecture:**
- `settings.vat_rate_pct` (default 22) and a nullable `quotes.vat_rate_pct`; `mark_quote_sent` copies the settings rate
  onto the quote, and a check constraint says a quote has a rate exactly when it is not a draft.
- Pure helpers in `quote-rules.ts` (`vatRateFor`, `quoteTotals`, `pdfFileName`) and a pure `toQuotePdfData` turn the
  quote into a fully formatted `QuotePdfData`. `QuotePdf` (react-pdf) only lays it out.
- An injectable `PdfRenderer` (context, like the model uploader) lazy-loads `@react-pdf/renderer` on export; tests
  use a fake.

**Tech Stack:**
- React 19, TypeScript 6, Vite 8, TanStack Query 5, react-hook-form + zod 4, react-i18next;
- `@react-pdf/renderer` (new), `pdfjs-dist` (new, dev only, for the real render test);
- Vitest 5 + Testing Library; Supabase CLI local stack with pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-14-pdf-export-design.md`

## Global Constraints

- Work on branch `develop`, one commit per task. Do not push, merge to `main`, or touch the cloud Supabase project.
- Run npm only from the repo root (`C:\Progetti\3D-Quote`), with `--workspace @3d-quote/web` for installs. Never run
  npm in a folder without a `package.json` (the parent `C:\Progetti` has its own npm project).
- VAT rate: `numeric(5,2)`, `0..100`, default `22`. `quotes.vat_rate_pct` is null exactly while `status = 'draft'`.
- VAT is computed once on the net total in integer cents, rounded half-up. The quotes list keeps its net Total.
- PDF: A4 portrait, 15 mm margins, built-in Helvetica, shop currency, language chosen in the dialog (not the UI
  language). Not on the PDF: cost breakdown, print times, filament weights, overrides, internal client notes.
- Export PDF: any status, both roles, disabled until the quote has items and every item has an `item_total`.
- File name: `<number>-<client name>.pdf`, forbidden characters removed, whitespace runs → `-`, client part ≤ 60 chars.
- Texts in both `it.json` and `en.json` (a test fails when the key sets differ). Tests run in Italian.
- Docs are written in English. Code follows the surrounding style: no extra comments, `@/` imports, no semicolons,
  single quotes, 100-column Prettier.

## Review Focus

Inputs and conditions the spec implies but the task tests don't obviously exercise; each has a test in the task named.

- A client with no email or phone, a shop with no address, VAT number or logo: no empty lines or "undefined" on the
  PDF (Task 4: `toQuotePdfData` skips empty lines).
- A quote with 0 % VAT: still shows the VAT line with 0,00 and gross = net (Task 2 and Task 4).
- An address entered on several lines: each line printed separately (Task 4).
- A client name with characters illegal in file names (`Rossi/Bianchi: "SRL"`) or very long: a valid, capped file
  name (Task 2).
- A long quote (40 items): rows continue on page 2 with the table header repeated and no row cut in half (Task 5).
- The logo can't be loaded or an SVG logo: the PDF is still created, with a warning toast; an SVG is rasterised
  (Task 6).
- A renderer that throws: the dialog stays open with an error message and Download works again (Task 6).
- A sent quote after the shop rate changed: the editor and the PDF show the frozen rate, not the Settings rate
  (Task 3 and Task 4).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `supabase/schemas/03_settings.sql` | modify | `vat_rate_pct` column |
| `supabase/schemas/05_quotes.sql` | modify | `vat_rate_pct` column and constraint |
| `supabase/schemas/20_quote_api.sql` | modify | `mark_quote_sent` freezes the rate |
| `supabase/migrations/<ts>_vat_rate.sql` | create (generated, then edited) | columns, backfill, constraint, new function body |
| `supabase/migrations/<ts>_vat_rate_setup.sql` | create | column grant on `settings.vat_rate_pct` |
| `supabase/tests/database/13_vat.test.sql` | create | pgTAP for the VAT rules |
| `apps/web/src/lib/database.types.ts` | regenerate | new columns |
| `apps/web/src/test/fixtures.ts` | modify | `vat_rate_pct` on the settings and quote fixtures |
| `apps/web/src/data/quote-rules.ts` | modify | `vatRateFor`, `quoteTotals`, `pdfFileName` |
| `apps/web/src/data/quote-rules.test.ts` | modify | tests for the three |
| `apps/web/src/data/quotes.ts` | modify | the quote's embedded client also carries email and phone |
| `apps/web/src/pages/settings/settings-form.ts` | modify | VAT rate field |
| `apps/web/src/pages/SettingsPage.tsx` | modify | VAT rate in the edit and read-only views |
| `apps/web/src/pages/quote-editor/QuoteTotals.tsx` | modify | Net / VAT / Total incl. VAT |
| `apps/web/src/pdf/quote-pdf-data.ts` | create | `QuotePdfData`, `toQuotePdfData` |
| `apps/web/src/pdf/QuotePdf.tsx` | create | react-pdf layout |
| `apps/web/src/pdf/pdf-renderer.ts` | create | `PdfRenderer`, context, lazy real renderer |
| `apps/web/src/pdf/logo.ts` | create | `loadLogoDataUrl` |
| `apps/web/src/pdf/download.ts` | create | `downloadBlob` |
| `apps/web/src/pdf/ExportPdfDialog.tsx` | create | language choice, build, download |
| `apps/web/src/pdf/*.test.ts(x)` | create | unit, render and page tests |
| `apps/web/src/pages/quote-editor/QuoteActions.tsx` | modify | Export PDF button and dialog |
| `apps/web/src/app/AppProviders.tsx`, `App.tsx` | modify | provide the renderer |
| `apps/web/src/test/fake-pdf.ts`, `render-app.tsx` | create / modify | `FakePdfRenderer`, `renderApp(...).pdf` |
| `apps/web/src/test/setup.ts` | modify | allow Node-environment test files |
| `apps/web/src/i18n/locales/{it,en}.json` | modify | all new texts |
| `docs/**` | modify | see Task 7 |

---

### Task 1: Database — the VAT columns, freezing the rate, pgTAP

**Files:**
- Modify: `supabase/schemas/03_settings.sql`, `supabase/schemas/05_quotes.sql`, `supabase/schemas/20_quote_api.sql`
- Create: `supabase/migrations/<ts>_vat_rate.sql` (generated), `supabase/migrations/<ts>_vat_rate_setup.sql`
- Create: `supabase/tests/database/13_vat.test.sql`
- Regenerate: `apps/web/src/lib/database.types.ts`
- Modify: `apps/web/src/test/fixtures.ts`, `docs/supabase/data-model.md`

**Interfaces:**
- Produces: `settings.vat_rate_pct numeric(5,2) not null default 22`; `quotes.vat_rate_pct numeric(5,2)` null for
  drafts; generated types `Tables<'settings'>['vat_rate_pct']: number` and `Tables<'quotes'>['vat_rate_pct']: number | null`.

Local stack must be running (`supabase start`).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/13_vat.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (910001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (910001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (910001, 'Test Client');
insert into public.quotes (id, client_id, created_by, status, sent_at, valid_until) overriding system value values
  (910001, 910001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date + 30);
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id,
  print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, computed_total
) overriding system value values
  (910001, 910001, '910001/a/ok.stl', 'ok.stl', 'OK', 910001, 910001, 3600, 25, 50, 40, 30, 10.00);
insert into public.slicing_jobs (quote_item_id, status) values (910001, 'succeeded');

-- Settings
select is((select vat_rate_pct from public.settings where id = 1), 22::numeric, 'the VAT rate defaults to 22');
select throws_ok($$update public.settings set vat_rate_pct = -1$$, '23514', null, 'a negative rate is refused');
select throws_ok($$update public.settings set vat_rate_pct = 100.01$$, '23514', null, 'a rate above 100 is refused');

-- Constraint: a rate exactly when the quote is not a draft
select throws_ok(
  $$insert into public.quotes (client_id, created_by, status, vat_rate_pct)
    values (910001, '00000000-0000-4000-8000-0000000000a1', 'draft', 22)$$,
  '23514', null, 'a draft cannot carry a rate'
);
select throws_ok(
  $$insert into public.quotes (client_id, created_by, status, sent_at, vat_rate_pct)
    values (910001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), null)$$,
  '23514', null, 'a sent quote must carry a rate'
);

-- Operator: sending freezes the rate
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is((select vat_rate_pct from public.quotes where id = 910001), null::numeric, 'a draft has no rate of its own');
select lives_ok($$select public.mark_quote_sent(910001)$$, 'the quote can be sent');
select is((select vat_rate_pct from public.quotes where id = 910001), 22::numeric, 'sending copies the settings rate');

-- A later change of the shop rate leaves the sent quote alone
reset role;
update public.settings set vat_rate_pct = 23 where id = 1;
select is((select vat_rate_pct from public.quotes where id = 910001), 22::numeric, 'the sent quote keeps its rate');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$with u as (update public.settings set vat_rate_pct = 10 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'an operator cannot change the shop rate'
);
select lives_ok($$select public.mark_quote_accepted(910001)$$, 'the quote can be accepted');
select is((select vat_rate_pct from public.quotes where id = 910001), 22::numeric, 'accepting keeps the rate');

-- Expiring keeps the rate; a copy of a sent quote is a draft without one
reset role;
insert into public.quotes (id, client_id, created_by, status, sent_at, valid_until, vat_rate_pct)
  overriding system value values
  (910002, 910001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date - 1, 22);
select private.expire_quotes();
select is(
  (select status || ' ' || vat_rate_pct from public.quotes where id = 910002), 'expired 22.00',
  'expiring keeps the rate'
);
select is(
  (select vat_rate_pct from public.quotes where id = public.service_create_quote_copy(910002, '00000000-0000-4000-8000-0000000000a1')),
  null::numeric,
  'a copy of a sent quote is a draft without a rate'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db supabase/tests/database/13_vat.test.sql`
Expected: FAIL (`column "vat_rate_pct" of relation "settings" does not exist`).

- [ ] **Step 3: Declare the columns and freeze the rate**

In `supabase/schemas/03_settings.sql`, after the `minimum_item_price` line add:

```sql
  vat_rate_pct numeric(5,2) not null default 22 check (vat_rate_pct between 0 and 100),
```

In `supabase/schemas/05_quotes.sql`, after the `markup_override_pct` line add:

```sql
  vat_rate_pct numeric(5,2) check (vat_rate_pct between 0 and 100),
```

and, after the `unique (number_year, number_seq)` line (add a comma to the line before the new one), add:

```sql
  ,constraint quotes_vat_rate_check check ((status = 'draft') = (vat_rate_pct is null))
```

Write it cleanly in the file as:

```sql
  unique (number_year, number_seq),
  constraint quotes_vat_rate_check check ((status = 'draft') = (vat_rate_pct is null))
);
```

In `supabase/schemas/20_quote_api.sql`, in `private.mark_quote_sent`, replace the final `update` line with:

```sql
  update public.quotes
  set status = 'sent',
      sent_at = now(),
      vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
  where id = p_quote_id;
```

`quotes_guard` needs no change: draft → sent is allowed, and from then on every column except the status is frozen.

- [ ] **Step 4: Generate the migration, backfill, and write the setup migration**

Run: `supabase db diff -f vat_rate`
Expected: a new `supabase/migrations/<ts>_vat_rate.sql` with `alter table "public"."settings" add column
"vat_rate_pct"`, `alter table "public"."quotes" add column "vat_rate_pct"`, the check constraints, and
`create or replace function "private"."mark_quote_sent"`. Open it and check that:

1. the `settings` column is added before anything reads it;
2. the `quotes_vat_rate_check` constraint is added after the `quotes` column.

Between the `quotes` column and its `quotes_vat_rate_check` constraint, insert this backfill (existing non-draft
quotes would otherwise violate the constraint; the guard and `updated_at` triggers are switched off so history is
left as it was):

```sql
alter table public.quotes disable trigger quotes_guard;
alter table public.quotes disable trigger quotes_set_updated_at;
update public.quotes
set vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
where status <> 'draft';
alter table public.quotes enable trigger quotes_guard;
alter table public.quotes enable trigger quotes_set_updated_at;
```

If the generated file adds the constraint as `not valid` followed by `validate constraint`, put the backfill before
the `add constraint`.

Run: `supabase migration new vat_rate_setup`, then put this in the created file:

```sql
-- Column-level write grant for the new setting, like the others in grants_and_setup (owners only, through RLS).
grant update (vat_rate_pct) on public.settings to authenticated;
```

- [ ] **Step 5: Rebuild and run the tests**

Run: `supabase db reset` then `supabase test db`
Expected: all 14 files pass, including `13_vat.test.sql` (13 tests).

Run: `supabase db diff`
Expected: `No schema changes found`

- [ ] **Step 6: Regenerate the web app's types and fix the fixtures**

Run: `npm run gen:types` (repo root). Expected: `settings` gains `vat_rate_pct: number` and `quotes` gains
`vat_rate_pct: number | null` in Row / Insert / Update.

In `apps/web/src/test/fixtures.ts`:
- in `settingsRow`, after `minimum_item_price: 10,` add `vat_rate_pct: 22,`;
- in `quoteRow`, after `markup_override_pct: null,` add `vat_rate_pct: null,`.

Run: `npm run build && npm run check:types-fresh && npm test`
Expected: build passes (fix any other object typed as a full settings or quote row the compiler reports by adding the
same field), types are up to date, tests pass.

- [ ] **Step 7: Document the columns**

In `docs/supabase/data-model.md`:
- in the `settings` table, after the `minimum_item_price` row add
  `| \`vat_rate_pct\` | \`numeric(5,2)\` not null default \`22\` | Check: \`0..100\`. The shop's VAT rate; draft quotes follow it |`;
- in the `quotes` table, after the `markup_override_pct` row add
  `| \`vat_rate_pct\` | \`numeric(5,2)\` | Null while the quote is a draft; \`mark_quote_sent\` copies \`settings.vat_rate_pct\` here and it never changes afterwards. Check \`quotes_vat_rate_check\`: null exactly when \`status = 'draft'\` |`;
- in the line describing `mark_quote_sent`, add "and freezes the VAT rate". Find it with
  `grep -n "mark_quote_sent" docs/supabase/data-model.md`.
- in the column-grants table (around line 317) the `settings` row already says "every column except `id`"; leave it.

- [ ] **Step 8: Commit**

```bash
git add supabase docs/supabase apps/web/src/lib/database.types.ts apps/web/src/test/fixtures.ts
git commit -m "feat(db): a shop VAT rate, frozen on each quote when it is sent"
```

---

### Task 2: Pure rules — VAT rate, totals, file name

**Files:**
- Modify: `apps/web/src/data/quote-rules.ts`
- Modify: `apps/web/src/data/quote-rules.test.ts`

**Interfaces:**
- Produces (all exported from `@/data/quote-rules`):
  - `vatRateFor(quote: { vat_rate_pct: number | null }, settings: { vat_rate_pct: number } | undefined): number | null`
  - `type QuoteTotals = { net: number; vat: number; gross: number }`
  - `quoteTotals(items: { item_total: number | null }[], ratePct: number): QuoteTotals | null`
  - `pdfFileName(number: string, clientName: string): string`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/data/quote-rules.test.ts` (add `pdfFileName`, `quoteTotals`, `vatRateFor` to the existing
import from `./quote-rules`; the file already imports `describe, expect, test` from vitest — keep what it has):

```ts
describe('vatRateFor', () => {
  test('the quote’s own rate wins', () => {
    expect(vatRateFor({ vat_rate_pct: 22 }, { vat_rate_pct: 23 })).toBe(22)
  })
  test('a draft follows settings', () => {
    expect(vatRateFor({ vat_rate_pct: null }, { vat_rate_pct: 23 })).toBe(23)
  })
  test('a zero rate is a rate', () => {
    expect(vatRateFor({ vat_rate_pct: 0 }, { vat_rate_pct: 23 })).toBe(0)
  })
  test('is null while settings are loading', () => {
    expect(vatRateFor({ vat_rate_pct: null }, undefined)).toBeNull()
  })
})

describe('quoteTotals', () => {
  const items = (...totals: (number | null)[]) => totals.map((item_total) => ({ item_total }))

  test('sums the items and adds VAT', () => {
    expect(quoteTotals(items(39.24, 10.5), 22)).toEqual({ net: 49.74, vat: 10.94, gross: 60.68 })
  })
  test('rounds VAT half-up to the cent', () => {
    expect(quoteTotals(items(12.25), 22)).toEqual({ net: 12.25, vat: 2.7, gross: 14.95 })
    expect(quoteTotals(items(0.25), 22)).toEqual({ net: 0.25, vat: 0.06, gross: 0.31 })
  })
  test('adds the item totals without floating-point drift', () => {
    expect(quoteTotals(items(0.1, 0.2), 0)).toEqual({ net: 0.3, vat: 0, gross: 0.3 })
  })
  test('a zero rate leaves the gross equal to the net', () => {
    expect(quoteTotals(items(10), 0)).toEqual({ net: 10, vat: 0, gross: 10 })
  })
  test('handles a fractional rate', () => {
    expect(quoteTotals(items(100), 7.5)).toEqual({ net: 100, vat: 7.5, gross: 107.5 })
  })
  test('is null without items', () => {
    expect(quoteTotals([], 22)).toBeNull()
  })
  test('is null while an item has no price', () => {
    expect(quoteTotals(items(10, null), 22)).toBeNull()
  })
})

describe('pdfFileName', () => {
  test('joins the number and the client with a dash', () => {
    expect(pdfFileName('Q-2026-0042', 'Mario Rossi')).toBe('Q-2026-0042-Mario-Rossi.pdf')
  })
  test('removes characters that are not allowed in file names', () => {
    expect(pdfFileName('Q-2026-0042', 'Rossi/Bianchi: "SRL" <x>?*|\\')).toBe(
      'Q-2026-0042-RossiBianchi-SRL-x.pdf',
    )
  })
  test('keeps accented letters and collapses whitespace', () => {
    expect(pdfFileName('Q-2026-0042', '  Società   Perù  ')).toBe('Q-2026-0042-Società-Perù.pdf')
  })
  test('caps the client part at 60 characters', () => {
    const name = pdfFileName('Q-2026-0042', 'A'.repeat(100))
    expect(name).toBe(`Q-2026-0042-${'A'.repeat(60)}.pdf`)
  })
  test('without a usable client name it is just the number', () => {
    expect(pdfFileName('Q-2026-0042', ' /:? ')).toBe('Q-2026-0042.pdf')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/data/quote-rules.test.ts`
Expected: FAIL (`vatRateFor` / `quoteTotals` / `pdfFileName` is not a function or not exported).

- [ ] **Step 3: Implement**

Append to `apps/web/src/data/quote-rules.ts`:

```ts
/** The quote's frozen VAT rate, or the shop's while it is a draft; null while settings are still loading. */
export function vatRateFor(
  quote: { vat_rate_pct: number | null },
  settings: { vat_rate_pct: number } | undefined,
): number | null {
  return quote.vat_rate_pct ?? settings?.vat_rate_pct ?? null
}

export type QuoteTotals = { net: number; vat: number; gross: number }

/**
 * Net (the sum of the item totals), VAT and gross, worked out in integer cents. VAT is rounded half-up once, on the
 * net. Null without items or while any item has no price.
 */
export function quoteTotals(
  items: { item_total: number | null }[],
  ratePct: number,
): QuoteTotals | null {
  if (items.length === 0 || items.some((item) => item.item_total === null)) return null
  const netCents = items.reduce((sum, item) => sum + Math.round((item.item_total as number) * 100), 0)
  // The rate in hundredths of a percent keeps the maths in integers.
  const rateBasisPoints = Math.round(ratePct * 100)
  const vatCents = Math.floor((netCents * rateBasisPoints + 5000) / 10000)
  return { net: netCents / 100, vat: vatCents / 100, gross: (netCents + vatCents) / 100 }
}

const FORBIDDEN_IN_FILE_NAMES = /[\\/:*?"<>|\u0000-\u001f]/g

/** `<number>-<client name>.pdf` with anything a file system dislikes removed (functional analysis §6). */
export function pdfFileName(number: string, clientName: string): string {
  const client = clientName
    .replace(FORBIDDEN_IN_FILE_NAMES, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  return client ? `${number}-${client}.pdf` : `${number}.pdf`
}
```

Check the three expectations by hand before running: `'Rossi/Bianchi: "SRL" <x>?*|\\'` loses `/ : " " < > ? * | \`, leaving
`Rossi Bianchi SRL x`... note `Rossi/Bianchi` has no space, so it becomes `RossiBianchi`; `: "SRL" <x>` becomes
` SRL x`, i.e. `RossiBianchi SRL x` → `RossiBianchi-SRL-x`. The test above expects exactly that.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test --workspace @3d-quote/web -- src/data/quote-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint and commit**

Run: `npm run format && npm run lint` (repo root)

```bash
git add apps/web/src/data/quote-rules.ts apps/web/src/data/quote-rules.test.ts
git commit -m "feat(web): VAT rate, quote totals in cents and the PDF file name"
```

---

### Task 3: Settings field and the editor's Net / VAT / Gross totals

**Files:**
- Modify: `apps/web/src/pages/settings/settings-form.ts`, `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/pages/quote-editor/QuoteTotals.tsx`, `apps/web/src/pages/QuoteEditorPage.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/pages/SettingsPage.test.tsx`, `apps/web/src/pages/quote-editor/QuoteLive.test.tsx`

**Interfaces:**
- Consumes: `vatRateFor`, `quoteTotals` (Task 2); `Quote` from `@/data/quotes`.
- Produces: `QuoteTotals` takes a new required prop `quote: Quote`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/pages/SettingsPage.test.tsx` append:

```ts
test('owners edit the VAT rate', async () => {
  const { db, user } = renderApp('/settings', { session })
  const rate = await screen.findByLabelText('Aliquota IVA (%)')
  expect(rate).toHaveValue('22')
  await user.clear(rate)
  await user.type(rate, '23')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Salvato.')).toBeInTheDocument()
  expect(db.calls('settings')).toContainEqual({
    op: 'update',
    filters: [['eq', 'id', 1]],
    values: { vat_rate_pct: 23 },
  })
})

test('the VAT rate must be between 0 and 100', async () => {
  const { db, user } = renderApp('/settings', { session })
  const rate = await screen.findByLabelText('Aliquota IVA (%)')
  await user.clear(rate)
  await user.type(rate, '101')
  await user.click(screen.getByRole('button', { name: 'Salva' }))
  expect(await screen.findByText('Deve essere tra 0 e 100.')).toBeInTheDocument()
  expect(db.calls('settings').filter((call) => call.op === 'update')).toHaveLength(0)
})

test('operators see the VAT rate read-only', async () => {
  renderApp('/settings', { session, staff: operatorStaff })
  expect(await screen.findByText('Aliquota IVA (%)')).toBeInTheDocument()
  expect(screen.getByText('22 %')).toBeInTheDocument()
  expect(screen.queryByLabelText('Aliquota IVA (%)')).not.toBeInTheDocument()
})
```

In `apps/web/src/pages/quote-editor/QuoteLive.test.tsx` replace the two totals tests (`the total sums the item totals`
and `the total is — while an item has no price`) with:

```ts
test('the total shows net, VAT and gross', async () => {
  renderLive([
    quoteItemRow({ id: 31, ...priced }),
    quoteItemRow({
      id: 32,
      description: 'Perno',
      ...priced,
      computed_total: 10.5,
      item_total: 10.5,
    }),
  ])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(await within(total).findByText(/49,74/)).toBeInTheDocument()
  expect(within(total).getByText('Imponibile')).toBeInTheDocument()
  expect(within(total).getByText('IVA (22 %)')).toBeInTheDocument()
  expect(within(total).getByText(/10,94/)).toBeInTheDocument()
  expect(within(total).getByText('Totale IVA inclusa')).toBeInTheDocument()
  expect(within(total).getByText(/60,68/)).toBeInTheDocument()
})

test('the total lines are — while an item has no price', async () => {
  renderLive([quoteItemRow({ id: 31, ...priced }), quoteItemRow({ id: 32, description: 'Perno' })])
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(within(total).getAllByText('—')).toHaveLength(3)
})

test('a sent quote shows its frozen VAT rate, not the shop’s', async () => {
  renderLive([quoteItemRow({ id: 31, ...priced, item_total: 100, computed_total: 100 })], {
    quote: { status: 'sent', sent_at: '2026-10-12T08:00:00Z', vat_rate_pct: 10 },
  })
  const total = await screen.findByRole('region', { name: 'Totale' })
  expect(await within(total).findByText('IVA (10 %)')).toBeInTheDocument()
  expect(within(total).getByText(/110,00/)).toBeInTheDocument()
})
```

Look at `renderLive` in that file: if it does not accept a `quote` override in its options, add `quote?:
Partial<Tables<'quotes'>>` to its options and spread it into the `quoteRow({ ... })` call, the way `renderEditor` does in
`QuoteEditorPage.test.tsx`. (Italian `it-IT` formats 110 as `110,00 €`; `/110,00/` matches it.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pages/SettingsPage.test.tsx src/pages/quote-editor/QuoteLive.test.tsx`
Expected: FAIL (no field labelled "Aliquota IVA (%)", no "Imponibile").

- [ ] **Step 3: Add the texts**

`apps/web/src/i18n/locales/it.json`:
- in `settings.pricing`, after `"markup": "Ricarico predefinito (%)",` add `"vat": "Aliquota IVA (%)",`;
- in `quotes.editor`, replace the line `"netOfVat": "Prezzi IVA esclusa.",` with
  ```json
        "netTotal": "Imponibile",
        "vat": "IVA ({{rate}} %)",
        "totalInclVat": "Totale IVA inclusa",
  ```

`apps/web/src/i18n/locales/en.json`:
- in `settings.pricing`, after `"markup": "Default markup (%)",` add `"vat": "VAT rate (%)",`;
- in `quotes.editor`, replace `"netOfVat": "Prices net of VAT.",` with
  ```json
        "netTotal": "Net total",
        "vat": "VAT ({{rate}} %)",
        "totalInclVat": "Total incl. VAT",
  ```

(Match the indentation of the neighbouring lines.)

- [ ] **Step 4: The settings field**

`apps/web/src/pages/settings/settings-form.ts`:
- in `settingsSchema`, after the `minimum_item_price` entry add
  `vat_rate_pct: numberField({ min: 0, max: 100, decimals: 2, rangeError: 'validation.percent' }),`;
- in `settingsToForm`, after `minimum_item_price: …` add `vat_rate_pct: toInputNumber(settings.vat_rate_pct, locale),`;
- in `changedSettings`, after `minimum_item_price: …` add `vat_rate_pct: number(form.vat_rate_pct),`.

`apps/web/src/pages/SettingsPage.tsx`:
- in `SettingsEditor`, after the `field('default_markup_pct', …)` line add
  `{field('vat_rate_pct', 'settings.pricing.vat', { inputMode: 'decimal' })}`;
- in `SettingsView`, after the `ReadOnlyField` whose value is `percent(settings.default_markup_pct)` add
  ```tsx
          <ReadOnlyField label={t('settings.pricing.vat')} value={percent(settings.vat_rate_pct)} />
  ```

- [ ] **Step 5: The totals**

Replace `apps/web/src/pages/quote-editor/QuoteTotals.tsx` with:

```tsx
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { QuoteItem } from '@/data/quote-items'
import { quoteTotals, vatRateFor } from '@/data/quote-rules'
import type { Quote } from '@/data/quotes'
import { useSettings } from '@/data/settings'
import { useFormat } from '@/lib/use-format'

/**
 * Net total (the sum of the rounded item totals), VAT and the total including VAT; — while any item has no price or
 * the shop rate is still loading. A sent quote shows the rate it was sent with.
 */
export function QuoteTotals({
  quote,
  items,
  editable,
  pricing,
  onRecalculate,
}: {
  quote: Quote
  items: QuoteItem[]
  editable: boolean
  pricing: boolean
  onRecalculate: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const settings = useSettings()
  const rate = vatRateFor(quote, settings.data)
  const totals = rate === null ? null : quoteTotals(items, rate)
  const money = (value: number | undefined) => (value === undefined ? '—' : format.currency(value))

  return (
    <section
      aria-labelledby="quote-total-title"
      className="flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4"
    >
      <div className="grid gap-1">
        <h2 id="quote-total-title" className="text-sm text-muted-foreground">
          {t('quotes.editor.total')}
        </h2>
        <dl className="grid grid-cols-[auto_auto] justify-start gap-x-6 gap-y-1">
          <dt className="text-sm text-muted-foreground">{t('quotes.editor.netTotal')}</dt>
          <dd className="text-right">{money(totals?.net)}</dd>
          <dt className="text-sm text-muted-foreground">
            {t('quotes.editor.vat', { rate: rate === null ? '—' : format.number(rate) })}
          </dt>
          <dd className="text-right">{money(totals?.vat)}</dd>
          <dt className="self-end text-sm text-muted-foreground">
            {t('quotes.editor.totalInclVat')}
          </dt>
          <dd className="text-right text-2xl font-semibold">{money(totals?.gross)}</dd>
        </dl>
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

In `apps/web/src/pages/QuoteEditorPage.tsx`, pass the quote: change `<QuoteTotals items={itemList}` to
`<QuoteTotals quote={quote} items={itemList}`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web`
Expected: PASS, including the i18n key-set test. If another test still looks for `Prezzi IVA esclusa.`, update it to
the new labels (`grep -rn "IVA esclusa" apps/web/src`).

- [ ] **Step 7: Format, lint, build and commit**

Run: `npm run format && npm run lint && npm run build`

```bash
git add apps/web
git commit -m "feat(web): the shop VAT rate in Settings and net, VAT and gross totals in the editor"
```

---

### Task 4: The PDF data — packages, texts and `toQuotePdfData`

**Files:**
- Modify: `apps/web/package.json`, `package-lock.json` (by npm)
- Modify: `apps/web/src/data/quotes.ts`, `apps/web/src/test/render-app.tsx`
- Create: `apps/web/src/pdf/quote-pdf-data.ts`, `apps/web/src/pdf/quote-pdf-data.test.ts`
- Modify: `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `quoteTotals`, `vatRateFor` (Task 2); `Quote`, `QuoteItem`, `Material`, `Settings`; `formatCurrency`,
  `formatDate`, `formatNumber`, `localeFor` from `@/lib/format`.
- Produces (from `@/pdf/quote-pdf-data`):

```ts
export type PdfLanguage = 'it' | 'en'
export type QuotePdfRow = { description: string; material: string; quantity: string; unitPrice: string; total: string }
export type QuotePdfData = {
  language: PdfLanguage
  logo: string | null
  shop: { name: string | null; lines: string[] }
  title: string
  number: string
  meta: { label: string; value: string }[]
  client: { title: string; lines: string[] }
  columns: QuotePdfRow
  rows: QuotePdfRow[]
  totals: { label: string; value: string; strong: boolean }[]
  notes: { title: string; text: string } | null
  terms: string | null
  watermark: string | null
  footer: { number: string; page: string; of: string }
}
export type QuotePdfInput = {
  quote: Quote; items: QuoteItem[]; materials: Pick<Material, 'id' | 'name' | 'type' | 'color'>[]
  settings: Settings; logo: string | null; language: PdfLanguage; today: string; t: TFunction
}
export function toQuotePdfData(input: QuotePdfInput): QuotePdfData
```

- Also: `Quote['client']` becomes `ClientOption & { email: string | null; phone: string | null }`.

- [ ] **Step 1: Install the packages**

From the repo root:

```bash
npm install @react-pdf/renderer --workspace @3d-quote/web
npm install -D pdfjs-dist --workspace @3d-quote/web
```

Expected: both appear in `apps/web/package.json`; `git status` shows no change under `C:\Progetti` (the parent
project). Run `npm run build` to confirm nothing broke.

- [ ] **Step 2: Let the quote's client carry email and phone**

In `apps/web/src/data/quotes.ts` change the `Quote` type and the select:

```ts
export type Quote = Tables<'quotes'> & {
  client: ClientOption & { email: string | null; phone: string | null }
  creator: { display_name: string }
}
```

and in `useQuote` change `'*, client:clients(id, name, company), creator:staff(display_name)'` to
`'*, client:clients(id, name, company, email, phone), creator:staff(display_name)'`.

In `apps/web/src/test/render-app.tsx`, in the `quotes` embed change the client object to
`{ id: client.id, name: client.name, company: client.company, email: client.email, phone: client.phone }`.

Run `npm run build && npm test` — fix any test or fixture that builds a `Quote` by hand by adding `email: null,
phone: null` to its `client`.

- [ ] **Step 3: Add the PDF texts**

`apps/web/src/i18n/locales/it.json` — add a new top-level group before the final `}` (add a comma after the previous
group):

```json
  "pdf": {
    "title": "Preventivo",
    "date": "Data",
    "validUntil": "Valido fino al",
    "client": "Cliente",
    "vatNumber": "P.IVA {{value}}",
    "columns": {
      "description": "Descrizione",
      "material": "Materiale",
      "quantity": "Qtà",
      "unitPrice": "Prezzo unitario",
      "total": "Totale"
    },
    "netTotal": "Imponibile",
    "vat": "IVA ({{rate}} %)",
    "totalInclVat": "Totale IVA inclusa",
    "notes": "Note",
    "watermark": "BOZZA",
    "page": "Pagina",
    "of": "di"
  }
```

`apps/web/src/i18n/locales/en.json` — the same group:

```json
  "pdf": {
    "title": "Quote",
    "date": "Date",
    "validUntil": "Valid until",
    "client": "Client",
    "vatNumber": "VAT no. {{value}}",
    "columns": {
      "description": "Description",
      "material": "Material",
      "quantity": "Qty",
      "unitPrice": "Unit price",
      "total": "Total"
    },
    "netTotal": "Net total",
    "vat": "VAT ({{rate}} %)",
    "totalInclVat": "Total incl. VAT",
    "notes": "Notes",
    "watermark": "DRAFT",
    "page": "Page",
    "of": "of"
  }
```

- [ ] **Step 4: Write the failing tests**

Create `apps/web/src/pdf/quote-pdf-data.test.ts`:

```ts
import i18n from 'i18next'
import { describe, expect, test } from 'vitest'
import type { QuoteItem } from '@/data/quote-items'
import type { Quote } from '@/data/quotes'
import { materialRow, quoteItemRow, quoteRow, settingsRow } from '@/test/fixtures'
import { toQuotePdfData, type PdfLanguage, type QuotePdfInput } from './quote-pdf-data'

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  ...quoteRow({ id: 7, number: 'Q-2026-0042', valid_until: '2026-11-11' }),
  client: { id: 1, name: 'Mario Rossi', company: 'Rossi Meccanica', email: 'mario@example.com', phone: '333 1234567' },
  creator: { display_name: 'Anna Rossi' },
  ...overrides,
})

const item = (overrides: Record<string, unknown> = {}) =>
  ({
    ...quoteItemRow({
      description: 'Staffa',
      material_id: 21,
      quantity: 3,
      item_total: 30,
      computed_total: 30,
      ...overrides,
    }),
  }) as QuoteItem

const materials = [materialRow({ id: 21, name: 'Prusament PLA', type: 'PLA', color: 'Black' })]

function build(overrides: Partial<QuotePdfInput> = {}, language: PdfLanguage = 'it') {
  return toQuotePdfData({
    quote: quote(),
    items: [item()],
    materials,
    settings: { ...settingsRow, shop_name: '3D Lab' },
    logo: null,
    language,
    today: '2026-10-14',
    t: i18n.getFixedT(language),
    ...overrides,
  })
}

describe('toQuotePdfData', () => {
  test('formats the quote in Italian', () => {
    const data = build()
    expect(data.title).toBe('Preventivo')
    expect(data.number).toBe('Q-2026-0042')
    expect(data.meta).toEqual([
      { label: 'Data', value: '14/10/2026' },
      { label: 'Valido fino al', value: '11/11/2026' },
    ])
    expect(data.columns.unitPrice).toBe('Prezzo unitario')
    expect(data.rows).toHaveLength(1)
    expect(data.rows[0]).toMatchObject({ description: 'Staffa', material: 'PLA · Black', quantity: '3' })
    expect(data.rows[0].unitPrice).toMatch(/^10,00/)
    expect(data.totals.map((line) => line.label)).toEqual(['Imponibile', 'IVA (22 %)', 'Totale IVA inclusa'])
    expect(data.totals[2]).toMatchObject({ strong: true })
    expect(data.totals[2].value).toMatch(/^36,60/)
  })

  test('formats the quote in English', () => {
    const data = build({}, 'en')
    expect(data.title).toBe('Quote')
    expect(data.meta[1]).toEqual({ label: 'Valid until', value: '11/11/2026' })
    expect(data.totals.map((line) => line.label)).toEqual(['Net total', 'VAT (22 %)', 'Total incl. VAT'])
    expect(data.totals[2].value).toMatch(/36\.60/)
    expect(data.footer).toEqual({ number: 'Q-2026-0042', page: 'Page', of: 'of' })
  })

  test('a sent quote uses the sent date and its frozen rate', () => {
    const data = build({
      quote: quote({ status: 'sent', sent_at: '2026-10-12T08:00:00Z', vat_rate_pct: 10 }),
    })
    expect(data.meta[0]).toEqual({ label: 'Data', value: '12/10/2026' })
    expect(data.totals[1].label).toBe('IVA (10 %)')
    expect(data.totals[2].value).toMatch(/^33,00/)
  })

  test('a 0 % rate still shows the VAT line', () => {
    const data = build({ settings: { ...settingsRow, vat_rate_pct: 0 } })
    expect(data.totals[1].label).toBe('IVA (0 %)')
    expect(data.totals[1].value).toMatch(/^0,00/)
    expect(data.totals[2].value).toBe(data.totals[0].value)
  })

  test('only drafts carry the watermark', () => {
    expect(build().watermark).toBe('BOZZA')
    expect(build({}, 'en').watermark).toBe('DRAFT')
    expect(build({ quote: quote({ status: 'sent', vat_rate_pct: 22, sent_at: '2026-10-12T08:00:00Z' }) }).watermark).toBeNull()
  })

  test('skips empty shop and client lines', () => {
    const data = build({
      quote: quote({ client: { id: 1, name: 'Mario Rossi', company: null, email: '', phone: null } }),
      settings: { ...settingsRow, shop_name: null, shop_address: null, shop_vat_number: null, shop_email: null, shop_phone: null },
    })
    expect(data.client.lines).toEqual(['Mario Rossi'])
    expect(data.shop).toEqual({ name: null, lines: [] })
  })

  test('prints a multi-line address line by line, then VAT number, email and phone', () => {
    const data = build({
      settings: {
        ...settingsRow,
        shop_address: 'Via Roma 1\n\n20100 Milano',
        shop_vat_number: 'IT01234567890',
        shop_email: 'info@3dlab.it',
        shop_phone: '02 123456',
      },
    })
    expect(data.shop.lines).toEqual([
      'Via Roma 1',
      '20100 Milano',
      'P.IVA IT01234567890',
      'info@3dlab.it',
      '02 123456',
    ])
  })

  test('shows the material type alone without a colour, and the name for "other"', () => {
    const data = build({
      items: [item({ material_id: 22 }), item({ material_id: 23 })],
      materials: [
        materialRow({ id: 22, name: 'x', type: 'PETG', color: null }),
        materialRow({ id: 23, name: 'Resina speciale', type: 'other', color: 'Clear' }),
      ],
    })
    expect(data.rows.map((row) => row.material)).toEqual(['PETG', 'Resina speciale · Clear'])
  })

  test('notes and terms appear only when present, terms in the chosen language', () => {
    expect(build().notes).toBeNull()
    expect(build().terms).toBeNull()
    const settings = { ...settingsRow, pdf_terms_it: 'Consegna in 10 giorni.', pdf_terms_en: 'Delivery in 10 days.' }
    const withNotes = quote({ notes: 'Colore da confermare' })
    expect(build({ quote: withNotes, settings }).notes).toEqual({ title: 'Note', text: 'Colore da confermare' })
    expect(build({ settings }).terms).toBe('Consegna in 10 giorni.')
    expect(build({ settings }, 'en').terms).toBe('Delivery in 10 days.')
    expect(build({ settings: { ...settingsRow, pdf_terms_it: '  ' } }).terms).toBeNull()
  })

  test('never includes internal data', () => {
    const data = JSON.stringify(
      build({
        items: [item({ print_time_s: 3600, filament_g: 25, override_reason: 'Accordo segreto', override_total: 30 })],
      }),
    )
    expect(data).not.toContain('Accordo segreto')
    expect(data).not.toContain('3600')
  })

  test('refuses a quote that is not fully priced', () => {
    expect(() => build({ items: [item({ item_total: null })] })).toThrow('quote_not_priced')
    expect(() => build({ items: [] })).toThrow('quote_not_priced')
  })
})
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pdf/quote-pdf-data.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement**

Create `apps/web/src/pdf/quote-pdf-data.ts`:

```ts
import type { TFunction } from 'i18next'
import type { Material } from '@/data/materials'
import type { QuoteItem } from '@/data/quote-items'
import { quoteTotals, vatRateFor } from '@/data/quote-rules'
import type { Quote } from '@/data/quotes'
import type { Settings } from '@/data/settings'
import { formatCurrency, formatDate, formatNumber, localeFor } from '@/lib/format'

export type PdfLanguage = 'it' | 'en'

export type QuotePdfRow = {
  description: string
  material: string
  quantity: string
  unitPrice: string
  total: string
}

/** Everything the PDF prints, already translated and formatted: the layout adds no logic. */
export type QuotePdfData = {
  language: PdfLanguage
  logo: string | null
  shop: { name: string | null; lines: string[] }
  title: string
  number: string
  meta: { label: string; value: string }[]
  client: { title: string; lines: string[] }
  columns: QuotePdfRow
  rows: QuotePdfRow[]
  totals: { label: string; value: string; strong: boolean }[]
  notes: { title: string; text: string } | null
  terms: string | null
  watermark: string | null
  footer: { number: string; page: string; of: string }
}

export type QuotePdfInput = {
  quote: Quote
  items: QuoteItem[]
  materials: Pick<Material, 'id' | 'name' | 'type' | 'color'>[]
  settings: Settings
  /** A PNG or JPEG data URL, or null for no logo. */
  logo: string | null
  language: PdfLanguage
  /** Today in shop time (yyyy-mm-dd): the date of a draft. */
  today: string
  /** `i18n.getFixedT(language)` */
  t: TFunction
}

const present = (text: string | null | undefined): text is string =>
  text !== null && text !== undefined && text.trim() !== ''

function materialLabel(
  materials: QuotePdfInput['materials'],
  materialId: number | null,
): string {
  const material = materials.find((candidate) => candidate.id === materialId)
  if (!material) return ''
  const base = material.type === 'other' ? material.name : material.type
  return present(material.color) ? `${base} · ${material.color.trim()}` : base
}

export function toQuotePdfData({
  quote,
  items,
  materials,
  settings,
  logo,
  language,
  today,
  t,
}: QuotePdfInput): QuotePdfData {
  const locale = localeFor(language)
  const money = (value: number) => formatCurrency(value, locale, settings.currency)
  const rate = vatRateFor(quote, settings) ?? settings.vat_rate_pct
  const totals = quoteTotals(items, rate)
  if (totals === null) throw new Error('quote_not_priced')

  const shopLines = [
    ...(settings.shop_address ?? '').split('\n').filter(present).map((line) => line.trim()),
    ...(present(settings.shop_vat_number)
      ? [t('pdf.vatNumber', { value: settings.shop_vat_number.trim() })]
      : []),
    ...[settings.shop_email, settings.shop_phone].filter(present).map((line) => line.trim()),
  ]
  const draft = quote.status === 'draft'
  const terms = language === 'en' ? settings.pdf_terms_en : settings.pdf_terms_it

  return {
    language,
    logo,
    shop: { name: present(settings.shop_name) ? settings.shop_name.trim() : null, lines: shopLines },
    title: t('pdf.title'),
    number: quote.number,
    meta: [
      {
        label: t('pdf.date'),
        value: formatDate(draft ? today : (quote.sent_at ?? today), locale),
      },
      { label: t('pdf.validUntil'), value: formatDate(quote.valid_until, locale) },
    ],
    client: {
      title: t('pdf.client'),
      lines: [quote.client.name, quote.client.company, quote.client.email, quote.client.phone]
        .filter(present)
        .map((line) => line.trim()),
    },
    columns: {
      description: t('pdf.columns.description'),
      material: t('pdf.columns.material'),
      quantity: t('pdf.columns.quantity'),
      unitPrice: t('pdf.columns.unitPrice'),
      total: t('pdf.columns.total'),
    },
    rows: items.map((item) => ({
      description: item.description,
      material: materialLabel(materials, item.material_id),
      quantity: formatNumber(item.quantity, locale),
      unitPrice: money((item.item_total as number) / item.quantity),
      total: money(item.item_total as number),
    })),
    totals: [
      { label: t('pdf.netTotal'), value: money(totals.net), strong: false },
      {
        label: t('pdf.vat', { rate: formatNumber(rate, locale) }),
        value: money(totals.vat),
        strong: false,
      },
      { label: t('pdf.totalInclVat'), value: money(totals.gross), strong: true },
    ],
    notes: present(quote.notes) ? { title: t('pdf.notes'), text: quote.notes.trim() } : null,
    terms: present(terms) ? terms.trim() : null,
    watermark: draft ? t('pdf.watermark') : null,
    footer: { number: quote.number, page: t('pdf.page'), of: t('pdf.of') },
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web`
Expected: PASS (the new file and everything else, including the i18n key-set test).

- [ ] **Step 8: Format, lint, build and commit**

Run: `npm run format && npm run lint && npm run build`

```bash
git add apps/web package-lock.json
git commit -m "feat(web): the data a quote PDF prints, formatted in the chosen language"
```

---

### Task 5: The PDF layout, checked with a real render

**Files:**
- Create: `apps/web/src/pdf/QuotePdf.tsx`, `apps/web/src/pdf/QuotePdf.render.test.ts`, `apps/web/src/pdf/sample-data.ts`
- Modify: `apps/web/src/test/setup.ts`

**Interfaces:**
- Consumes: `QuotePdfData`, `QuotePdfRow` (Task 4).
- Produces: `QuotePdf({ data }: { data: QuotePdfData })` returning a react-pdf `<Document>`.
- Produces (tests only): `sampleQuotePdfData(overrides?: Partial<QuotePdfData>, rowCount?: number): QuotePdfData`.

- [ ] **Step 1: Let setup.ts run in a Node-environment test file**

`apps/web/src/test/setup.ts` assumes jsdom. Wrap everything that touches `window`/`document` so a file with
`// @vitest-environment node` can use the same setup. Replace the file's body after the imports with:

```ts
const hasDom = typeof window !== 'undefined'

if (hasDom) {
  // Parallel workers on a loaded machine make the 1 s default too tight for multi-step page tests.
  configure({ asyncUtilTimeout: 3000 })

  // jsdom has no ResizeObserver; Radix (e.g. Switch inside a form) measures with it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

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

  // jsdom has no pointer capture; sonner calls it when a toast is pressed.
  Element.prototype.setPointerCapture ??= function () {}
}

beforeEach(() => {
  if (!hasDom) return
  window.localStorage.clear()
  initI18n('it')
})

afterEach(() => {
  if (hasDom) cleanup()
})
```

(Keep the existing comments' wording; the point is only the `hasDom` guard.) Run `npm test --workspace
@3d-quote/web` to confirm nothing else changed.

- [ ] **Step 2: Sample data for tests**

Create `apps/web/src/pdf/sample-data.ts`:

```ts
import type { QuotePdfData, QuotePdfRow } from './quote-pdf-data'

const row = (n: number): QuotePdfRow => ({
  description: `Staffa ${n}`,
  material: 'PLA · Black',
  quantity: '3',
  unitPrice: '10,00 €',
  total: '30,00 €',
})

/** A complete, Italian QuotePdfData for the layout tests. */
export function sampleQuotePdfData(
  overrides: Partial<QuotePdfData> = {},
  rowCount = 2,
): QuotePdfData {
  return {
    language: 'it',
    logo: null,
    shop: { name: '3D Lab', lines: ['Via Roma 1', '20100 Milano', 'P.IVA IT01234567890'] },
    title: 'Preventivo',
    number: 'Q-2026-0042',
    meta: [
      { label: 'Data', value: '14/10/2026' },
      { label: 'Valido fino al', value: '11/11/2026' },
    ],
    client: { title: 'Cliente', lines: ['Mario Rossi', 'Rossi Meccanica', 'mario@example.com'] },
    columns: {
      description: 'Descrizione',
      material: 'Materiale',
      quantity: 'Qtà',
      unitPrice: 'Prezzo unitario',
      total: 'Totale',
    },
    rows: Array.from({ length: rowCount }, (_, index) => row(index + 1)),
    totals: [
      { label: 'Imponibile', value: '60,00 €', strong: false },
      { label: 'IVA (22 %)', value: '13,20 €', strong: false },
      { label: 'Totale IVA inclusa', value: '73,20 €', strong: true },
    ],
    notes: { title: 'Note', text: 'Colore da confermare' },
    terms: 'Consegna in 10 giorni lavorativi.',
    watermark: null,
    footer: { number: 'Q-2026-0042', page: 'Pagina', of: 'di' },
    ...overrides,
  }
}
```

- [ ] **Step 3: Write the failing render test**

Create `apps/web/src/pdf/QuotePdf.render.test.ts`:

```ts
// @vitest-environment node
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createElement, type ReactElement } from 'react'
import { expect, test } from 'vitest'
import { QuotePdf } from './QuotePdf'
import { sampleQuotePdfData } from './sample-data'
import type { QuotePdfData } from './quote-pdf-data'

/** The text of each page of the rendered PDF. */
async function pagesOf(data: QuotePdfData): Promise<string[]> {
  const buffer = await renderToBuffer(
    createElement(QuotePdf, { data }) as ReactElement<{ children?: unknown }> as never,
  )
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const pages: string[] = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent()
    pages.push(content.items.map((entry) => ('str' in entry ? entry.str : '')).join(' '))
  }
  return pages
}

test('prints the header, client, rows, totals, notes, terms and footer', async () => {
  const [page] = await pagesOf(sampleQuotePdfData())
  for (const text of [
    '3D Lab',
    'P.IVA IT01234567890',
    'Preventivo',
    'Q-2026-0042',
    'Valido fino al',
    '11/11/2026',
    'Cliente',
    'Rossi Meccanica',
    'Descrizione',
    'Staffa 1',
    'PLA · Black',
    'Imponibile',
    'IVA (22 %)',
    'Totale IVA inclusa',
    '73,20 €',
    'Note',
    'Colore da confermare',
    'Consegna in 10 giorni lavorativi.',
    'Pagina 1 di 1',
  ]) {
    expect(page).toContain(text)
  }
})

test('a draft carries the watermark and a sent quote does not', async () => {
  const [draft] = await pagesOf(sampleQuotePdfData({ watermark: 'BOZZA' }))
  const [sent] = await pagesOf(sampleQuotePdfData({ watermark: null }))
  expect(draft).toContain('BOZZA')
  expect(sent).not.toContain('BOZZA')
})

test('empty optional parts leave no trace', async () => {
  const [page] = await pagesOf(
    sampleQuotePdfData({ notes: null, terms: null, shop: { name: null, lines: [] } }),
  )
  expect(page).not.toContain('Note')
  expect(page).not.toContain('Consegna')
  expect(page).not.toContain('undefined')
  expect(page).not.toContain('null')
})

test('a long quote continues on the next pages with the table header repeated', async () => {
  const pages = await pagesOf(sampleQuotePdfData({}, 40))
  expect(pages.length).toBeGreaterThan(1)
  pages.forEach((page, index) => {
    expect(page).toContain('Descrizione')
    expect(page).toContain(`Pagina ${index + 1} di ${pages.length}`)
  })
  expect(pages.join(' ')).toContain('Staffa 40')
  expect(pages[0]).not.toContain('Staffa 40')
})
```

If TypeScript rejects the element cast in `renderToBuffer(...)`, simplify to
`renderToBuffer(QuotePdf({ data }))` — `QuotePdf` is a plain function returning a `<Document>`.

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test --workspace @3d-quote/web -- src/pdf/QuotePdf.render.test.ts`
Expected: FAIL (cannot find `./QuotePdf`).

- [ ] **Step 5: Implement the layout**

Create `apps/web/src/pdf/QuotePdf.tsx`:

```tsx
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { QuotePdfData, QuotePdfRow } from './quote-pdf-data'

const GREY = '#6b7280'
const RULE = '#d1d5db'
const MM = 2.835

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#111827',
    paddingTop: 15 * MM,
    paddingHorizontal: 15 * MM,
    paddingBottom: 22 * MM,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  logo: { width: 40 * MM, height: 20 * MM, objectFit: 'contain', objectPosition: 'left' },
  shop: { alignItems: 'flex-end' },
  shopName: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  muted: { color: GREY },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  meta: { alignItems: 'flex-end' },
  client: { marginBottom: 16 },
  sectionTitle: { fontSize: 9, color: GREY, textTransform: 'uppercase', marginBottom: 3 },
  row: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  head: { fontFamily: 'Helvetica-Bold', borderBottomWidth: 1, borderBottomColor: '#111827' },
  description: { flex: 4, paddingRight: 6 },
  material: { flex: 3, paddingRight: 6 },
  quantity: { flex: 1, textAlign: 'right' },
  unitPrice: { flex: 2, textAlign: 'right' },
  total: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 10, alignSelf: 'flex-end', width: 70 * MM },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  strong: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  block: { marginTop: 16 },
  terms: { fontSize: 8, color: GREY },
  footer: {
    position: 'absolute',
    bottom: 10 * MM,
    left: 15 * MM,
    right: 15 * MM,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: GREY,
  },
  watermark: {
    position: 'absolute',
    top: 330,
    left: 60,
    fontSize: 110,
    fontFamily: 'Helvetica-Bold',
    color: '#ececec',
    transform: 'rotate(-35deg)',
  },
})

function TableRow({ values, head }: { values: QuotePdfRow; head?: boolean }) {
  return (
    <View style={head ? [styles.row, styles.head] : styles.row} wrap={false}>
      <Text style={styles.description}>{values.description}</Text>
      <Text style={styles.material}>{values.material}</Text>
      <Text style={styles.quantity}>{values.quantity}</Text>
      <Text style={styles.unitPrice}>{values.unitPrice}</Text>
      <Text style={styles.total}>{values.total}</Text>
    </View>
  )
}

/** The layout of a quote PDF (functional analysis §6). It prints `data` and decides nothing. */
export function QuotePdf({ data }: { data: QuotePdfData }) {
  return (
    <Document title={`${data.title} ${data.number}`} author={data.shop.name ?? undefined}>
      <Page size="A4" style={styles.page}>
        {data.watermark && (
          <Text style={styles.watermark} fixed>
            {data.watermark}
          </Text>
        )}
        <View style={styles.header}>
          {data.logo ? <Image src={data.logo} style={styles.logo} /> : <View />}
          <View style={styles.shop}>
            {data.shop.name && <Text style={styles.shopName}>{data.shop.name}</Text>}
            {data.shop.lines.map((line, index) => (
              <Text key={index} style={styles.muted}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {data.title} {data.number}
          </Text>
          <View style={styles.meta}>
            {data.meta.map((entry) => (
              <Text key={entry.label}>
                <Text style={styles.muted}>{entry.label}: </Text>
                {entry.value}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.client}>
          <Text style={styles.sectionTitle}>{data.client.title}</Text>
          {data.client.lines.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </View>

        <TableRow values={data.columns} head />
        {/* The header again on every page after the first. */}
        <View
          fixed
          render={({ pageNumber }) =>
            pageNumber > 1 ? <TableRow values={data.columns} head /> : null
          }
        />
        {data.rows.map((values, index) => (
          <TableRow key={index} values={values} />
        ))}

        <View style={styles.totals} wrap={false}>
          {data.totals.map((line) => (
            <View key={line.label} style={styles.totalLine}>
              <Text style={line.strong ? styles.strong : undefined}>{line.label}</Text>
              <Text style={line.strong ? styles.strong : undefined}>{line.value}</Text>
            </View>
          ))}
        </View>

        {data.notes && (
          <View style={styles.block} wrap={false}>
            <Text style={styles.sectionTitle}>{data.notes.title}</Text>
            <Text>{data.notes.text}</Text>
          </View>
        )}
        {data.terms && (
          <View style={styles.block}>
            <Text style={styles.terms}>{data.terms}</Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>{data.footer.number}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${data.footer.page} ${pageNumber} ${data.footer.of} ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 6: Run the tests, adjusting the layout until they pass**

Run: `npm test --workspace @3d-quote/web -- src/pdf/QuotePdf.render.test.ts`
Expected: PASS. If the repeated-header test fails, the `fixed` + `render` trick is not placing the header as
intended; fall back to wrapping each row group so the header is rendered by a `<View fixed>` that returns the header
for `pageNumber > 1` and nothing on page 1, and keep the inline header only for page 1. The test's contract is what
matters: every page contains the column header and "Pagina n di N", and no row is cut.

Also render one sample PDF to a file and open it, to check the look by eye:

```bash
node --input-type=module -e "
import { renderToFile } from '@react-pdf/renderer'
" 
```

(Easier: add a temporary line `writeFileSync('C:/Users/ALESSA~1/AppData/Local/Temp/quote.pdf', buffer)` to the test
while developing, look at the file, and remove it before committing.)

- [ ] **Step 7: Format, lint, build and commit**

Run: `npm run format && npm run lint && npm run build && npm test`

```bash
git add apps/web
git commit -m "feat(web): the quote PDF layout, checked by rendering it"
```

---

### Task 6: Export PDF in the editor

**Files:**
- Create: `apps/web/src/pdf/pdf-renderer.ts`, `apps/web/src/pdf/logo.ts`, `apps/web/src/pdf/download.ts`,
  `apps/web/src/pdf/ExportPdfDialog.tsx`, `apps/web/src/test/fake-pdf.ts`
- Create: `apps/web/src/pdf/ExportPdf.test.tsx`
- Modify: `apps/web/src/pages/quote-editor/QuoteActions.tsx`, `apps/web/src/app/AppProviders.tsx`,
  `apps/web/src/app/App.tsx`, `apps/web/src/test/render-app.tsx`
- Modify: `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `toQuotePdfData`, `QuotePdfData`, `PdfLanguage` (Task 4); `QuotePdf` (Task 5); `pdfFileName` (Task 2);
  `useSettings`, `useLogoUrl`, `useMaterials`; `shopToday` from `@/lib/format`.
- Produces:
  - `type PdfRenderer = (data: QuotePdfData) => Promise<Blob>`; `PdfRendererContext`; `usePdfRenderer(): PdfRenderer`;
    `renderQuotePdf: PdfRenderer` (lazy-loads react-pdf).
  - `loadLogoDataUrl(url: string): Promise<string>` (rejects when it can't produce a PNG or JPEG data URL).
  - `downloadBlob(blob: Blob, fileName: string): void`.
  - `ExportPdfDialog({ quote, items, onClose })`.
  - `FakePdfRenderer` with `render: PdfRenderer`, `rendered: QuotePdfData[]`, `failWith: unknown | null`;
    `renderApp(...)` returns it as `pdf`.
  - `AppProviders` takes a required `pdfRenderer: PdfRenderer` prop.

- [ ] **Step 1: Texts**

`apps/web/src/i18n/locales/it.json` — in the `quotes` group add (next to `editor`, same level):

```json
    "pdf": {
      "export": "Esporta PDF",
      "needsPrices": "Ogni articolo deve avere un prezzo prima dell'esportazione.",
      "title": "Esporta {{number}}",
      "language": "Lingua del PDF",
      "italian": "Italiano",
      "english": "English",
      "draftNote": "I PDF delle bozze hanno la filigrana BOZZA.",
      "download": "Scarica",
      "creating": "Creazione del PDF…",
      "error": "Impossibile creare il PDF. Riprova.",
      "logoWarning": "Impossibile caricare il logo: il PDF è stato creato senza."
    },
```

`apps/web/src/i18n/locales/en.json`:

```json
    "pdf": {
      "export": "Export PDF",
      "needsPrices": "Every item needs a price before exporting.",
      "title": "Export {{number}}",
      "language": "PDF language",
      "italian": "Italiano",
      "english": "English",
      "draftNote": "Draft PDFs carry a DRAFT watermark.",
      "download": "Download",
      "creating": "Creating PDF…",
      "error": "The PDF couldn't be created. Try again.",
      "logoWarning": "The logo couldn't be loaded; the PDF was created without it."
    },
```

- [ ] **Step 2: The renderer, the logo loader and the download helper**

`apps/web/src/pdf/pdf-renderer.ts`:

```ts
import { createContext, createElement, useContext, type ReactElement } from 'react'
import type { QuotePdfData } from './quote-pdf-data'

/** Turns a quote's PDF data into a PDF file. */
export type PdfRenderer = (data: QuotePdfData) => Promise<Blob>

export const PdfRendererContext = createContext<PdfRenderer | null>(null)

export function usePdfRenderer(): PdfRenderer {
  const renderer = useContext(PdfRendererContext)
  if (!renderer) throw new Error('usePdfRenderer must be used inside <PdfRendererContext>')
  return renderer
}

/** The real renderer. react-pdf and the layout load on the first export, not with the app. */
export const renderQuotePdf: PdfRenderer = async (data) => {
  const [{ pdf }, { QuotePdf }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./QuotePdf'),
  ])
  return pdf(createElement(QuotePdf, { data }) as ReactElement<never>).toBlob()
}
```

`apps/web/src/pdf/download.ts`:

```ts
/** Saves `blob` as `fileName` through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // The browser has started the download by now; release the memory a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
```

`apps/web/src/pdf/logo.ts`:

```ts
const MAX_SIDE_PX = 800

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** react-pdf can't draw SVG images, so an SVG is drawn on a canvas and exported as PNG. */
async function rasteriseSvg(svg: Blob): Promise<string> {
  const url = URL.createObjectURL(svg)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(image.naturalWidth, image.naturalHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Fetches the logo at `url` and returns a PNG or JPEG data URL; rejects when that isn't possible. */
export async function loadLogoDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`logo ${response.status}`)
  const blob = await response.blob()
  if (blob.type === 'image/svg+xml') return rasteriseSvg(blob)
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') return readAsDataUrl(blob)
  throw new Error(`unsupported logo type ${blob.type}`)
}
```

Wire the renderer in: `apps/web/src/app/AppProviders.tsx` — add the prop and wrap with the context:

```tsx
import { PdfRendererContext, type PdfRenderer } from '@/pdf/pdf-renderer'
// props: pdfRenderer: PdfRenderer
        <ModelUploaderContext value={uploader}>
          <PdfRendererContext value={pdfRenderer}>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </PdfRendererContext>
        </ModelUploaderContext>
```

`apps/web/src/app/App.tsx`: `import { renderQuotePdf } from '@/pdf/pdf-renderer'` and pass `pdfRenderer={renderQuotePdf}`
to `<AppProviders>`.

`apps/web/src/test/fake-pdf.ts`:

```ts
import type { PdfRenderer } from '@/pdf/pdf-renderer'
import type { QuotePdfData } from '@/pdf/quote-pdf-data'

/** Records what would be rendered; set `failWith` to make the next renders reject. */
export class FakePdfRenderer {
  readonly rendered: QuotePdfData[] = []
  failWith: unknown | null = null

  readonly render: PdfRenderer = async (data) => {
    if (this.failWith !== null) throw this.failWith
    this.rendered.push(data)
    return new Blob(['%PDF-fake'], { type: 'application/pdf' })
  }
}
```

`apps/web/src/test/render-app.tsx`: `import { FakePdfRenderer } from './fake-pdf'`; after `const uploader = new
FakeUploader()` add `const pdf = new FakePdfRenderer()`; pass `pdfRenderer={pdf.render}` to `<AppProviders>`; add `pdf`
to the returned object.

Run `npm run build && npm test` — they should still pass.

- [ ] **Step 3: Write the failing tests**

Create `apps/web/src/pdf/ExportPdf.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import {
  clientRow,
  materialRow,
  operatorStaff,
  printerRow,
  quoteItemRow,
  quoteRow,
  settingsRow,
} from '@/test/fixtures'
import { renderApp } from '@/test/render-app'
import { downloadBlob } from './download'
import { loadLogoDataUrl } from './logo'

vi.mock('./download', () => ({ downloadBlob: vi.fn() }))
vi.mock('./logo', () => ({ loadLogoDataUrl: vi.fn() }))

const session = fakeSession()

const priced = {
  printer_id: 11,
  material_id: 21,
  print_time_s: 3600,
  filament_g: 25,
  computed_total: 30,
  item_total: 30,
  priced_at: '2026-10-13T09:00:00Z',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
  vi.mocked(downloadBlob).mockReset()
  vi.mocked(loadLogoDataUrl).mockReset()
})
afterEach(() => vi.useRealTimers())

function renderEditor(
  opts: {
    quote?: Record<string, unknown>
    items?: Record<string, unknown>[]
    staff?: typeof operatorStaff
    settings?: Record<string, unknown>
  } = {},
) {
  return renderApp('/quotes/7', {
    session,
    staff: opts.staff,
    tables: {
      settings: [{ ...settingsRow, ...opts.settings }],
      quotes: [quoteRow({ id: 7, number: 'Q-2026-0007', client_id: 1, ...opts.quote })],
      clients: [clientRow({ id: 1, name: 'Mario Rossi' })],
      quote_items: opts.items ?? [quoteItemRow({ id: 31, ...priced })],
      printers: [printerRow({ id: 11 })],
      materials: [materialRow({ id: 21 })],
    },
  })
}

const exportButton = () => screen.findByRole('button', { name: 'Esporta PDF' })

test('Export PDF is offered in every status, to operators too', async () => {
  for (const status of ['draft', 'sent', 'accepted', 'rejected', 'expired']) {
    const quote =
      status === 'draft'
        ? {}
        : { status, vat_rate_pct: 22, sent_at: '2026-10-12T08:00:00Z' }
    const { unmount } = renderEditor({ quote, staff: operatorStaff })
    expect(await exportButton()).toBeEnabled()
    unmount()
  }
})

test('Export PDF waits until every item has a price', async () => {
  renderEditor({ items: [quoteItemRow({ id: 31, ...priced }), quoteItemRow({ id: 32 })] })
  expect(await exportButton()).toBeDisabled()
  expect(
    screen.getByText("Ogni articolo deve avere un prezzo prima dell'esportazione."),
  ).toBeInTheDocument()
})

test('Export PDF is disabled for a quote without items', async () => {
  renderEditor({ items: [] })
  expect(await exportButton()).toBeDisabled()
})

test('the dialog offers the UI language and builds the PDF in the chosen one', async () => {
  const { user, pdf } = renderEditor({ quote: { notes: 'Colore da confermare' } })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog', { name: 'Esporta Q-2026-0007' })
  expect(within(dialog).getByRole('radio', { name: 'Italiano' })).toBeChecked()
  expect(within(dialog).getByText('I PDF delle bozze hanno la filigrana BOZZA.')).toBeInTheDocument()

  await user.click(within(dialog).getByRole('radio', { name: 'English' }))
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))

  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('Q-2026-0007-Mario-Rossi.pdf')
  expect(pdf.rendered).toHaveLength(1)
  expect(pdf.rendered[0]).toMatchObject({
    language: 'en',
    title: 'Quote',
    number: 'Q-2026-0007',
    watermark: 'DRAFT',
    notes: { text: 'Colore da confermare' },
  })
  expect(pdf.rendered[0].meta[0].value).toBe('14/10/2026')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('a sent quote is exported with its frozen rate and no watermark or draft note', async () => {
  const { user, pdf } = renderEditor({
    quote: { status: 'sent', sent_at: '2026-10-12T08:00:00Z', vat_rate_pct: 10 },
  })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).queryByText(/filigrana/)).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(pdf.rendered).toHaveLength(1))
  expect(pdf.rendered[0].watermark).toBeNull()
  expect(pdf.rendered[0].totals[1].label).toBe('IVA (10 %)')
  expect(pdf.rendered[0].meta[0].value).toBe('12/10/2026')
})

test('a failing renderer keeps the dialog open with an error, and Download can be retried', async () => {
  const { user, pdf } = renderEditor()
  pdf.failWith = new Error('boom')
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Impossibile creare il PDF. Riprova.',
  )
  expect(downloadBlob).not.toHaveBeenCalled()

  pdf.failWith = null
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
})

test('the logo goes into the PDF when it loads', async () => {
  vi.mocked(loadLogoDataUrl).mockResolvedValue('data:image/png;base64,AAAA')
  const { user, pdf } = renderEditor({ settings: { shop_logo_path: 'logo-1.png' } })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Scarica' })).toBeEnabled())
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(pdf.rendered).toHaveLength(1))
  expect(loadLogoDataUrl).toHaveBeenCalledWith('https://storage.test/branding/logo-1.png')
  expect(pdf.rendered[0].logo).toBe('data:image/png;base64,AAAA')
})

test('a logo that cannot be loaded gives a warning, and the PDF is still created', async () => {
  vi.mocked(loadLogoDataUrl).mockRejectedValue(new Error('404'))
  const { user, pdf } = renderEditor({ settings: { shop_logo_path: 'logo-1.png' } })
  await user.click(await exportButton())
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Scarica' })).toBeEnabled())
  await user.click(within(dialog).getByRole('button', { name: 'Scarica' }))
  await waitFor(() => expect(pdf.rendered).toHaveLength(1))
  expect(pdf.rendered[0].logo).toBeNull()
  expect(
    await screen.findByText('Impossibile caricare il logo: il PDF è stato creato senza.'),
  ).toBeInTheDocument()
  expect(downloadBlob).toHaveBeenCalledTimes(1)
})
```

The fake storage's `createSignedUrl` returns `https://storage.test/branding/<path>` (see `fake-db.test.ts`); if the
URL in the fake differs, adjust the expected argument.

- [ ] **Step 4: Run them to verify they fail**

Run: `npm test --workspace @3d-quote/web -- src/pdf/ExportPdf.test.tsx`
Expected: FAIL (no "Esporta PDF" button).

- [ ] **Step 5: The dialog**

Create `apps/web/src/pdf/ExportPdfDialog.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMaterials } from '@/data/materials'
import type { QuoteItem } from '@/data/quote-items'
import { pdfFileName } from '@/data/quote-rules'
import type { Quote } from '@/data/quotes'
import { useLogoUrl, useSettings } from '@/data/settings'
import { shopToday } from '@/lib/format'
import { downloadBlob } from './download'
import { loadLogoDataUrl } from './logo'
import { usePdfRenderer } from './pdf-renderer'
import { toQuotePdfData, type PdfLanguage } from './quote-pdf-data'

const LANGUAGE_KEYS: Record<PdfLanguage, string> = {
  it: 'quotes.pdf.italian',
  en: 'quotes.pdf.english',
}

/** Asks for the PDF language, builds the PDF in the browser and downloads it. */
export function ExportPdfDialog({
  quote,
  items,
  onClose,
}: {
  quote: Quote
  items: QuoteItem[]
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const render = usePdfRenderer()
  const settings = useSettings()
  const materials = useMaterials()
  const logo = useLogoUrl(settings.data?.shop_logo_path ?? null)
  const [language, setLanguage] = useState<PdfLanguage>(i18n.language === 'en' ? 'en' : 'it')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready =
    settings.data !== undefined && materials.data !== undefined && logo.fetchStatus !== 'fetching'

  async function download() {
    if (!settings.data || !materials.data) return
    setPending(true)
    setError(null)
    try {
      let logoDataUrl: string | null = null
      if (settings.data.shop_logo_path) {
        try {
          if (!logo.data) throw new Error('no logo url')
          logoDataUrl = await loadLogoDataUrl(logo.data)
        } catch {
          toast.warning(t('quotes.pdf.logoWarning'))
        }
      }
      const data = toQuotePdfData({
        quote,
        items,
        materials: materials.data,
        settings: settings.data,
        logo: logoDataUrl,
        language,
        today: shopToday(),
        t: i18n.getFixedT(language),
      })
      const blob = await render(data)
      downloadBlob(blob, pdfFileName(quote.number, quote.client.name))
      onClose()
    } catch {
      setError(t('quotes.pdf.error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('quotes.pdf.title', { number: quote.number })}</DialogTitle>
          <DialogDescription>
            {quote.status === 'draft' ? t('quotes.pdf.draftNote') : ' '}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="mb-1 text-sm font-medium">{t('quotes.pdf.language')}</legend>
          {(['it', 'en'] as const).map((code) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="pdf-language"
                value={code}
                checked={language === code}
                onChange={() => setLanguage(code)}
              />
              {t(LANGUAGE_KEYS[code])}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!ready || pending} onClick={() => void download()}>
            {pending ? t('quotes.pdf.creating') : t('quotes.pdf.download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

If `sonner` has no `toast.warning` in the installed version, use `toast.error`, and change the expected behaviour in
no test (the tests only look at the text).

- [ ] **Step 6: The button**

In `apps/web/src/pages/quote-editor/QuoteActions.tsx`:
- add imports: `FileDown` from `lucide-react` (next to `Copy, Send, Trash2`) and
  `import { ExportPdfDialog } from '@/pdf/ExportPdfDialog'`;
- change `type OpenDialog = 'send' | 'accepted' | 'rejected' | 'delete' | null` to include `'export'`;
- after `const slicing = items.some(isSlicingInProgress)` add
  `const unpriced = items.length === 0 || items.some((item) => item.item_total === null)`;
- after the Duplicate `<Button …>…</Button>` add:

```tsx
      <Button
        variant="outline"
        disabled={unpriced}
        aria-describedby={unpriced ? 'export-hint' : undefined}
        onClick={() => setDialog('export')}
      >
        <FileDown aria-hidden />
        {t('quotes.pdf.export')}
      </Button>
      {unpriced && items.length > 0 && (
        <span id="export-hint" className="self-center text-sm text-muted-foreground">
          {t('quotes.pdf.needsPrices')}
        </span>
      )}
```

- after the `{dialog === 'send' && …}` line add
  `{dialog === 'export' && <ExportPdfDialog quote={quote} items={items} onClose={close} />}`.

The hint shows only when there are items that lack a price; a quote with no items just has the disabled button (the
editor's empty state already says "add model files"). The test "Export PDF waits until every item has a price"
exercises the hint.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace @3d-quote/web`
Expected: PASS. Fix by adjusting the test, not by loosening the behaviour, unless a fake (storage URL, dialog name) is
the cause.

- [ ] **Step 8: Format, lint and build; check the bundle**

Run: `npm run format && npm run lint && npm run build`

Then, from `apps/web`: list `dist/assets/*.js` with sizes. Expected: `@react-pdf/renderer` and `QuotePdf` are in
their own chunk(s) loaded on demand; the main `index-*.js` chunk grew by only a few kB (it was ~700 kB before). Check
with `grep -l "react-pdf\|fontkit" dist/assets/*.js` that the main chunk is not in the list. If it is, the dynamic
imports in `pdf-renderer.ts` are being undone by a static import — find it with `grep -rn "@react-pdf" src`; only
`QuotePdf.tsx` and `pdf-renderer.ts` may import it (and the render test). Note the chunk sizes for Task 7.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): export a quote as an Italian or English PDF from the editor"
```

---

### Task 7: Documentation and final verification

**Files:**
- Modify: `docs/frontend/functional-analysis.md`, `docs/frontend/web-app.md`, `docs/product/overview.md`,
  `docs/superpowers/specs/2026-10-14-pdf-export-design.md`

- [ ] **Step 1: The functional analysis**

In `docs/frontend/functional-analysis.md`:

1. §3.4 **Totals** (around line 153): replace the two lines "Quote total = sum of item totals…" and "Prices are
   **net of VAT**…" with:
   ```
   - **Net total** = sum of item totals; **VAT** = net × VAT rate, rounded half-up to the cent; **Total incl. VAT**.
     Shown with currency, formatted for the user's language. A draft uses the shop's VAT rate (Settings); marking the
     quote as sent freezes the rate on the quote.
   ```
2. §3.8 Settings, **Pricing** table: after the "Default markup" row add
   `| VAT rate (%) | 22 | 0–100; applied to the quote's net total; frozen on each quote when it is sent |`, and in the
   **Quotes** table change the PDF terms example to `"Delivery …"` (VAT is now shown, not assumed).
3. §6 PDF: replace content item 5 with "Net total, VAT (rate) and total incl. VAT, in the shop currency."; add after
   "File name": "The Export PDF button is available in every status once every item has a price; it opens a dialog to
   choose the language."
4. §10 Open questions: delete the **VAT** and **PDF generation** bullets.

- [ ] **Step 2: Web app guide and product overview**

In `docs/frontend/web-app.md`, in **Quotes** (after the **Pricing** bullet) add:

```markdown
- **PDF:** `ExportPdfDialog` (`src/pdf/`) builds a `QuotePdfData` with `toQuotePdfData` (pure: translated and
  formatted in the chosen language, VAT included), renders it with `QuotePdf` (`@react-pdf/renderer`) and downloads
  it. The renderer is a context (`usePdfRenderer`) whose real implementation lazy-loads react-pdf, so the library is a
  separate chunk fetched on the first export. Tests get a `FakePdfRenderer` (`renderApp(...).pdf`, with `rendered` and
  `failWith`); `QuotePdf.render.test.ts` renders the real thing in a Node environment and reads the text back with
  `pdfjs-dist`. The PDF uses the built-in Helvetica: Western European letters and € print correctly, other scripts
  (Cyrillic, Greek…) don't until a font is embedded.
- **VAT:** `settings.vat_rate_pct` is the shop rate; `mark_quote_sent` copies it onto the quote. `vatRateFor` and
  `quoteTotals` (`src/data/quote-rules.ts`) work in integer cents; the editor's totals and the PDF use them.
```

and in **Not done yet** replace the **PDF export** bullet with nothing (delete it); add the build-size note:
"- **Bundle size** — … (the PDF library is its own lazy chunk, ~<size from Task 6> kB)" by editing the existing
**Bundle size** bullet.

In `docs/product/overview.md`, workflow step 7 stays as is (it already says PDF); no change needed.

In the spec, change `- **Status:** Draft — awaiting review` to `- **Status:** Implemented`.

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
- `supabase test db` passes all 14 files;
- `supabase db diff` prints `No schema changes found`;
- `check:types-fresh` says the types are up to date.

- [ ] **Step 4: Manual smoke check in the browser**

With `supabase start` running, run `npm run dev` and sign in as `owner@3dquote.local` / `password123`:

1. Settings → Pricing: the VAT rate shows 22; change it to 23 and save, then back to 22.
2. Open a draft quote with a priced item (create one and simulate the slice as in the web app guide): the totals show
   Net / VAT (22 %) / Total incl. VAT.
3. Export PDF → Italiano → Download. Open the file: check the layout, the BOZZA watermark, the VAT lines, the file
   name `Q-<year>-…-<client>.pdf`. Repeat with English.
4. Add a logo in Settings (PNG, then SVG) and export again: the logo is on the PDF.
5. Mark the quote as sent. Change the Settings rate to 23. Reopen the quote: it still shows 22 %; the PDF has no
   watermark and shows 22 %. Restore the rate.
6. Check the browser's network panel: the react-pdf chunk is requested only when the dialog's Download is first
   pressed.

Note anything that differs from the spec in the final report rather than fixing it silently.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: document the VAT rate and the PDF export"
```

## Not done yet

- Applying the `vat_rate` migrations to the cloud project (done through the Supabase MCP, only when asked).
- Per-quote or per-client VAT exemptions, emailing or storing PDFs, embedded fonts for non-Western scripts.
