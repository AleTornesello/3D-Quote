# Pricing & Duplicate — Design

- **Date:** 2026-10-12
- **Status:** Draft — awaiting review
- **Branch:** `develop`

## Goal

Price quote items and duplicate quotes on the server, so the web quotes work (the next spec) has real prices to show
and a way to revise a sent quote. The rules come from the
[functional analysis](../../frontend/functional-analysis.md):

| Area | Section |
|---|---|
| Duplicate | §4 |
| Pricing formula, rounding, what is stored | §5.1–5.3, §5.5 |

The quotes work is split in sub-projects, each with its own spec and plan:

1. **This spec:** pricing and duplicate.
2. Web quotes: list, New quote, editor with uploads, slicing status, overrides and lifecycle.
3. The slicer worker.
4. The quote PDF.

## Decisions

| Concern | Choice |
|---|---|
| Where pricing runs | An Edge Function, as [ADR-0003](../../architecture/adr/0003-database-schema-and-security.md) decided |
| When pricing runs | The web app calls it after each change it makes, after Realtime reports a finished slice, and from **Recalculate prices**. Nothing prices a quote that nobody has open |
| Arithmetic | Exact fractions over `BigInt`, no dependency. Print time arrives in seconds, so hours are not finite decimals (1 000 s = 0.2777… h) |
| Price writes | Service role, guarded by the item's `updated_at`, so a stale computation never overwrites a newer change |
| Duplicate files | Copied server-side into the new quote's folder (`model_path` is unique and must start with the quote id) |
| Duplicate results | Copied with a `succeeded` job, so nothing re-slices |
| Duplicate overrides | The markup override and every item's price override (with its reason) are kept |
| Tooling | Deno (`deno test`, `check`, `lint`, `fmt`) for `supabase/functions` |

## Edge Functions

Both live in `supabase/functions/`, are called by the web app with the user's JWT, and use the service role for
reads and writes after checking the caller.

```
supabase/functions/
├── deno.json                  # imports (@supabase/supabase-js), fmt/lint settings, test task
├── _shared/
│   ├── pricing.ts             # pure: Fraction, priceItem()
│   ├── price-quote.ts         # priceQuote(client, quoteId): load, compute, guarded writes
│   ├── auth.ts                # requireStaff(req): caller from the JWT, active staff row
│   ├── http.ts                # CORS, JSON responses, HttpError → { code }
│   └── clients.ts             # service client from the runtime environment
├── price-quote/index.ts
├── duplicate-quote/index.ts
└── tests/                     # pricing unit tests, integration tests against the local stack
```

### Shared pieces

- **`pricing.ts`** has no I/O. `Fraction` holds a `BigInt` numerator and denominator and offers `add`, `mul`, `div`,
  `max`, `fromDecimal(string)` and `roundHalfUp(places) → string`. `priceItem(input)` takes the inputs of §5.1 as
  decimal strings (as PostgREST returns `numeric`) plus `print_time_s` and `quantity`, and returns the stored
  columns as decimal strings:
  - `material_cost`, `machine_cost`, `energy_cost`, `failure_cost`, `setup_fee`, `markup_amount`: rounded half up
    to 4 places;
  - `markup_pct`: the percentage used;
  - `computed_total`: `max(production_cost + markup, minimum_price)` from the full-precision values, rounded half up
    to 2 places.

  As in §5.2, `material_cost`, `machine_cost`, `energy_cost` and `failure_cost` are **per copy**;
  `setup_fee` and `markup_amount` are per item, so the production cost is
  `(material + machine + energy + failure) × quantity + setup_fee`. Overrides are not an input: `item_total` is a generated column.
- **`auth.ts`** reads the bearer token, calls `auth.getUser(token)` with the service client and requires a `staff`
  row with `active = true`. It returns the caller's `user_id`.
- **`http.ts`** answers `OPTIONS` with the CORS headers, adds them to every response, and turns an `HttpError` into
  `{ "code": "<code>" }` with its status. Anything else becomes 500 `internal_error`, logged with `console.error`.

