# Product overview

## What it is

3D-Quote is an internal tool for a 3D print shop. It turns a client's model file into a priced quote by slicing
the model with the shop's real printer and material settings, instead of estimating print time and material by eye.

## Users

- **Shop staff** (operators and the owner) are the only users. They log in, manage printers, materials and rates,
  and create quotes.
- **Clients do not log in.** They send model files to the shop by whatever channel the shop already uses, and
  receive the finished quote outside the tool.

## Quoting workflow

1. A staff member creates a quote for a client.
2. They upload one or more model files (STL or 3MF) to the quote. Each file becomes a quote item.
3. For each item they choose a printer, a material, the quantity and print settings (layer height, infill,
   supports).
4. The system slices each model in the background and records print time and filament usage.
5. A price is computed for each item from those metrics plus the material rate and the machine rate.
6. The staff member reviews the quote, adjusts it if needed, and marks it as sent to the client.

## Goals

- Fast, consistent estimates based on real slicer output rather than guesswork.
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
| Machine rate | What an hour of printer time costs the shop (energy, wear, depreciation). |

## Open questions

- **Pricing formula.** Beyond material and machine cost: markup, setup/handling fee, minimum price, an allowance
  for failed prints, post-processing.
- **Multi-colour / multi-material prints.** In scope for the first version or not.
- **Quote output.** How a quote reaches the client: PDF export, email from the tool, or copy-paste.
- **3D preview.** Whether the web app shows an in-browser preview of the model in the first version.
