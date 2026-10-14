# PDF Export and VAT — Design

- **Date:** 2026-10-14
- **Status:** Implemented
- **Branch:** `develop`

## Goal

Export a quote as a PDF to send to the client, as described in the
[functional analysis](../../frontend/functional-analysis.md) §6, and add VAT to the quote:

- a shop-wide VAT rate in Settings, frozen on each quote when it is marked as sent;
- the editor's totals and the PDF show the net total, the VAT and the gross total;
- an **Export PDF** action on the quote editor, in Italian or English, built in the browser.

This settles two open questions of the functional analysis (§10): **VAT** (shown, one shop rate, frozen on send) and
**PDF generation** (in the browser).

## Decisions

| Concern | Choice |
|---|---|
| VAT on the quote | Net total, VAT and gross total; one shop-wide rate in Settings (default 22 %) |
| Rate over time | Drafts follow Settings; `mark_quote_sent` copies the rate onto the quote; later changes never touch it |
| VAT rounding | Computed once on the net total, rounded half-up to cents |
| Where VAT shows | Quote editor totals and PDF; the quotes list keeps its net Total |
| PDF generation | In the browser with `@react-pdf/renderer`, lazy-loaded on export |
| PDF texts | The app's i18n resources, `pdf.*` keys, read with `i18n.getFixedT(language)` |
| Fonts | The built-in Helvetica (WinAnsi: Western European characters and €); no embedded font |
| When export is allowed | Any status, both roles, once the quote has items and every item has a price |

## Database changes

Declared in the schema files; the migration is generated with `supabase db diff`, plus a hand-written backfill.

### Columns

`supabase/schemas/03_settings.sql`:

```sql
vat_rate_pct numeric(5,2) not null default 22 check (vat_rate_pct between 0 and 100),
```

`supabase/schemas/05_quotes.sql`:

```sql
vat_rate_pct numeric(5,2) check (vat_rate_pct between 0 and 100),
...
constraint quotes_vat_rate_check check ((status = 'draft') = (vat_rate_pct is null))
```

A draft has no rate of its own; every other status has the rate it was sent with.

### Freezing the rate

`private.mark_quote_sent` sets the rate in the same update that sends the quote:

```sql
update public.quotes
set status = 'sent',
    sent_at = now(),
    vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
where id = p_quote_id;
```

`quotes_guard` already rejects direct edits to non-draft quotes, so the rate can't be changed afterwards. Accept,
reject and expire change only the status and keep the rate. `service_create_quote_copy` (duplicate) inserts a draft
without a rate, so the copy follows Settings until it is sent.

### Migration

The generated migration adds the settings column first. Before the quotes constraint is added, a hand-written step
backfills existing rows:

```sql
update public.quotes
set vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
where status <> 'draft';
```

The migration is applied locally. Applying it to the cloud project is a separate step, done through the Supabase MCP
only when asked.

### Tests (pgTAP)

A new `supabase/tests/database/vat.test.sql`:

- `settings.vat_rate_pct` defaults to 22 and rejects -1 and 100.01;
- a draft with a rate, and a sent quote without one, violate `quotes_vat_rate_check`;
- `mark_quote_sent` copies the current settings rate;
- changing the settings rate afterwards leaves the sent quote's rate unchanged;
- `mark_quote_accepted` and `private.expire_quotes()` keep the rate;
- `service_create_quote_copy` of a sent quote creates a draft with no rate;
- an operator can't change `settings.vat_rate_pct` (the existing owner-only policy covers the new column).

The web app's types are regenerated (`npm run gen:types`).

## Totals and VAT rules

Pure helpers in `apps/web/src/data/quote-rules.ts`:

- `vatRateFor(quote, settings)` returns `quote.vat_rate_pct ?? settings.vat_rate_pct`.
- `quoteTotals(items, ratePct)` returns `{ net, vat, gross }`, or `null` when the quote has no items or any item has
  no `item_total`. It works in integer cents: `net` is the sum of the item totals; `vat` is `net × rate / 100`
  rounded half-up to a cent; `gross` is `net + vat`.

