# Product overview

## What it is

3D-Quote is an internal tool for a 3D print shop. It turns the print jobs for a client's parts into a priced quote
from the shop's real printers, materials and rates. Today staff type each job's print time and material weights (read
from their slicer); reading them from uploaded model files is planned.

## Users

- **Shop staff** (operators and the owner) are the only users. They log in, manage printers, materials and rates,
  and create quotes.
- **Clients do not log in.** They send model files to the shop by whatever channel the shop already uses, and
  receive the finished quote outside the tool.

## Quoting workflow

1. A staff member creates a quote for a client.
2. They add one or more **plates** to the quote. A plate is one print job: everything printed together, supports
   included.
3. For each plate they choose a printer and type the print time, the number of copies and the materials used with
   their grams.
4. Once every plate is complete, a price is computed for each from those figures plus material, machine and energy
   costs, a failure allowance, a setup fee and a markup, with a minimum price per plate. Consumables (bolts, inserts…)
   can be added at their own price.
6. The staff member reviews the quote and marks it as sent; only the owner can override a computed price.
7. The quote is exported as a PDF (Italian or English) and sent to the client outside the tool.

Screen-by-screen detail, roles and the exact pricing formula are in the
[web app functional analysis](../frontend/functional-analysis.md).

## Goals

- Fast, consistent estimates based on real slicer figures rather than guesswork.
- One place to keep the shop's printers, materials and rates, so every quote uses the same numbers.
- A history of quotes per client.

## Non-goals (for now)

- A self-service portal where clients upload files and get prices themselves.
- Online payment.
- Order and production tracking after a quote is accepted.

## Glossary

| Term | Meaning |
|---|---|
| Quote | An offer to a client, made of one or more quote items, with a status (draft, sent, accepted…). |
| Quote item | One model file on a quote, with its printer, material, quantity, settings, slicing results and price. |
| Model file | The 3D file to print (STL or 3MF), stored in Supabase Storage. |
| Slicing | Converting a model into printer instructions; as a side effect the slicer reports print time and filament use. |
| Slicing job | A background task that slices one quote item; queued, then run by the slicer-worker. |
| Print time | Estimated machine time for one copy of the model, as reported by the slicer. |
| Filament usage | Estimated material for one copy, in grams (and millimetres of filament). |
| Material rate | What a material costs the shop, per kilogram. |
| Machine rate | What an hour of printer time costs the shop in wear and depreciation (energy is separate). |
| Energy cost | Printer power × print time × energy price per kWh. |
| Failure rate | A percentage, set per printer, added to the cost of a copy to cover failed prints. |
| Setup fee | A fixed amount charged once per quote item for preparation and handling. |
| Markup | The percentage added on top of the production cost; a shop default, overridable per quote by the owner. |
| Operator / Owner | The two staff roles. Owners also manage rates, catalogue, staff, price overrides and deletions. |

## Open questions

- **Multi-colour / multi-material prints.** In scope for the first version or not.
- **Post-processing.** Whether finishing work (support removal beyond the setup fee, sanding, painting) is priced.

Decided: pricing formula and PDF export are defined in the
[functional analysis](../frontend/functional-analysis.md); an in-browser 3D preview is not in the first version.