### `price-quote`

`POST /functions/v1/price-quote` with `{ "quote_id": <bigint> }`.

1. No token or an invalid one → **401 `not_authenticated`**. No active staff row → **403 `not_staff`**. The caller
   is checked before the body is read.
2. A method other than `POST`, or a body without a positive integer `quote_id` → **400 `invalid_request`**.
3. Load the quote → missing: **404 `quote_not_found`**; status not `draft`: **409 `quote_not_draft`**.
4. Load `settings` and the quote's items joined to their printer and material.
5. Each item with a printer, a material, `print_time_s` and `filament_g` is priced with:
   - `cost_per_kg` from the material; `hourly_rate` and `power_w` from the printer, even if inactive;
   - `energy_price_kwh`, `failure_allowance_pct`, `setup_fee`, `minimum_item_price` from settings;
   - `markup_override_pct` from the quote, otherwise `default_markup_pct`.

   The other items are `skipped` and keep their (cleared) breakdown.
6. Each write is `update quote_items set <breakdown>, priced_at = now() where id = ? and updated_at = ?` with the
   `updated_at` that was read. Zero rows: the item changed meanwhile → `skipped`. `override_total` and
   `override_reason` are never written.
   - A markup override change is covered, because `set_markup_override` clears every item and so changes its
     `updated_at`.
   - A change to settings, printers or materials is not: those prices stay until the next call or Recalculate.
7. The quote sent meanwhile → `quote_items_guard` raises `quote_not_draft` → **409 `quote_not_draft`**.
8. **200 `{ "priced": n, "skipped": m }`**.

The work of steps 3–7 is `priceQuote(client, quoteId)` in `_shared/price-quote.ts`, which `duplicate-quote` reuses.

### `duplicate-quote`

`POST /functions/v1/duplicate-quote` with `{ "quote_id": <bigint> }`.

1. Steps 1–2 of `price-quote`. Load the source quote in any status → missing: **404 `quote_not_found`**.
2. `service_create_quote_copy(source_id, caller)` → `new_id`.
3. Copy each item's file, in item id order, to `<new_id>/<uuid>/<file name>` with Storage `copy` (no download).
   The file name is the last segment of the source `model_path`, which is already a valid storage key.
4. `service_copy_quote_items(source_id, new_id, files)` inserts the items and their jobs in one transaction.
5. If step 3 or 4 fails: remove the objects already copied, delete the new quote (allowed: it's a draft; its items
   cascade), log the cause, and answer **500 `duplicate_failed`**. Nothing is left half-copied.
6. `priceQuote(service client, new_id)`. A failure here is logged and ignored: the quote is valid and gets priced on
   the next change or Recalculate.
7. **201 `{ "quote_id": new_id }`**.

## Schema change: service functions

Both follow the worker-function pattern: a `security invoker` wrapper in `public` calls a `security definer`
function in `private` with `set search_path = ''`. EXECUTE goes to `service_role` only. They are declared in a new
`supabase/schemas/22_service_api.sql`. The grants go in `90_grants.sql` plus a hand-written migration, next to the
generated one.

| Function | Does |
|---|---|
| `service_create_quote_copy(source_id bigint, created_by uuid) → bigint` | Raises `quote_not_found` if the source doesn't exist. Inserts a draft with the source's `client_id`, `notes` and `markup_override_pct`, `created_by` as given, and the default `valid_until`. The numbering trigger assigns the number. Returns the new id. |
| `service_copy_quote_items(source_id bigint, new_id bigint, files jsonb) → void` | `files` is `[{ "item_id": …, "model_path": … }]`, one entry per source item. It checks that the target is a draft quote (`quote_not_draft`), that the entries match the source's items exactly (`invalid_copy`), that each path starts with `<new_id>/` (`invalid_model_path`), and that each object exists in `models` (`model_not_found`). It then copies each item, in id order: description, file name, printer, material, quantity, layer height, infill, supports, results (`print_time_s`, `filament_g`, bbox) and `override_total` / `override_reason`. The price breakdown is not copied. |

