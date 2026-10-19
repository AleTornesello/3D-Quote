import type { SupabaseClient } from './supabase.ts'
import { HttpError } from './http.ts'
import { type Decimal, type PriceInput, pricePlate } from './pricing.ts'

interface QuoteRow {
  status: string
  markup_override_pct: Decimal | null
  quote_plates: PlateRow[]
}

interface SettingsRow {
  energy_price_kwh: Decimal
  setup_fee: Decimal
  default_markup_pct: Decimal
  minimum_item_price: Decimal
}

// Many-to-one embeds come back as one object; without generated types supabase-js types them as arrays.
interface PlateRow {
  id: number
  updated_at: string
  quantity: number
  print_time_s: number | null
  printer: { hourly_rate: Decimal; power_w: number; failure_rate: number } | null
  materials: { grams: Decimal; material: { cost_per_kg: Decimal } | null }[]
}

export interface PricingSnapshot {
  quoteId: number
  /** `input` is null for plates that can't be priced yet (no printer, print time or materials). */
  plates: { id: number; updatedAt: string; input: PriceInput | null }[]
}

export interface PriceQuoteResult {
  priced: number
  skipped: number
}

export async function loadPricingSnapshot(
  admin: SupabaseClient,
  quoteId: number,
): Promise<PricingSnapshot> {
  const { data: settings, error: settingsError } = await admin
    .from('settings')
    .select(
      'energy_price_kwh, setup_fee, default_markup_pct, minimum_item_price',
    )
    .eq('id', 1)
    .single()
  if (settingsError) throw settingsError

  // One statement, so the markup and the plates' updated_at come from the same snapshot: a markup change after it
  // clears every plate (set_markup_override), which the guarded write then sees.
  const { data, error } = await admin
    .from('quotes')
    .select(
      'status, markup_override_pct, quote_plates(id, updated_at, quantity, print_time_s, printer:printers(hourly_rate, power_w, failure_rate), materials:quote_plate_materials(grams, material:materials(cost_per_kg)))',
    )
    .eq('id', quoteId)
    .order('id', { referencedTable: 'quote_plates' })
    .maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'quote_not_found')
  const quote = data as unknown as QuoteRow
  if (quote.status !== 'draft') throw new HttpError(409, 'quote_not_draft')

  const s = settings as SettingsRow
  const markupPct = quote.markup_override_pct ?? s.default_markup_pct
  return {
    quoteId,
    plates: quote.quote_plates.map((plate) => ({
      id: plate.id,
      updatedAt: plate.updated_at,
      input: plate.printer && plate.print_time_s !== null && plate.materials.length > 0 &&
          plate.materials.every((m) => m.material)
        ? {
          printTimeS: plate.print_time_s,
          materials: plate.materials.map((m) => ({
            grams: m.grams,
            costPerKg: m.material!.cost_per_kg,
          })),
          quantity: plate.quantity,
          hourlyRate: plate.printer.hourly_rate,
          powerW: plate.printer.power_w,
          energyPriceKwh: s.energy_price_kwh,
          failurePct: plate.printer.failure_rate,
          setupFee: s.setup_fee,
          markupPct,
          minimumPrice: s.minimum_item_price,
        }
        : null,
    })),
  }
}

/**
 * Writes each breakdown only if the plate is unchanged since the snapshot, so a price computed from stale inputs
 * never overwrites a newer change. Overrides are never written.
 */
export async function writePrices(
  admin: SupabaseClient,
  snapshot: PricingSnapshot,
): Promise<PriceQuoteResult> {
  let priced = 0
  let skipped = 0
  for (const plate of snapshot.plates) {
    if (!plate.input) {
      skipped++
      continue
    }
    const { data, error } = await admin
      .from('quote_plates')
      .update({ ...pricePlate(plate.input), priced_at: new Date().toISOString() })
      .eq('id', plate.id)
      .eq('updated_at', plate.updatedAt)
      .select('id')
    if (error) {
      // quote_plates_guard: the quote was sent after the snapshot.
      if (error.message === 'quote_not_draft') throw new HttpError(409, 'quote_not_draft')
      throw error
    }
    if (!data || data.length === 0) skipped++
    else priced++
  }
  return { priced, skipped }
}

export async function priceQuote(
  admin: SupabaseClient,
  quoteId: number,
): Promise<PriceQuoteResult> {
  return writePrices(admin, await loadPricingSnapshot(admin, quoteId))
}