`QuoteTotals` uses them and shows three lines: **Net total**, **VAT (22 %)** and **Total incl. VAT** (the large
number). The "Prices net of VAT" caption goes away. While a total can't be computed every line shows "—".

## Settings

The Pricing card on the Settings page gets **VAT rate (%)**: owner-editable, read-only for operators, like the
other rates; `0`–`100`, two decimals; saved with the rest of the card.

## Export PDF

### In the editor

- `QuoteActions` gets **Export PDF**, in every status and for both roles.
- It is disabled while the quote has no items or any item has no price, with the reason next to it ("Every item
  needs a price before exporting"). Sent, accepted, rejected and expired quotes always meet the rule.
- It opens a dialog:
  - **Language:** Italiano / English radio buttons, defaulting to the UI language;
  - on drafts, a note: "Draft PDFs carry a DRAFT watermark.";
  - **Download** (spinner while the PDF is built) and **Cancel**.
- On success the file downloads and the dialog closes. On failure an error toast says "The PDF couldn't be
  created", and the dialog stays open so the user can try again.

### Code

New folder `apps/web/src/pdf/`:

| File | Purpose |
|---|---|
| `quote-pdf-data.ts` | `toQuotePdfData(input)`, pure. Turns the quote, its items, the client, settings, the logo data URL, the language and today's shop date into a `QuotePdfData` whose strings are already translated and formatted |
| `QuotePdf.tsx` | The `@react-pdf/renderer` layout of a `QuotePdfData`. No data fetching, no logic beyond showing what's present |
| `pdf-renderer.ts` | `PdfRenderer` interface (`render(data): Promise<Blob>`), its context and `usePdfRenderer()`. The real one dynamically imports `@react-pdf/renderer` and `QuotePdf`, so they land in a separate chunk |
| `logo.ts` | `loadLogoDataUrl(signedUrl)`: fetches the logo and returns a PNG or JPEG data URL; an SVG is drawn onto a canvas and exported as PNG, because react-pdf can't draw SVG images |
| `download.ts` | `downloadBlob(blob, fileName)`: object URL, a clicked `<a download>`, then `URL.revokeObjectURL` |
| `ExportPdfDialog.tsx` | The dialog above; it builds the data, calls the renderer and downloads |

`pdfFileName(number, clientName)` (in `quote-rules.ts`) builds `<number>-<client name>.pdf`: it removes characters not
allowed in file names (`\ / : * ? " < > |` and control characters), turns runs of whitespace into `-`, trims `-`
from the ends and caps the client part at 60 characters. Accented letters are kept. For example,
`Q-2026-0042` and `Mario Rossi` give `Q-2026-0042-Mario-Rossi.pdf`.

### Data the PDF uses

The dialog uses what the editor already has loaded: the quote (with its embedded client), its items with printer
and material, and settings. The logo is fetched through the existing signed-URL query (`useLogoUrl`). If the logo
can't be loaded, the PDF is created without it and a warning toast says "The logo couldn't be loaded; the PDF was
created without it."

- **Rate:** `vatRateFor(quote, settings)`; **amounts:** `quoteTotals(items, rate)`.
- **Date:** the shop-timezone day of `sent_at`, or `shopToday()` for drafts.
- **Formatting:** dates, numbers and the shop currency in the chosen language (`localeFor(language)`), not the UI
  language.
- **Texts:** `i18n.getFixedT(language)` with new `pdf.*` keys in `it` and `en`.

### Layout

A4 portrait, 15 mm margins, Helvetica, black text with one grey for secondary text and rules.

1. **Header:** the logo on the left (fits in 40 × 20 mm); on the right the shop name in bold, then address, VAT
   number, email and phone, skipping empty ones.
2. **Title:** "Preventivo" / "Quote" and the number; below it the date and "Valido fino al" / "Valid until".
3. **Client:** "Cliente" / "Client", then name, company, email and phone, skipping empty ones.
4. **Items table:** Description | Material | Qty | Unit price | Total.
   - Material is the type and colour (`PLA · Black`), or the type alone when there is no colour.
   - Unit price is the item total divided by the quantity, as in the editor.
   - The header row repeats on every page; a row is never split across pages.
5. **Totals**, right-aligned: Net total, VAT (rate %), **Total incl. VAT** in bold.
6. **Notes:** the quote notes under "Note" / "Notes", only when present.
7. **Terms:** `pdf_terms_it` or `pdf_terms_en` for the chosen language, in small grey text, only when present.
8. **Footer** on every page: the quote number and "Pagina 1 di 2" / "Page 1 of 2".
9. **Draft watermark:** a large diagonal light-grey "BOZZA" / "DRAFT" on every page of a draft.

Not on the PDF (unchanged from §6): the cost breakdown, print times, filament weights, overrides and their reasons,
and the client's internal notes.

### Fonts

Helvetica covers Italian and other Western European letters and €. Characters outside WinAnsi (for example a client
name in Cyrillic or Greek) won't print correctly. This is documented as a known limitation; embedding a font is left
for when it's needed.

## i18n

New keys in `it` and `en`:

- `quotes.editor.*` for the three total lines, the Export PDF button, its disabled reason, the dialog, the draft
  note and the toasts;
- `settings.*` for the VAT rate field;
- `pdf.*` for every text printed on the PDF.

## Testing

**Unit (Vitest):**

- `quoteTotals`: sums, half-up rounding on cents (net 12.25 at 22 % gives VAT 2.70, net 0.25 gives 0.06), a 0 % rate, `null` with no
  items or an unpriced item;
- `vatRateFor`: the quote's rate wins; a draft uses settings;
- `pdfFileName`: forbidden characters, whitespace runs, the 60-character cap, accents kept;
- `toQuotePdfData` in both languages: dates and currency in the chosen locale, material labels, empty shop and
  client fields skipped, internal client notes absent, the watermark only on drafts, the terms of the chosen
  language, the date from `sent_at` or today.

**Real render:** one test file running in the Node environment renders `QuotePdf` with `@react-pdf/renderer` and
extracts the text with `pdfjs-dist` (a dev dependency). It checks the number, an item row, the three totals, the
watermark on a draft and its absence on a sent quote, and that 40 items produce more than one page.

**Pages (with a `FakePdfRenderer`, `renderApp(...).pdf`):**

- Export PDF is visible in every status for both roles, and disabled with its reason while an item has no price;
- the dialog defaults to the UI language; the chosen language, the data and the file name reach the renderer, and
  the download happens;
- a renderer failure shows the error toast and keeps the dialog open; a logo that fails to load shows the warning
  toast and the PDF is still created;
- the editor shows Net total, VAT with the rate, and Total incl. VAT, with the frozen rate on a sent quote and the
  settings rate on a draft;
- Settings: the owner edits the VAT rate, an operator sees it read-only, out-of-range values are rejected.

**Bundle:** after `npm run build`, `@react-pdf/renderer` must be in its own chunk, not in the main one.

## Docs

- `docs/frontend/functional-analysis.md`: §3.4 totals (net, VAT, gross); §3.8 the VAT rate setting; §6 the VAT
  lines, the export rule and the dialog; §10 remove the VAT and PDF generation questions (decided here).
- `docs/supabase/data-model.md`: the two `vat_rate_pct` columns and the constraint.
- `docs/frontend/web-app.md`: a **PDF** section (the folder, the fake renderer, the font limitation); the cloud
  migration note.
- This spec: status to Implemented when done.

## Out of scope

- Per-quote or per-client VAT exemptions (reverse charge, foreign clients);
- emailing the PDF from the app, or storing generated PDFs;
- embedded fonts for non-Western scripts;
- applying the migration to the cloud project (done separately, on request).

## Git

Work on `develop`, one commit per plan task.
