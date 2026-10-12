# Web App: Quotes — Design

- **Date:** 2026-10-13
- **Status:** Draft — awaiting review
- **Branch:** `develop`

## Goal

Build the quotes screens on the [schema](2026-10-11-supabase-schema-design.md) and the
[pricing and duplicate functions](2026-10-12-pricing-duplicate-design.md):

- the quotes list (home) and the New quote sheet;
- the quote editor: header and lifecycle actions, model uploads, item settings, live slicing status, prices with
  their breakdown, owner overrides, duplicate and delete;
- calling `price-quote` and `duplicate-quote`, and mapping their codes in `toAppError`.

The screens follow the [functional analysis](../../frontend/functional-analysis.md):

| Area | Section |
|---|---|
| Permission matrix | §1 |
| Quotes list | §3.2 |
| New quote | §3.3 |
| Quote editor | §3.4 |
| Lifecycle | §4 |
| Pricing rules | §5 |
| Slicing as the user sees it | §7 |
| Languages, devices, accessibility | §8 |

PDF export (§6) is the next spec.

## Decisions

| Concern | Choice |
|---|---|
| List data | A `security_invoker` view `quotes_list`, queried with PostgREST filters, order and `range` |
| Live slicing status | Supabase Realtime `postgres_changes` on `quote_items` and `slicing_jobs`; events only trigger a refetch |
| Who prices after a slice | The open editor calls `price-quote` when it sees an item with results and no price |
| Uploads | `tus-js-client` against `/storage/v1/upload/resumable`: progress events and resume after a dropped connection |
| Item edits | Saved on change: selects and switches at once, text and number fields on blur or Enter |
| Quote details | Edited in a `FormSheet` (Edit details), like the catalog screens |
| Action feedback | shadcn `sonner` toasts for one-shot actions; field errors stay next to their fields |
| File size on the item card | Not shown: it isn't stored on the item (deviation from §3.4, see [Docs](#docs)) |

## Database changes

Local only. Nothing else in the schema changes: every item and lifecycle function the editor needs already exists.

### `quotes_list` view

Declared in a new `supabase/schemas/08_quotes_list.sql`; the migration is generated with `supabase db diff`.

```sql
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
  coalesce(i.item_count, 0) as item_count,
  case when i.item_count > 0 and i.unpriced_count = 0 then i.total end as total
from public.quotes q
join public.clients c on c.id = q.client_id
join public.staff s on s.user_id = q.created_by
left join lateral (
  select
    count(*)::integer as item_count,
    count(*) filter (where qi.item_total is null)::integer as unpriced_count,
    sum(qi.item_total) as total
  from public.quote_items qi
  where qi.quote_id = q.id
) i on true;
```

- `security_invoker = true`, so the caller's RLS on `quotes`, `clients`, `staff` and `quote_items` applies: a user
  who isn't active staff sees no rows.
- `total` is null when the quote has no items or any item is unpriced; the list shows "—".
- `created_on` is the creation date in shop time, so the date filter matches what the list shows.
- Grants: `90_grants.sql` already gives `authenticated` `select` and `service_role` `all` on every relation in
  `public`, views included; a comment there names the view. The setup migration below repeats the grants explicitly,
  because the generated migration doesn't carry them.

### Setup migration

`supabase migration new quotes_list_setup`, hand-written, like the earlier `_setup` migrations (the declarative diff
captures neither grants nor publication changes):

```sql
-- Grants for quotes_list, mirrored in supabase/schemas/90_grants.sql.
revoke all on public.quotes_list from public, anon, authenticated;
grant select on public.quotes_list to authenticated;
grant all on public.quotes_list to service_role;

-- Live slicing status in the quote editor. Realtime applies each table's select RLS to subscribers.
alter publication supabase_realtime add table public.quote_items, public.slicing_jobs;
```

Only active staff receive events, because `quote_items` and `slicing_jobs` are readable only by staff. The
[data model](../../supabase/data-model.md) records the publication, since it lives in a migration and not in
`supabase/schemas/`.

### Tests (pgTAP)

`supabase/tests/database/12_quotes_list.test.sql`:

- a quote with two priced items has `total` = their sum and `item_count` = 2;
- one unpriced item makes `total` null; no items gives `item_count` 0 and `total` null;
- an override counts through `item_total`;
- `created_on` is the Europe/Rome date (a quote created at 23:30 UTC is the next day);
- a user without an active staff row selects no rows;
- `anon` has no `select`;
- `pg_publication_tables` lists `quote_items` and `slicing_jobs` in `supabase_realtime`.

The web app's types are regenerated (`npm run gen:types`).

## Files in `models`

Upload path: `<quote_id>/<crypto.randomUUID()>/<original filename>`, as the data model requires.

The web app removes files on a best-effort basis; a failed removal leaves an orphan for the cleanup job (out of
scope) and never fails the user's action:

| When | What happens |
|---|---|
| Upload finished, `create_quote_item` failed | The object is removed at once |
| Remove item | Delete the row, then remove its object |
| Delete quote (owner, draft) | Read the items' `model_path`s, delete the quote (items cascade), then remove those objects |

The storage rules already allow each step: the draft folder is changeable, and so is the folder of a deleted quote.

## Routes

| Path | Page |
|---|---|
| `/quotes` | `QuotesPage` (replaces the section placeholder) |
| `/quotes/new` | `QuotesPage` with the New quote sheet open; `?client=<id>` pre-selects that client. Closing the sheet navigates to `/quotes` |
| `/quotes/:id` | `QuoteEditorPage`; an unknown or non-numeric id shows the not-found state used by `ClientDetailPage` |

## Quotes list

`QuotesPage`, data from `quotes_list`.

**Columns**

| Column | Content |
|---|---|
| Number | `number` |
| Client | `client_name`, with `client_company` in muted text when present |
| Status | Badge with text; one style per status |
| Total | Money in the shop currency, or `—` when `total` is null |
| Created | Date, and "by `created_by_name`" |
| Valid until | Date. For a `sent` quote whose `valid_until` is between shop today and shop today + 7 days: an icon and the text "Expires soon" beside the date (not colour alone) |

Click a row to open `/quotes/:id`.

**Search, filters, sort, pages.** All of it lives in the URL so it survives reloads and the back button:

| Param | Meaning | Query |
|---|---|---|
| `q` | Search, debounced like Clients and passed through `sanitizeSearch` | `or(number.ilike.%q%,client_name.ilike.%q%,client_company.ilike.%q%)` |
| `status` | Comma-separated statuses (checkbox list in a popover) | `in('status', …)` |
| `client` | Client id (a select fed by an id + name client list) | `eq('client_id', …)` |
| `from`, `to` | Created date range, both inclusive (`yyyy-mm-dd`) | `gte('created_on', from)`, `lte('created_on', to)` |
| `sort` | `number`, `created`, `valid_until`, `total` | `number` orders by `number_year`, `number_seq`; `total` puts nulls last |
| `dir` | `asc` or `desc` | default: `created`, `desc` |
| `page` | 1-based | `.range((page − 1) × 25, page × 25 − 1)` with `count: 'exact'` |

- Changing the search, a filter or the sort resets `page` to 1. Unknown or malformed params fall back to their
  defaults; a page past the end (PostgREST answers `PGRST103`) goes back to page 1.
- **Clear filters** removes `q`, `status`, `client`, `from` and `to`.
- Footer: "1–25 of 312" with Previous and Next.
- `DataTable` gains two opt-in props: sortable column headers (`aria-sort`, a button in the header) and a pagination
  footer. Existing tables don't pass them and don't change.

**States**
- Loading: skeleton rows.
- Empty with no filters: "No quotes yet" and a New quote button.
- Empty with filters: "No quotes match these filters" and Clear filters.
- Error: the existing `DataTable` error with Retry, keeping cached rows.

## New quote

`NewQuoteSheet`, a `FormSheet` opened by **New quote** (and by `/quotes/new`).

| Field | Rules |
|---|---|
| Client | Required. A searchable picker (shadcn Popover + Command) using `useClients(search)`. Its last option, **New client**, opens the existing `ClientSheet` on top; the saved client becomes the selection |
| Valid until | Required. Date input, default shop today + `settings.default_validity_days`; must be shop today or later |
| Notes | Optional |
| Markup override % | Owner only. Optional, `numberField()` with `>= 0` and the column's limits |

