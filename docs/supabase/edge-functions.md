# Edge Functions

Server-side actions that need the service role. The code is in `supabase/functions/`; the decisions are in
[ADR-0004](../architecture/adr/0004-pricing-and-duplication-in-edge-functions.md).

## Calling them

`POST /functions/v1/<name>` with a JSON body, the signed-in user's JWT in `Authorization: Bearer <token>` and the
publishable key in `apikey` (`supabase.functions.invoke` sends both). Only active staff may call them (`manage-staff`: only owners). Errors are
JSON `{ "code": "<code>" }`:

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Not a `POST`, or the body has no positive integer `quote_id` |
| 401 | `not_authenticated` | No bearer token, or not a valid session |
| 403 | `not_staff` | The user has no active staff row |
| 403 | `not_owner` | `manage-staff` called by active staff who is not an owner |
| 404 | `quote_not_found` | No quote with that id |
| 404 | `staff_not_found` | `resend`, `link` or `cancel` for an id with no staff row |
| 409 | `email_already_registered` | `invite` for an email that already has an account |
| 409 | `not_pending` | `resend`, `link` or `cancel` for someone who has already signed in |
| 409 | `quote_not_draft` | `price-quote` on a quote that isn't (or stopped being) a draft |
| 500 | `duplicate_failed` | `duplicate-quote` couldn't copy a file or the items; nothing was left behind |
| 500 | `internal_error` | Anything else; the function log has the cause |

The web app calls both through `invokeFunction` (`apps/web/src/data/edge-functions.ts`), which turns the `{ code }` into an `AppError`.

## `price-quote`

Body `{ "quote_id": 42 }` → `200 { "priced": 2, "skipped": 1 }`.

Prices every item of the draft that has a printer, a material and slice results, with the
[pricing rules](../frontend/functional-analysis.md#5-pricing-rules). The other items are skipped. An item changed
between reading and writing is skipped too, so call it again after your own change has landed. Price overrides are
never touched. Inactive printers and materials are still priced with their rates.

The quote's markup and its items are read in one statement, so a markup change during a call is caught by the
guarded write. Settings are read separately: a Recalculate that answers `skipped > 0` for items with results should
be called again, because another call priced them first, possibly with older settings.

## `duplicate-quote`

Body `{ "quote_id": 42 }` → `201 { "quote_id": 57 }`.

Copies a quote in any status into a new draft by the caller: same client, notes and markup override; default
validity; a new number. Files are copied into the new quote's folder. Items keep their settings, results and price
overrides; sliced items get a `succeeded` job, unsliced ones with printer and material are queued. The copy is then
priced.

## `manage-staff`

Owner only. Body `{ "action": ..., ... }`; anything else is `400 invalid_request`.

| Action | Body | Answer |
|---|---|---|
| `invite` | `{ "email", "display_name", "role": "owner" \| "operator" }` | `201 { "user_id", "email_sent" }` |
| `resend` | `{ "user_id" }` | `200 { "email_sent" }` |
| `link` | `{ "user_id" }` | `200 { "link" }` |
| `cancel` | `{ "user_id" }` | `200 {}` |

`invite` creates the login (no email yet) and the staff row (language `it`, active), then sends the invitation. The
email is trimmed and lower-cased. `resend`, `link` and `cancel` only work on someone who has a staff row and has never
signed in (a pending invitation); `cancel` deletes the login and its staff row. `link` sends nothing: it returns a
link that opens the app signed in so the person can set a password.

Links and emails redirect to `<Origin>/account?reset=1`, taken from the request's `Origin` header; without a valid
`http(s)` origin Supabase's Site URL is used.

If the email can't be sent the person is still created and the answer is `email_sent: false`; the owner then shares
the link instead. Invitations use Supabase's built-in email sender, which only reaches organisation members and is
rate-limited until custom SMTP is configured, which is why the app also offers the link.

## Local development

`supabase start` serves every function at `http://127.0.0.1:54321/functions/v1/<name>`, reloading on save. Logs:
`docker logs supabase_edge_runtime_3d-quote`. A new function's `[functions.<name>]` block in `supabase/config.toml`
(`verify_jwt = false`) goes in with its folder: `supabase start` fails on a block whose `index.ts` doesn't exist.

| Command | What it does |
|---|---|
| `npm run functions:check` | `deno check`, `deno lint` and `deno fmt --check` on `supabase/functions` |
| `npm run functions:test` | Unit tests, and integration tests against the running local stack |

Integration tests sign in as the seed users and create their own uniquely named rows; `supabase db reset` clears them.
