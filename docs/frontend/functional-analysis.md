# Web app — functional analysis

- **Status:** Draft — awaiting review
- **Date:** 2026-10-11
- **App:** `apps/web/` (React + Vite + TypeScript; see the [developer guide](web-app.md))

This document describes what the web app does, screen by screen, and the rules behind it. It does not prescribe
components, libraries or visual design. Background: [product overview](../product/overview.md),
[architecture overview](../architecture/overview.md), [data model](../supabase/data-model.md).

## 1. Scope and users

The web app is the only user interface of 3D-Quote. It is used by shop staff; clients never log in and only receive
the exported PDF.

### Roles

| Role | Who | In short |
|---|---|---|
| Operator | Shop staff preparing quotes | Creates and sends quotes, manages clients. Sees rates and price breakdowns but can't change them. |
| Owner | The shop owner (one or more people) | Everything an operator can do, plus prices, rates, catalogue, staff and deletions. |

### Permission matrix

| Action | Operator | Owner |
|---|:-:|:-:|
| View quotes, clients, printers, materials, consumables, settings | ✓ | ✓ |
| Create and edit draft quotes, add/edit/remove plates and their materials | ✓ | ✓ |
| Mark a quote as sent / accepted / rejected | ✓ | ✓ |
| Duplicate a quote, export PDF | ✓ | ✓ |
| Create and edit clients | ✓ | ✓ |
| Override a plate's final price, override a quote's markup | | ✓ |
| Delete quotes or clients | | ✓ |
| Create, edit, deactivate printers, materials and consumables | | ✓ |
| Add consumables to a draft quote | ✓ | ✓ |
| Edit pricing settings and shop details | | ✓ |
| Invite, remove staff and change roles | | ✓ |

Actions a user may not perform are **hidden**, not just disabled, except where a disabled control explains
something useful (e.g. operators see the price breakdown read-only). Permissions are enforced by the database
(RLS and `security definer` functions); the UI only mirrors them.

## 2. Navigation and layout

- **Sidebar** with: Quotes (home), Clients, Printers, Materials, Consumables, Settings (owner sees it editable, operator
  read-only), Staff (owner only). At the bottom: the current user's name, language switcher, Account, Log out.
- **Desktop** (≥ 1024 px): sidebar always visible; lists are tables.
- **Opening a row to edit:** in the Quotes, Clients, Printers, Materials and Consumables lists each row has an Edit
  (pencil) button, and double-clicking the row does the same. For quotes and clients that opens the quote editor or
  the client page; for printers, materials and consumables, the edit sheet (owners only). Names and numbers in the lists are not links, and a
  single click does nothing. Staff has no edit form, so it has neither.
- **Tablet** (768–1023 px): sidebar collapses to an icon rail / drawer; tables keep their key columns and hide the
  rest; every action reachable by touch.
