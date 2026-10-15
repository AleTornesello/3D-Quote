# Consumables — Design

- **Date:** 2026-10-15
- **Status:** Implemented
- **Branch:** `develop`

## Goal

Register the goods that are used in an assembly but are not 3D printed (bolts, screws, inserts…) in a new
**Consumables** section, with an available quantity. A quote may optionally include consumable lines. When the
quote is sent, the available quantity of each consumable goes down.

## Decisions

| Concern | Choice |
|---|---|
| Section access | All staff read; owners create, edit and delete, like Materials. Any staff member adds consumables to a draft quote |
| Price | Each consumable has a `unit_price`. A quote line freezes it, so later price changes never alter an old quote |
| Markup | **None.** Consumable lines are added to the subtotal at their price; VAT then applies to the whole total |
| When stock goes down | When the quote is **sent** (`mark_quote_sent`). Drafts never touch stock |
| Stock given back | When a sent quote becomes **rejected** or **expired**. Accepted quotes keep it deducted |
| Not enough stock | `get_quote_send_blockers` reports `insufficient_stock` (the send dialog lists it). `mark_quote_sent` locks the consumable rows first and then runs the same check, so it fails with `quote_not_sendable` when stock ran out meanwhile. In the draft, a line above the current stock shows a warning |
| Quote shape | A quote still needs at least one printed item (`no_items` blocker unchanged). Consumables are optional extras |
| Deleting a consumable | Blocked while any quote line references it (`on delete restrict`); deactivate instead |
| Manual stock edits | Editing the stock in the Consumables section only changes the counter; no movement history |

## Database

Declared in `supabase/schemas/` (new file `06_consumables.sql` for both tables; policies, grants, API functions
and the view in the existing files); the migration is generated with `supabase db diff`.

### `consumables`

`id`, `name` (unique, non-blank), `unit` (non-blank, e.g. `pcs`), `unit_price numeric(12,2) >= 0`,
`stock integer >= 0`, `active`, `created_at`, `updated_at`. RLS: staff read, owner/staff write as for `materials`.

### `quote_consumables`

`id`, `quote_id` (cascade), `consumable_id` (restrict), `quantity integer > 0`, `unit_price numeric(12,2)` (frozen
from the consumable when the line is added), `line_total numeric(12,2)` generated as `quantity * unit_price`,
timestamps. Unique `(quote_id, consumable_id)`. Indexes on both foreign keys. The same guard as `quote_items`:
lines of a non-draft quote never change, for any role (`quote_not_draft`).

### Functions

- `add_quote_consumable(quote_id, consumable_id, quantity)`: staff, draft quote, consumable active; freezes the
  price. Adding the same consumable again raises the quantity of the existing line.
- `get_quote_send_blockers`: a new `insufficient_stock` code (no item id) when any line exceeds its consumable's
  stock.
- `mark_quote_sent`: locks the quote's consumable rows (`for update`, ordered by id) before the blocker check, then
  deducts. One transaction.
- Stock returns through an `after update` trigger on `quotes` when `old.status = 'sent'` and `new.status` is
  `rejected` or `expired`. This covers `mark_quote_rejected` and the daily `expire_quotes` job without changing them.
- `service_copy_quote_items` (used by `duplicate-quote`) also copies the lines of **active** consumables, re-reading the current price. Lines of inactive consumables are skipped.
- `quotes_list.total` adds the quote's consumable lines. The `item_count > 0` rule stays.

## Edge Functions

`price-quote` is unchanged: pricing of printed items does not depend on consumables. `duplicate-quote` calls the
extended copy function.

## Web app

- **Section** `/consumables` ("Consumables", icon `Package`) between Materials and Settings. List with name, unit,
  unit price, stock, Active toggle, edit sheet, delete with the existing catalog-delete dialog (shows the
  "used by quotes" message when blocked). Built on `DataTable`, `FormSheet` and the Materials form patterns.
  `data/consumables.ts` mirrors `data/materials.ts`.
- **Quote editor:** an optional **Consumables** card under the items, draft only. A picker of active consumables,
  a quantity field per line, remove, and a warning on a line whose quantity exceeds the current stock. Read-only
  once the quote has left draft. `data/quote-consumables.ts` holds the hooks.
- **Totals:** `quoteTotals` includes the consumable lines in the subtotal before VAT.
- **PDF:** a second table after the items, when the quote has consumables: description, unit, quantity, unit price, total. It sits above the totals.
- **Errors:** `insufficient_stock` is a new send blocker, listed in the send dialog; `consumable_inactive` (adding an
  inactive consumable) is added to the error mapping.
- **i18n:** every new string in `en.json` and `it.json`.

## Testing

- pgTAP: table constraints and RLS; frozen price; guard on non-draft quotes; send deducts, send with too little
  stock fails and deducts nothing; rejected and expired give it back, accepted does not; copy; `quotes_list` total.
- Vitest: consumables page (list, create, edit, toggle, delete blocked), editor card (add, quantity, warning,
  read-only), `quoteTotals`, PDF data, error mapping.
- Docs: `docs/supabase/data-model.md`, `docs/frontend/functional-analysis.md`, `docs/frontend/web-app.md`.

## Out of scope

Stock movement history, low-stock alerts, supplier or purchase tracking, markup on consumables, reserving stock
for drafts or sent quotes.