Save:

1. insert `client_id`, `valid_until`, `notes` into `quotes` with `.select('id').single()`;
2. if a markup was given, `set_markup_override(quote_id, pct)`;
3. navigate to `/quotes/:id`.

If step 2 fails, the quote exists: the editor opens and a toast says the markup wasn't saved.

"Shop today" in the browser is the current date in `Europe/Rome` (`Intl.DateTimeFormat` with `timeZone`), a new
`shopToday()` helper in `src/lib/format.ts`.

## Quote editor

`QuoteEditorPage`: header, items, totals. Controls that change something appear only while the quote is `draft`;
otherwise the same data is shown read-only. Owner-only controls are hidden from operators.

### Header

Shows the number, status badge, client (link to `/clients/:id`), "created by `<name>` on `<date>`", valid until,
notes, and the markup in effect: "30 % (default)" from settings or "35 % (override)".

**Edit details** (draft) opens `QuoteDetailsSheet`: client picker, valid until, notes, and (owner) markup override.
Save updates the quote's columns that changed; then, if the markup changed, calls `set_markup_override` and prices the
quote. A cleared markup field sends `null`.

**Actions**

| Status | Actions |
|---|---|
| Draft | Mark as sent, Duplicate, Delete (owner) |
| Sent | Mark accepted, Mark rejected, Duplicate |
| Accepted, Rejected, Expired | Duplicate |

- **Mark as sent** opens a dialog that loads `get_quote_send_blockers`.
  - With blockers it lists each in words, naming the item by its description: "Bracket: doesn't fit on MK4 #2".
    Codes `not_draft`, `no_items` and `valid_until_past` have no item.
  - Without blockers: "Mark `<number>` as sent? Prices will be frozen." Confirm calls `mark_quote_sent`.
  - While any item is queued or slicing the button is disabled with the hint "Wait for slicing to finish".
  - `quote_not_sendable` (a change landed in between) reloads the blockers in the open dialog.
- **Mark accepted / Mark rejected**: a confirmation dialog, then `mark_quote_accepted` / `mark_quote_rejected`.
- **Duplicate**: calls `duplicate-quote`, then navigates to the new quote with a toast "Copy created".
- **Delete** (owner, draft): `ConfirmDeleteDialog` naming the number; deletes the quote, removes its files, navigates
  to `/quotes`.

After any action the quote, its items and the list are invalidated.

### Adding items (draft)

- A drop zone and a **Choose files** button (`<input type="file" multiple accept=".stl,.3mf">`). Drag and drop is an
  extra, never the only way.
- `validateModelFile(file)` checks, in order: extension `.stl` or `.3mf` (case-insensitive), size > 0, size ≤ 100 MB.
  Rejected files are listed with the reason and a Dismiss button; nothing is uploaded for them.
- Each accepted file gets an upload row: name, progress bar (`role="progressbar"` with its value), **Cancel**. At
  most 3 uploads run at once; the rest wait in order.
- A failed upload shows its error, **Retry** (reuses the in-memory `File` and a new path) and **Dismiss**.
- When an upload finishes the web app calls `create_quote_item` with:
  - `description`: the file name without its extension;
  - `printer_id`, `material_id`: those of the newest item (highest id) that has both, when both are still active;
    otherwise null;
  - the remaining arguments at their defaults.
  The upload row disappears once the item appears in the list.
- Leaving the page while uploads are running or waiting asks first: "Uploads in progress will be cancelled". The
  existing `useLeaveGuard` is reused.
- Upload state lives in the page (it is not server state); it is lost on reload, like any unfinished upload.

### Item card

| Part | Content |
|---|---|
| Description | Inline input; saved on blur or Enter when changed; can't be blank (the old value comes back with an error) |
| File | Original file name and **Download**, which creates a 60-second signed URL when clicked |
| Settings | Printer, material, quantity, layer height (mm), infill (%), supports |
| Slicing | One state, below |
| Price | Below |
| Remove | **Remove item**, confirmation naming the description |

**Settings**
- Printer options: active printers, plus the item's current printer marked "(inactive)" when it has been deactivated.
  Material options: the same rule; each shows its type and colour.