- Below 768 px the app remains usable but is not optimised (see [§8](#8-non-functional-requirements)).
- Every list and detail page has its own URL, so pages can be bookmarked and the browser back button works.

## 3. Screens

Each screen lists what it shows, what the user can do, validation, and its empty / loading / error states.
Common behaviour applies everywhere:

- **Loading:** skeletons in place of content; never a blank page.
- **Errors:** a non-blocking message with a Retry action; form errors appear next to the field.
- **Unsaved changes:** leaving a form with unsaved changes asks for confirmation.
- **Destructive actions** (delete, remove staff) always ask for confirmation naming the thing being deleted.

### 3.1 Login

- Email + password. "Forgot password" sends a reset email.
- Staff are **invited** by an owner (see [3.9](#39-staff)); the invitation email leads to a page where the new user
  sets their password and name.
- There is no sign-up. A user who authenticates but has no staff record sees "Your account has no access to
  3D-Quote — ask the owner" and nothing else.
- The session persists across browser restarts until the user logs out.

### 3.2 Quotes list (home)

**Shows** a table of quotes, newest first:

| Column | Notes |
|---|---|
| Number | e.g. `Q-2026-0042` |
| Client | Name (company if present) |
| Status | Badge: Draft, Sent, Accepted, Rejected, Expired |
| Total | Sum of plate totals and consumable lines; "—" while the quote has no plates or any plate is incomplete or not yet priced |
| Created | Date, and who created it |
| Valid until | Date; highlighted when it falls within 7 days for sent quotes |

**Actions**
- **New quote** (primary button).
- **Search** by quote number or client name/company.
- **Filter** by status (multi-select), client, created date range. Filters are kept in the URL.
- **Sort** by number, created, valid until, total.
- Click a row to open the quote. Pagination: 25 per page.

**Empty state:** "No quotes yet" with a New quote button. With filters active: "No quotes match these filters" with
a Clear filters action.

### 3.3 New quote

A short dialog:

| Field | Rules |
|---|---|
| Client | Required. Search existing clients by name/company/email; **Create new client** inline (same fields as 3.4). |
| Valid until | Required. Defaults to today + default validity (settings). Must be today or later. |
| Notes | Optional; printed on the PDF. |
| Markup override | Owner only. Optional %; when empty the default markup applies. |

On save the quote gets its number (see [§5.4](#54-quote-numbers)), status Draft, and the quote editor opens.

### 3.4 Quote detail / editor

The main screen. Layout: header, plates, consumables, totals.

**Header**
- Number, status badge, client (link to client), created by/at, valid until, notes, markup in effect (default or
  override).
- In Draft, the client, valid until, notes and (owner) markup override are editable in place.
- Actions, depending on status (see [§4](#4-quote-lifecycle)): Mark as sent, Mark accepted, Mark rejected,
  Duplicate, Export PDF, Delete (owner).

**Plates**

A plate is one print job: everything printed together on the printer's bed, supports and other extras included, so
their weight is counted. There is no file upload or slicing for now: the plate's figures are typed by hand (a new
upload system is planned).

- **Add plate** creates a plate named "Plate 1", "Plate 2"… with quantity 1, no print time and no materials. Its
  printer is the newest plate's printer when that printer is still active, otherwise none.
- A plate is **complete** when it has a printer, a print time and at least one material. An incomplete plate says
  what is missing ("Missing: a printer, the print time, at least one material.").

**Plate card** (one per plate)

| Part | Content |
|---|---|
| Description | Required; editable; printed on the PDF. |
| Printer | Active printers only; a deactivated printer stays shown (marked inactive) on a plate that already uses it. |
| Print time | Per copy, typed as hours:minutes (`2:30`); minutes 00–59, at least one minute. |
| Copies | Whole number ≥ 1: how many times the plate is printed. |
| Materials | One row per material (active materials only, shown with colour; each material at most once) with its grams per copy, decimals allowed (`12,5` in Italian). A material select and a grams field add a row; each row's grams are editable and the row can be removed. |
| Price | Plate total and unit price; expandable **price breakdown** (see [§5](#5-pricing-rules)). |

Rules when editing a Draft plate:
- Changing **copies, printer, print time or any material** clears the plate's price; it is priced again
  automatically once the plate is complete. The owner's override stays.
- Changing the **description** does not re-price.
- **Remove** asks for confirmation and deletes the plate and its materials.

**Price override (owner only)**
- On a plate's breakdown: **Override price** sets the plate total by hand and requires a reason (free text, shown
  to staff only). The breakdown keeps the computed value and shows the override beside it.
- **Remove override** returns to the computed price.
- An override does not make an incomplete plate count: the quote still has no total until every plate is complete.

**Totals**
- **Net total** = sum of plate totals plus the consumable lines; **VAT** = net × VAT rate, rounded half-up to the cent; **Total incl. VAT**.
  Shown with currency, formatted for the user's language. A draft uses the shop's VAT rate (Settings); marking the
  quote as sent freezes the rate on the quote.
- The totals are "—" until the quote has plates and **every** plate is complete and priced. While editing, the totals
  say "Complete all plates to see the total" and list the incomplete plates.
- **Recalculate prices** (Draft only): re-prices every complete plate with the current settings and rates. Prices are
  also recalculated automatically whenever a plate changes.

**Empty state:** "Add a plate to start." above the Add plate button.

**Consumables card** (below the plates, above the totals)
- Lists the quote's consumable lines: name, price each (frozen when the line was added), quantity and line total.
- In Draft, a selector (active consumables only) and a quantity add a line; adding a consumable that is already on
  the quote raises the quantity of its line instead. The quantity of a line can be edited in place and a line can be
  removed. Changing the quantity never changes the price of the line.
- A line that asks for more than the current stock shows "Only N <unit> available". This is a warning only: the
  quote can still be saved, but it can't be sent until the quantity fits the stock.
- After Draft the lines are read-only, and the card is hidden when the quote has none.
- The consumable lines count in the totals below ([§5.6](#56-consumables)).

### 3.5 Clients

**List:** name, company, email, phone, number of quotes, last quote date. Search by name/company/email. Sort by
name (default), company, email, number of quotes or last quote date. New client.

**Client form**

| Field | Rules |
|---|---|
| Name | Required, 1–200 characters. |
| Company | Optional. |
| Email | Optional; valid email format when present. |
| Phone | Optional; free text. |
| Notes | Optional; internal, never printed. |

**Client detail:** the form plus the client's quotes (same columns as the quotes list) and a **New quote for this
client** action.

**Delete (owner only):** allowed only when the client has no quotes; otherwise the action explains why it's
unavailable.

### 3.6 Printers

**List:** name, model, type, hourly rate, power, active. Operators see it read-only.

**Printer form (owner)**

| Field | Rules |
|---|---|
| Name | Required, unique. |
| Model | Required. |
| Type | FDM or SLA; FDM is preselected for a new printer. For now it is only recorded and shown: it does not change pricing or which materials can be chosen. |
| Hourly rate method | *Enter directly* (default) or *Calculate from purchase cost*. A printer saved with a purchase cost reopens in the second mode. |
| Machine rate (per hour) | *Enter directly*: required, ≥ 0. Wear and depreciation only — energy is separate. |
| Purchase cost, estimated life (hours) | *Calculate from purchase cost*: both required; cost > 0, life a whole number of hours > 0. The machine rate is purchase cost ÷ life, rounded to cents, and shown under the fields as you type. Both are kept, so they can be corrected later. Switching back to *Enter directly* keeps the calculated rate in the field and clears the purchase figures. |
| Power (W) | Required, > 0. Average draw while printing; used for energy cost. |
| Failure rate (%) | Whole number from 0 to 100; default 0. The share of the cost of a copy added to cover failed prints on this machine. |
| Active | Inactive printers can't be chosen for plates; plates that already use them keep them. |

Only the resulting machine rate is used in pricing, however it was entered. Printers used by any plate can't be deleted, only deactivated. Changing a printer's rates affects Draft quotes on
their next recalculation and never affects Sent quotes.

### 3.7 Materials

**List:** name, type, colour, cost per kg, density, active. Search by name, filter by type. Sort by name (default),
type, colour, cost per kg or density. Operators see it read-only.

**Material form (owner)**

| Field | Rules |
|---|---|
| Name | Required. |
| Type | Required: PLA, PETG, ABS, ASA, TPU, PA, PC, Other. |
| Colour | Optional; free text (e.g. "Galaxy Black"). |
| Cost per kg | Required, ≥ 0. |
| Density (g/cm³) | Required, > 0. Pre-filled from the type (PLA 1.24, PETG 1.27, ABS 1.04, ASA 1.07, TPU 1.21, PA 1.14, PC 1.20). |
| Active | As for printers. |

Same delete/deactivate and rate-change rules as printers.

### 3.8 Settings

Owner edits; operators see read-only. Changes apply to Draft quotes on their next recalculation, never to Sent
quotes.

**Pricing**

| Setting | Example | Rules |
|---|---|---|
| Energy price (per kWh) | 0.30 | ≥ 0 |
| Setup / handling fee (per plate) | 5.00 | ≥ 0 |
| Default markup (%) | 30 | ≥ 0 |
| VAT rate (%) | 22 | 0–100; applied to the quote's net total; frozen on each quote when it is sent |
| Minimum plate price | 10.00 | ≥ 0 |
| Currency | EUR | ISO 4217 code; one currency for the whole shop |

**Quotes**

| Setting | Example | Rules |
|---|---|---|
| Quote number prefix | `Q` | 1–10 letters/digits |
| Default validity (days) | 30 | 1–365 |
| PDF terms | "Delivery …" | Optional; Italian and English text, printed at the bottom of the PDF in the chosen language |

**Shop details** (printed on the PDF): name, address, VAT number, email, phone, logo (PNG/JPG/SVG, ≤ 1 MB).

### 3.9 Staff

Owner only.

- **List:** name, email, role, status (Invited / Active / Inactive). Invited = invited and never signed in.
- **Invite:** name, email and role (the person's language starts as Italian). Sends the invitation email; the person
  follows the link, sets a password and is in. If the email can't be sent the app shows the link to send by hand.
- **Invitations:** Resend, Copy link, Revoke (deletes the invitation; only before the person has signed in).
- **Change role** between Operator and Owner.
- **Deactivate / Reactivate:** a deactivated person can no longer use the app, and the quotes they created keep
  showing them as creator. Your own row has no actions.
- The last remaining owner can't be demoted or deactivated.

### 3.10 Account

- Name and language (Italian / English); the language applies immediately and is remembered for the user.
- Change password.

### 3.11 Consumables

Goods that go into an assembly but are not printed (bolts, screws, inserts…), with the quantity in stock.

**List:** name, unit price, available / total (e.g. "40 / 50 pz"), active. Available is the stock; total adds the
units held by sent quotes, which come back if those quotes are rejected or expire. Accepted quotes count as used.
Operators see it read-only.

**Consumable form (owner)**

| Field | Rules |
|---|---|
| Name | Required, unique. |
| Unit | Required, up to 20 characters; free text (e.g. "pz"). Pre-filled with "pz" for a new consumable. |
| Unit price | Required, ≥ 0. The price charged to the client per unit; no markup is applied to it. |
| Stock | Required, whole number ≥ 0. Owners correct it here by hand; sending and rejecting quotes change it automatically ([§4](#4-quote-lifecycle)). |
| Active | Inactive consumables can't be added to quotes; lines already on a quote stay. |

A consumable used by any quote can't be deleted, only deactivated; the delete dialog says so. Changing the unit
price never changes existing quote lines.

## 4. Quote lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft: New quote
    Draft --> Sent: Mark as sent
    Sent --> Accepted: Mark accepted
    Sent --> Rejected: Mark rejected
    Sent --> Expired: valid-until date passes
    Draft --> [*]: Delete (owner)
```

| Status | Editable | Allowed actions |
|---|---|---|
| Draft | Everything | Mark as sent, Duplicate, Export PDF (watermarked "DRAFT"), Delete (owner) |
| Sent | Nothing | Mark accepted, Mark rejected, Duplicate, Export PDF |
| Accepted / Rejected / Expired | Nothing | Duplicate, Export PDF |

- **Mark as sent** requires: at least one plate; every plate complete (printer, print time, a material) and priced;
  valid until is today or later; enough stock for every consumable line. If something is missing, the dialog lists what (for stock:
  "Some consumables exceed the available stock"). On success the sent date is recorded and prices are frozen: later
  changes to rates, printers, materials or consumable prices never change a sent quote.
- **Stock:** sending a quote deducts each consumable line's quantity from the consumable's stock. If the quote is
  then **rejected**, or **expires**, the quantities go back. An **accepted** quote keeps them deducted.
- **Expired** is set automatically once a day for Sent quotes whose valid-until date has passed.
- **Duplicate** creates a new Draft with a new number, the same client, notes and plates (with their materials, even
  materials deactivated since, and any price override), and prices recalculated with current rates. Consumable lines are copied too, at today's price,
  except those of consumables that have been deactivated. This is how a sent quote is revised.
- Only Draft quotes can be deleted (owner). Sent and later quotes are kept as history.

## 5. Pricing rules

### 5.1 Inputs

| Input | Source |
|---|---|
| `print_time_h` | The plate's print time, per copy |
| `grams` of each material | The plate's materials, per copy |
| `cost_per_kg` | Each material |
| `machine_rate` (per hour), `power_w`, `failure_pct` (the printer's failure rate) | Printer |
| `energy_price` (per kWh), `setup_fee`, `minimum_price` | Settings |
| `markup_pct` | Quote override, otherwise Settings default |
| `quantity` | Plate (copies) |

### 5.2 Formula (per plate)

```text
material_cost   = Σ over the plate's materials of grams / 1000 × cost_per_kg
machine_cost    = print_time_h × machine_rate
energy_cost     = power_w / 1000 × print_time_h × energy_price
copy_cost       = material_cost + machine_cost + energy_cost
failure_cost    = copy_cost × failure_pct / 100
production_cost = (copy_cost + failure_cost) × quantity + setup_fee
markup          = production_cost × markup_pct / 100
computed_total  = max(production_cost + markup, minimum_price)
plate_total     = override_total if set, else computed_total
unit_price      = plate_total / quantity
```

- Only complete plates are priced (printer, print time and at least one material).
- The setup fee is charged **once per plate**, not per copy.
- The minimum price applies to the **plate total**.
- Calculations use full precision; only `plate_total` and `unit_price` are rounded, to 2 decimals, half up. The
  quote total is the sum of rounded plate totals.

### 5.3 Worked example

PETG at 25.00/kg, printer with machine rate 1.50/h, 120 W and failure rate 10 %, energy 0.30/kWh, setup fee 5.00,
markup 30 %, minimum 10.00. One plate of 120 g of PETG and 5 h 30 min per copy; 2 copies.

| Line | Calculation | Value |
|---|---|---|
| Material | 120 / 1000 × 25.00 | 3.0000 |
| Machine | 5.5 × 1.50 | 8.2500 |
| Energy | 0.120 × 5.5 × 0.30 | 0.1980 |
| Cost per copy | | 11.4480 |
| Failure allowance | 11.4480 × 10 % | 1.1448 |
| × quantity 2 | (11.4480 + 1.1448) × 2 | 25.1856 |
| Setup fee | | 5.0000 |
| Production cost | | 30.1856 |
| Markup | 30.1856 × 30 % | 9.0557 |
| **Plate total** | max(39.2413, 10.00), rounded | **39.24** |
| Unit price | 39.24 / 2 | 19.62 |

### 5.4 Quote numbers

- Format: `<prefix>-<year>-<sequence>`, e.g. `Q-2026-0042`.
- The sequence restarts at 1 every calendar year and is zero-padded to 4 digits (it grows past 9999 if needed).
- The number is assigned when the quote is created and never changes. Deleting a draft leaves a gap; that is
  accepted for quotes.

### 5.5 What is stored

Every plate stores its price breakdown (each line above, the markup % used, and any override with its reason). For
Draft quotes it is rewritten on every recalculation; once the quote is Sent it is never rewritten, so the stored
breakdown is the record of what was quoted.

### 5.6 Consumables

A consumable line costs `quantity × unit_price`, where the unit price was copied from the consumable when the line was
added. No markup, setup fee or minimum price applies to it, and the markup override doesn't touch it. The net total
of a quote is the plate totals plus the consumable lines; VAT is worked out once on that whole net amount, not per
line.

## 6. PDF

Exported from the quote detail in any status. The user chooses the PDF language (Italian / English; defaults to
their UI language).

**Contents**
1. Shop logo and details (from Settings).
2. Title "Quote" / "Preventivo", number, date (sent date, or today for drafts), valid until.
3. Client block: name, company, email, phone.
4. Plates table: description, materials (type and colour, with grams per copy, e.g. "PLA · Black 12 g, PETG 5 g"),
   quantity, unit price, plate total.
   When the quote has consumable lines, a second table follows with similar columns: name, unit, quantity, unit
   price, line total.
5. Net total, VAT (rate) and total incl. VAT, in the shop currency.
6. Quote notes.
7. PDF terms from Settings, in the chosen language.

**Not on the PDF:** cost breakdown, printers, print times, overrides and their reasons, internal client notes.

Draft PDFs carry a diagonal "DRAFT" / "BOZZA" watermark.

File name: `<number>-<client name>.pdf`, e.g. `Q-2026-0042-Rossi.pdf`.

The Export PDF button is available in every status once the quote has plates and every plate is complete and has a
price; it opens a dialog to choose the language.

## 7. Live updates

Changes to a quote's plates and their materials made by someone else appear without reloading the page. Slicing,
which this section used to describe, was removed together with file uploads; a new upload system is planned.

## 8. Non-functional requirements

**Languages**
- Italian and English. All UI text comes from translation files; no hard-coded strings.
- Language per user (stored on the staff record); before login, the browser language, falling back to Italian.
- Numbers, dates and currency are formatted for the active language (`it-IT`: 1.234,56 €; `en-GB`: €1,234.56).
- Data entered by staff (descriptions, notes, client names) is not translated.

**Devices and browsers**
- Desktop and tablet are fully supported; phone screens are usable but not optimised.
- Latest two versions of Chrome, Edge, Firefox and Safari (including Safari on iPad).
- Touch targets at least 44 × 44 px; nothing depends on hover or drag-and-drop alone.

**Accessibility**
- Target WCAG 2.1 AA: keyboard navigation, visible focus, labelled form fields, sufficient contrast, status not
  conveyed by colour alone (badges have text).

**Responsiveness**
- Lists load in under 1 s for 1 000 quotes on a normal connection (paginated, filtered on the server).

## 9. Impact on other docs

This analysis requires these changes, applied in the same change set:

- [Data model](../supabase/data-model.md):
  - `staff.language`;
  - `printers.power_w`;
  - new single-row `settings` table;
  - `quotes.number` (+ year and sequence), `quotes.markup_override_pct`;
  - the price breakdown columns (now on `quote_plates`), replacing `unit_price`;
  - owner-only write policies, a `set_price_override` function, and a daily job that expires quotes.
- [Product overview](../product/overview.md): workflow and glossary updated with energy cost, owner-only price
  overrides and PDF export; resolved open questions removed.

## 10. Open questions

- None.
