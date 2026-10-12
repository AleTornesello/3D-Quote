import type { SupabaseClient } from './supabase.ts'
import { HttpError } from './http.ts'
import { type Decimal, type PriceInput, priceItem } from './pricing.ts'

interface QuoteRow {
  status: string
  markup_override_pct: Decimal | null
}

interface SettingsRow {
  energy_price_kwh: Decimal
  failure_allowance_pct: Decimal
  setup_fee: Decimal
  default_markup_pct: Decimal
  minimum_item_price: Decimal
}

// Many-to-one embeds come back as one object; without generated types supabase-js types them as arrays.
interface ItemRow {
  id: number
  updated_at: string
  quantity: number
  print_time_s: number | null
  filament_g: Decimal | null
  printer: { hourly_rate: Decimal; power_w: number } | null
  material: { cost_per_kg: Decimal } | null
}

export interface PricingSnapshot {
  quoteId: number
  /** `input` is null for items that can't be priced yet (no printer, material or results). */
  items: { id: number; updatedAt: string; input: PriceInput | null }[]
}

export interface PriceQuoteResult {
  priced: number
  skipped: number
}

export async function loadPricingSnapshot(
  admin: SupabaseClient,
  quoteId: number,
): Promise<PricingSnapshot> {
  const { data: quote, error } = await admin
    .from('quotes')
    .select('status, markup_override_pct')
    .eq('id', quoteId)
    .maybeSingle()
  if (error) throw error
  if (!quote) throw new HttpError(404, 'quote_not_found')
  if ((quote as QuoteRow).status !== 'draft') throw new HttpError(409, 'quote_not_draft')

  const { data: settings, error: settingsError } = await admin
    .from('settings')
    .select(
      'energy_price_kwh, failure_allowance_pct, setup_fee, default_markup_pct, minimum_item_price',
    )
    .eq('id', 1)
    .single()
  if (settingsError) throw settingsError

  const { data: items, error: itemsError } = await admin
    .from('quote_items')
    .select(
      'id, updated_at, quantity, print_time_s, filament_g, printer:printers(hourly_rate, power_w), material:materials(cost_per_kg)',
    )
    .eq('quote_id', quoteId)
    .order('id')
  if (itemsError) throw itemsError

  const s = settings as SettingsRow
  const markupPct = (quote as QuoteRow).markup_override_pct ?? s.default_markup_pct
  return {
    quoteId,
    items: (items as unknown as ItemRow[]).map((item) => ({
      id: item.id,
      updatedAt: item.updated_at,
      input: item.printer && item.material && item.print_time_s !== null && item.filament_g !== null
        ? {
          printTimeS: item.print_time_s,
          filamentG: item.filament_g,
          quantity: item.quantity,
          costPerKg: item.material.cost_per_kg,
          hourlyRate: item.printer.hourly_rate,
          powerW: item.printer.power_w,
          energyPriceKwh: s.energy_price_kwh,
          failurePct: s.failure_allowance_pct,
          setupFee: s.setup_fee,
          markupPct,
          minimumPrice: s.minimum_item_price,
        }
        : null,
    })),
  }
}

/**
 * Writes each breakdown only if the item is unchanged since the snapshot, so a price computed from stale inputs
 * never overwrites a newer change. Overrides are never written.
 */
export async function writePrices(
  admin: SupabaseClient,
  snapshot: PricingSnapshot,
): Promise<PriceQuoteResult> {
  let priced = 0
  let skipped = 0
  for (const item of snapshot.items) {
    if (!item.input) {
      skipped++
      continue
    }
    const { data, error } = await admin
      .from('quote_items')
      .update({ ...priceItem(item.input), priced_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('updated_at', item.updatedAt)
      .select('id')
    if (error) {
      // quote_items_guard: the quote was sent after the snapshot.
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