Jobs for the copied items:
- source item with results → one `succeeded` job with the item's results, plus `filament_mm`, `layer_count`,
  `slicer_version` and `attempts` from the source's newest succeeded job (when there is one), and `queued_at`,
  `started_at` and `finished_at` set to `now()`;
- source item without results, with a printer and a material → `private.enqueue_slicing_job` (row and message);
- otherwise → no job.

New error message: `invalid_copy` (`22023`).

## Errors for the web app

Edge Functions answer `{ "code": … }`. New codes: `not_authenticated` (401), `invalid_request` (400),
`duplicate_failed` (500), `internal_error` (500). `not_staff`, `quote_not_found` and `quote_not_draft` keep their
existing meaning. Mapping them in `toAppError` is part of the web quotes spec.

## Testing

**Unit (`supabase/functions/tests/pricing.test.ts`):**
- the §5.3 worked example: material 3.0000, machine 8.2500, energy 0.1980, failure 1.1448, setup 5.0000, markup
  9.0557, computed total 39.24;
- half-up rounding: a total of exactly `x.xx5` rounds up, one just below it (`x.xx4999…`) rounds down;
- the minimum price wins when the total falls below it;
- the setup fee is the same for quantity 1 and 10;
- a markup override is used instead of the default;
- a fraction of an hour is priced exactly: 1 200 s (⅓ h) at 0.03/h plus 50 % is 0.015, which rounds to 0.02
  where floats give 0.01.

**Integration (`supabase/functions/tests/*.integration.test.ts`)**, against `supabase start`. They sign in as the
seeded owner and operator, create an authenticated non-staff user through the admin API (removed afterwards) and set
up quotes and results through the service role:
- `price-quote`:
  - prices sliced items, skips unsliced ones and keeps overrides;
  - 409 on a sent quote, 404 on an unknown one, 403 for a non-staff user, 401 without a token, 400 on a bad body;
  - an item changed between read and write is skipped (pinned by calling `priceQuote` with a stale snapshot).
- `duplicate-quote`:
  - a sent quote becomes a new numbered draft by the caller;
  - files are copied under the new id, results and overrides kept, unsliced items queued, and the quote priced;
  - an operator can duplicate;
  - a forced failure (a source object removed beforehand) answers `duplicate_failed` and leaves no new quote and no
    new objects.

**pgTAP (`supabase/tests/database/11_service_quote_copy.test.sql`):**
- `authenticated` and `anon` can't execute either function;
- the copy carries client, notes and markup override, assigns a new number and the default validity;
- items carry settings, results and overrides but no breakdown;
- sliced items get a `succeeded` job; an unsliced item with printer and material gets a queued job and a message;
- `invalid_copy`, `invalid_model_path`, `model_not_found` and a non-draft target are rejected.

**Done means** from the repo root:
- the existing checks: `npm run build`, `npm run lint`, `npm run format:check`, `npm test`, `supabase test db`,
  `supabase db diff` ("No schema changes found"), `npm run check:types-fresh`;
- `npm run functions:check` (`deno check`, `deno lint`, `deno fmt --check`) and `npm run functions:test`
  (`deno test`, which needs `supabase start`).

## Docs

- **New ADR-0004 "Pricing and duplication in Edge Functions":**
  - the web app calls pricing, which settles the open "when" question;
  - exact fractions instead of floats;
  - duplicate copies files and results.
- **`architecture/overview.md`:** the sequence diagram's last step and the open question it points to.
- **`supabase/data-model.md`:** the service functions, `invalid_copy`.
- **New `supabase/edge-functions.md`:** both endpoints, their codes and how to run them locally.
- **`development/getting-started.md`:** install Deno; the `functions:*` commands.
- **`docs/README.md`:** link the new page and ADR.

## Out of scope

- Calling these functions from the web app, and mapping their codes (web quotes spec).
- The quotes list, the editor and Realtime.
- Removing orphaned files in `models`.
- Deploying the functions to the cloud project.

## Git

Commit on `develop`; never push or merge to `main`. Never touch the cloud Supabase project.