- Printer, material and supports save immediately through `update_quote_item_settings`, which receives all five
  slicing inputs (the current values with the one change).
- Layer height (`> 0`, `< 10`, two decimals) and infill (integer 0–100) are `numberField()` text fields. They save on
  blur or Enter when valid and changed. An invalid value shows the field error and isn't saved.
- Quantity (integer ≥ 1) saves on blur or Enter through a `quote_items` update, then the quote is priced.
- While a card is saving, its controls are disabled. A failed save restores the server value and shows the error
  next to the field (or as a toast for selects and the switch).

**Slicing state** — `slicingState(item, now)`, from the item and its newest job:

| State | When | Shows |
|---|---|---|
| `waiting` | No printer or no material | "Choose printer and material" |
| `queued` | Newest job `queued` | "Waiting to slice" with a spinner |
| `slow` | Newest job `queued` for more than 10 minutes since `queued_at` | "Slicing is taking longer than usual" |
| `slicing` | Newest job `running` | "Slicing…" with a spinner and the elapsed time since `started_at`, updated every second |
| `done` | Item has `print_time_s` | Print time per copy (h:mm), filament per copy (g), bounding box X × Y × Z (mm) |
| `failed` | Newest job `failed` | "Slicing failed", the job's `error`, and **Retry** (`retry_slicing`) |

An item with printer and material but no job and no results (not expected) shows `queued`.

**Fit.** `fitsPrinter(item, printer)` is false when any bounding-box axis exceeds the printer's build volume on the
same axis. The card then shows "Doesn't fit on `<printer name>`" with a warning icon.

**Price**
- Item total and unit price (`item_total / quantity`, rounded half up to 2 decimals).
- "Calculating…" while the item has results but no `priced_at`, and "Price not calculated" once automatic pricing
  gave up (below).
- An expandable **Price breakdown**: material, machine, energy, failure allowance, setup fee, markup (with
  `markup_pct`), computed total. Values are full precision, shown with 2 decimals.
- Owner, draft: **Override price** opens a dialog with total (`>= 0`) and reason (required) and calls
  `set_price_override`. With an override the breakdown shows "Overridden: 45.00 (computed 39.24)", the reason (staff
  only), and **Remove override** (`clear_price_override`). Operators see the override and reason read-only.

### Totals

- The sum of `item_total` in the shop currency, `—` while any item is unpriced or there are none.
- "Prices net of VAT".
- **Recalculate prices** (draft) calls `price-quote`.
- Empty state over the drop zone: "Add model files to start".

## Data layer

| Module | Exports |
|---|---|
| `data/quotes.ts` | `useQuotesList(params)`, `useQuote(id)`, `useCreateQuote()`, `useUpdateQuote()`, `useSetMarkupOverride()`, `useDeleteQuote()`, `useSendBlockers(id, enabled)`, `useMarkQuote()` (sent, accepted, rejected), `useDuplicateQuote()`, `usePriceQuote()` |
| `data/quote-items.ts` | `useQuoteItems(quoteId)`, `useCreateQuoteItem()`, `useUpdateItemSettings()`, `useUpdateItem()` (description, quantity), `useRemoveItem()`, `useRetrySlicing()`, `useSetPriceOverride()`, `useClearPriceOverride()` |
| `data/clients.ts` (addition) | `useClientOptions()`: `id, name, company` of every client, ordered by name, for the list's client filter |
| `data/edge-functions.ts` | `invokeFunction(supabase, name, body)` |
| `data/model-upload.ts` | `ModelUploaderProvider`, `useModelUploader()` |
| `data/quote-rules.ts` | `slicingState`, `fitsPrinter`, `validateModelFile`, `unpricedItems`, `defaultCatalogChoice`, `parseQuoteListParams`, `toQuoteListSearch` |

- `useQuote(id)` selects `*, client:clients(id, name, company), creator:staff(display_name)`.
- `useQuoteItems(quoteId)` selects `*, job:slicing_jobs(id, status, error, queued_at, started_at, finished_at)`,
  ordered by item `id`, with the embed ordered `id desc` and limited to 1 (supabase-js `referencedTable` options,
  as in `useClients`).
