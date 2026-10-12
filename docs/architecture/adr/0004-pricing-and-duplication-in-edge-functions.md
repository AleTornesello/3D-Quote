# ADR-0004: Pricing and duplication in Edge Functions

- **Status: Accepted**
- **Date:** 2026-10-12

## Context

[ADR-0003](0003-database-schema-and-security.md) put pricing in an Edge Function but left open when it runs. The
pricing rules are in the [functional analysis §5](../../frontend/functional-analysis.md#5-pricing-rules): full
precision, with only the item total rounded half up to 2 decimals. Print time arrives in seconds, so hours are often
not finite decimals. Duplicating a quote must reuse its model files, but `quote_items.model_path` is unique and must
start with the item's quote id.

## Decision

- **`price-quote`** prices every item of a draft that has a printer, a material and slice results. The **web app
  calls it** after each change it makes, after a slice finishes, and from **Recalculate prices**. Nothing prices a
  quote nobody has open.
- **Exact arithmetic:** a `BigInt` fraction type, no dependency. No float is ever used for money.
- **Guarded writes:** the breakdown is written with the service role only if the item's `updated_at` still matches
  what was read, so a price computed from stale inputs never overwrites a newer change. Changes to settings,
  printers or materials don't touch items; their effect waits for the next call.
- **`duplicate-quote`** creates the draft (`service_create_quote_copy`), copies each file into the new quote's folder
  with Storage `copy`, then inserts the items with their results, price overrides and a `succeeded` job in one
  transaction (`service_copy_quote_items`). Nothing is sliced again. Storage and SQL can't share a transaction, so a
  failure deletes the copied files and the new draft by hand.
- Both functions check the caller's JWT and active staff row themselves (`verify_jwt = false`), so every error,
  401 included, carries CORS headers and a `{ code }`.

## Alternatives considered

- **Pricing as a SQL function** run inside every change: always consistent, but rejected to keep ADR-0003's decision.
- **A database webhook** calling the function on every item change: automatic, but asynchronous and with more moving
  parts (pg_net, secrets, retries).
- **Sharing files between quotes:** no copying, but removing an item or a draft would need to know whether another
  quote still uses the file.
- **Re-slicing duplicated items:** simpler, but the copy can't be sent until the worker slices everything again.

## Consequences

- A quote whose rates changed shows old prices until someone edits it or presses Recalculate.
- The web app must call `price-quote` after every change that clears prices; the web quotes spec owns that.
- Copied files double storage use for duplicated quotes.
- Edge Function code and tests need Deno; see [getting started](../../development/getting-started.md).
