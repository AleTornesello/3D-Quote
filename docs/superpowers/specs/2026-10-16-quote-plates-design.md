# Quote plates — Design

- **Date:** 2026-10-16
- **Status:** Draft, awaiting review
- **Branch:** `develop`

## Goal

Base the quote detail on **plates** instead of **items**. A plate is one print job: everything printed together,
supports and other extras included, so its weight is counted. Each plate has one printer and one or more
materials, each with a quantity in grams. The quote total is not calculated until every plate is complete.

## Decisions

| Concern | Choice |
|---|---|
| Plate input | Typed by hand: description, printer, print time, quantity (copies of the plate), materials with grams |
| Uploads and slicing | Out of scope; a new upload system is coming. The upload and slicer code is left untouched and unused by plates |
| Printer | Mandatory for a priceable plate; selectable later (empty in a new plate) |
| Materials | At least one per plate, each with `grams > 0`; the same material at most once per plate |
| Print time | Mandatory for a priceable plate (hours and minutes in the UI, stored in seconds) |
| Complete plate | Has a printer, a print time and at least one material, all with grams > 0 |
| Total | Computed only when **every** plate of the quote is complete. Otherwise no total is shown |
| Setup fee, minimum price | Applied per plate (they were per item) |
| Dropped fields | Layer height, infill, supports, model file, bounding box, slicing results |
| Existing data | Each item becomes one plate with one material row; `quote_items` is dropped |

## Database

Declared in `supabase/schemas/` (`06_quote_items.sql` becomes `06_quote_plates.sql`); the migration is generated
with `supabase db diff`, plus hand-written data migration of the existing items.

### `quote_plates`

`id`, `quote_id` (cascade), `description` (non-blank), `printer_id` (nullable, restrict), `print_time_s`
(nullable, `> 0`), `quantity integer > 0` default 1, the price columns of `quote_items` (`material_cost`,
`machine_cost`, `energy_cost`, `failure_cost`, `setup_fee`, `markup_amount`, `markup_pct`, `computed_total`,
`priced_at`), `override_total`, `override_reason` with the same check, generated `plate_total =
coalesce(override_total, computed_total)`, timestamps.

### `quote_plate_materials`

`id`, `plate_id` (cascade), `material_id` (restrict), `grams numeric(10,2) > 0`, unique `(plate_id, material_id)`,
indexes on both foreign keys.

### Rules

- Guard: plates and their material rows of a non-draft quote never change (`quote_not_draft`), as `quote_items_guard`.
- A change of quantity, printer, print time or of any material row clears the plate's computed price (the override
  stays). A trigger on `quote_plate_materials` clears the parent plate; a trigger on `quote_plates` handles its own
  columns.
- RLS and grants mirror `quote_items`.
- `get_quote_send_blockers`: the slicing blockers are replaced by `plate_incomplete` (per plate id); `no_items`
  becomes `no_plates`.
- `quotes_list.total` is null while any plate is incomplete (the `item_count > 0` rule becomes plate count).
- `service_copy_quote_items` becomes `service_copy_quote_plates`: copies plates and their materials, and the
  consumable lines as before.
- Quote-level total (net before VAT) = sum of `plate_total` + consumables, returned only when all plates are
  complete.

## Edge Functions

- `pricing.ts`: `PriceInput` takes `materials: { grams, costPerKg }[]` instead of `filamentG` and `costPerKg`;
  material cost = sum of `grams / 1000 × costPerKg`. Rest of the formula unchanged.
- `price-quote.ts`: loads `quote_plates` with printer and materials; a plate with no printer, print time or
  materials is skipped. Guarded write by `updated_at`, as today.
- `duplicate-quote` calls the new copy function.

## Web app

- `data/quote-items.ts` becomes `data/quote-plates.ts` (plate and material-row hooks); query keys updated.
- The editor's Items section becomes **Plates**: an **Add plate** button (no drop zone). `PlateCard` has description,
  printer select (active only), print time h/m, quantity, a materials list (material select, active only, and grams;
  add and remove rows), the price with expandable breakdown, and the owner override. Incomplete plates show what is
  missing.
- Totals: while any plate is incomplete show "Complete all plates to see the total" with the incomplete plates
  listed; otherwise net, VAT and total as today. Auto-pricing runs on every plate change.
- Send dialog: `plate_incomplete` and `no_plates` blockers. PDF: plate lines (description, quantity, price) instead
  of item lines. Error mapping and i18n (`en.json`, `it.json`) updated.
- Upload components and hooks stay in the repo, detached from the editor, for the upload redesign.

## Migration

One migration: create the two tables; insert one plate per item (description, printer, `print_time_s`, quantity,
price columns, override) and one material row per item that has both a material and `filament_g` (grams = per-copy
`filament_g`); drop `quote_items`. Items missing data become incomplete plates. The slicing queue, `slicing_jobs` and the worker/item functions are dropped with `quote_items` (they reference it); the upload UI is deleted, since a new upload system is coming.

## Testing

- pgTAP: constraints and RLS; guard on non-draft quotes; price cleared on plate/material change; send blockers;
  `quotes_list` total null while incomplete; copy; data migration of sample items.
- Deno: `pricing` with several materials; `price-quote` skipping incomplete plates; duplicate.
- Vitest: plate card (add/remove material, validation, printer/material pickers), totals gating, send dialog,
  PDF data, error mapping.
- Docs: `docs/supabase/data-model.md`, `docs/frontend/functional-analysis.md` (§3.4, §5, §7), `docs/frontend/web-app.md`.

## Out of scope

Uploads, slicing, layer height/infill/supports, per-material colour on the PDF, removing the slicer worker.