- `invokeFunction` calls `supabase.functions.invoke(name, { body })`. On a `FunctionsHttpError` it reads
  `{ code }` from `error.context.json()` and passes `{ code, status }` to `toAppError`; a `FunctionsFetchError` is a
  network error.
- `useModelUploader()` returns `upload(file, path, { onProgress, signal }): Promise<void>`. The default
  implementation uses `tus-js-client` with:
  - endpoint `<VITE_SUPABASE_URL>/storage/v1/upload/resumable`;
  - headers `authorization: Bearer <access token>` (read from `getSession()` before each upload) and
    `apikey: <publishable key>`;
  - metadata `bucketName: 'models'`, `objectName: path`, `contentType: file.type || 'application/octet-stream'`;
  - `chunkSize` 6 MB (required by Supabase), `retryDelays [0, 3000, 5000, 10000]`, `removeFingerprintOnSuccess`;
  - `signal` aborts the upload.
  `AppProviders` mounts the provider; `renderApp` mounts a fake.
- Query keys are added to `query-keys.ts`: `quotesAll`, `quotesList(params)`, `quote(id)`, `quoteItems(id)`,
  `sendBlockers(id)`.

### Live updates

`useQuoteLiveUpdates(quoteId, itemIds)`, used by the editor while it is mounted:

- one channel `quote-<id>` with two `postgres_changes` listeners (`event: '*'`):
  - `quote_items`, filter `quote_id=eq.<id>`;
  - `slicing_jobs`, filter `quote_item_id=in.(<ids>)` (only while there is at least one item);
- the channel is rebuilt when the sorted set of item ids changes, and removed on unmount;
- every event invalidates `quoteItems(id)`, debounced 250 ms; payloads are not merged into the cache;
- each `SUBSCRIBED` status after the first invalidates `quoteItems(id)` as well, to catch events missed while
  disconnected.

The quote row itself is not live; it refetches on window focus and after every action.

### Automatic pricing

`useAutoPrice(quote, items)`:

- `unpricedItems(items)` are the items with a printer, a material, `print_time_s` and no `priced_at`.
- When a draft has any, the editor calls `price-quote`. Only one call per quote runs at a time; a trigger during a
  call queues exactly one more call after it.
- After a call the items are refetched. If an item that needed pricing still does and the answer had `skipped > 0`,
  the hook calls once more; if it still does after that, it stops for those items (identified by id and
  `updated_at`) and their cards show "Price not calculated". A later change to such an item (new `updated_at`)
  makes it eligible again.
- **Recalculate prices** always calls, whatever the items look like. A saved quantity or markup needs no explicit
  call: both writes clear the items' `priced_at` and change their `updated_at`, so the automatic rule prices them and
  makes a given-up item eligible again.
- A failed call shows a toast with Retry. `notDraft` refetches the quote instead.

## Errors

`toAppError` gains these mappings. Messages are i18n keys in both catalogs.

| Source | Code / message | Kind | Message key |
|---|---|---|---|
| Postgres `P0001` | `quote_not_draft` | `notDraft` (new) | `errors.notDraft` |
| Postgres `P0001` | `quote_not_sendable` | `notSendable` (new) | `errors.notSendable` |
| Postgres `P0001` | `quote_not_sent` | `invalid` | `errors.quoteNotSent` |
| Postgres `P0001` | `retry_not_allowed` | `invalid` | `errors.retryNotAllowed` |
| Postgres `P0002` | `quote_not_found`, `item_not_found` | `notFound` | `errors.notFound` |
| Postgres `P0002` | `model_not_found` | `notFound` | `errors.modelNotFound` |
| Postgres `22023` | `printer_inactive`, `material_inactive` | `invalid` | `errors.printerInactive`, `errors.materialInactive` |
| Postgres `22023` | `invalid_override`, `invalid_markup` | `invalid` | `errors.invalidOverride`, `errors.invalidMarkup` |
| Edge Function | `not_authenticated` | `sessionExpired` (new) | `errors.sessionExpired` |
| Edge Function | `not_staff` | `forbidden` | `errors.forbidden` |
| Edge Function | `quote_not_found` | `notFound` | `errors.notFound` |
| Edge Function | `quote_not_draft` | `notDraft` | `errors.notDraft` |
| Edge Function | `duplicate_failed` | `unknown` | `errors.duplicateFailed` |
| Edge Function | `invalid_request`, `internal_error` | `unknown` | `errors.unknown` |
| Upload | network failure | `network` | `errors.network` |
| Upload | HTTP 403 | `notDraft` | `errors.uploadNotAllowed` |
| Upload | HTTP 413 | `invalid` | `errors.fileTooLarge` |

Edge Function codes are recognised from the `{ code, status }` that `invokeFunction` passes, so they never collide
with Postgres messages. Upload errors are mapped inside the uploader from the tus error's `originalResponse` status.

When a `notDraft` error reaches the editor it refetches the quote, so the page turns read-only.

## i18n

Every new string goes in both `it.json` and `en.json`: statuses, column headers, filters, sort labels, slicing
states, send-blocker codes, breakdown lines, upload rejections and errors, toasts, dialogs. Durations use h:mm;
grams and millimetres use `useFormat()` numbers.

## Testing

**Database:** the pgTAP file in [Database changes](#tests-pgtap).

**Unit tests**
- `quote-rules.test.ts`: every `slicingState` row (including `slow` at 10 minutes and the elapsed time); `fitsPrinter`
  per axis; `validateModelFile` (extension case, empty, 100 MB boundary); `unpricedItems`; `parseQuoteListParams`
  round-trips with `toQuoteListSearch` and falls back on bad input.
- `errors.test.ts`: every new row of the [errors](#errors) table.
- `format.test.ts`: `shopToday()` around midnight UTC.

**Test fake extensions** (`src/test/`)
- `renderApp({ functions })`: handlers for `supabase.functions.invoke`, recorded in `db.calls`; a handler may return
  an HTTP error with a `{ code }` body.
- A fake `channel()`: records subscriptions and filters; tests call `realtime.emit(table, event)` and
  `realtime.reconnect()`.
- Storage: `list`, `remove` and `createSignedUrl` recorded.
- A fake uploader: tests see each started upload and resolve it, fail it or report progress.

**Page tests**

| File | Covers |
|---|---|
| `QuotesPage.test.tsx` | Columns, `—` total, "Expires soon"; search, status, client and date filters reach the query and the URL; sort headers; pages and "1–25 of N"; both empty states; row opens the editor; `/quotes/new?client=` opens the sheet with the client selected |
| `NewQuoteSheet.test.tsx` | Required fields; default valid-until; creates and navigates; markup field owner-only and calls `set_markup_override`; markup failure still opens the editor; New client from the picker |
| `QuoteEditorPage.test.tsx` | Header and markup in effect; actions per status and role; send blockers listed and confirm; duplicate navigates; delete removes files and navigates; Edit details |
| `QuoteItems.test.tsx` | File rejection; upload progress, retry and `create_quote_item` with the previous item's printer and material; cancel; settings saves send all five inputs; quantity save prices; every slicing state; a Realtime event refetches; auto-price called once and gives up after a retry; override owner-only; remove item removes the file; sent quote read-only |

**Manual smoke check.** With the local stack running, create a quote, upload an STL and set printer and material.
The worker doesn't exist yet, so simulate a slice with SQL as `service_role` (`worker_claim_job` then
`worker_complete_job` with results); the card should switch to Done without reloading and then show a price.

## Docs

- `docs/frontend/web-app.md`: the quotes pages and modules, uploads (tus), Realtime, automatic pricing, the new
  `renderApp` options; quotes removed from "Not done yet"; the SQL snippet that simulates a slice locally.
- `docs/frontend/functional-analysis.md` §3.4: the item card shows the file name, not its size.
- `docs/supabase/data-model.md`: `quotes_list`, its grant, and the Realtime publication.
- `docs/supabase/edge-functions.md`: the web app calls both functions through `invokeFunction`.
- This spec's status becomes Implemented.

## Out of scope

- PDF export (next spec);
- the slicer worker;
- deploying functions or migrations to the cloud project;
- orphaned file cleanup;
- notifications for failed slices on other pages;
- staff invites;
- route code-splitting;
- Playwright.

## Git

All commits go on `develop`. Merging to `main` and pushing are separate steps, done only when asked.
