import type { ItemJob } from '@/data/quote-rules'
import type { Tables } from '@/lib/database.types'

const CREATED = '2026-01-01T09:00:00Z'
let nextId = 100

export const ownerStaff: Tables<'staff'> = {
  user_id: 'user-1',
  display_name: 'Anna Rossi',
  role: 'owner',
  language: 'it',
  active: true,
  created_at: CREATED,
  updated_at: CREATED,
}

export const operatorStaff: Tables<'staff'> = {
  ...ownerStaff,
  display_name: 'Otto Bianchi',
  role: 'operator',
}

export const settingsRow: Tables<'settings'> = {
  id: 1,
  currency: 'EUR',
  energy_price_kwh: 0.3,
  failure_allowance_pct: 5,
  setup_fee: 3,
  default_markup_pct: 40,
  minimum_item_price: 10,
  vat_rate_pct: 22,
  quote_prefix: 'Q',
  default_validity_days: 30,
  pdf_terms_it: null,
  pdf_terms_en: null,
  shop_name: '3D Lab',
  shop_address: null,
  shop_vat_number: null,
  shop_email: null,
  shop_phone: null,
  shop_logo_path: null,
  created_at: CREATED,
  updated_at: CREATED,
}

export function printerRow(overrides: Partial<Tables<'printers'>> = {}): Tables<'printers'> {
  return {
    id: nextId++,
    name: 'MK4 #1',
    model: 'Prusa MK4',
    build_x_mm: 250,
    build_y_mm: 210,
    build_z_mm: 220,
    nozzle_diameter_mm: 0.4,
    hourly_rate: 1.5,
    purchase_cost: null,
    lifetime_hours: null,
    power_w: 120,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

export function materialRow(overrides: Partial<Tables<'materials'>> = {}): Tables<'materials'> {
  return {
    id: nextId++,
    name: 'Prusament PLA',
    type: 'PLA',
    color: 'Black',
    density_g_cm3: 1.24,
    cost_per_kg: 25,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

/** A client row as the clients list query returns it, embedded quote count and newest quote included. */
export function clientRow(
  overrides: Partial<Tables<'clients'>> & { quoteCount?: number; lastQuoteAt?: string | null } = {},
) {
  const { quoteCount = 0, lastQuoteAt = null, ...rest } = overrides
  return {
    id: nextId++,
    name: 'Mario Rossi',
    company: 'Rossi Meccanica',
    email: 'mario@example.com',
    phone: null,
    notes: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    quote_count: [{ count: quoteCount }],
    last_quote: lastQuoteAt ? [{ created_at: lastQuoteAt }] : [],
  }
}

export function quoteRow(overrides: Partial<Tables<'quotes'>> = {}): Tables<'quotes'> {
  return {
    id: nextId++,
    number: 'Q-2026-0001',
    number_year: 2026,
    number_seq: 1,
    client_id: 1,
    status: 'draft',
    valid_until: '2026-11-11',
    notes: null,
    created_by: 'user-1',
    markup_override_pct: null,
    vat_rate_pct: null,
    sent_at: null,
    created_at: '2026-10-12T08:00:00Z',
    updated_at: '2026-10-12T08:00:00Z',
    ...overrides,
  }
}

/** A row of the quotes_list view. */
export function quoteListRow(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as number | undefined) ?? nextId++
  return {
    id,
    number: `Q-2026-${String(id).padStart(4, '0')}`,
    number_year: 2026,
    number_seq: id,
    status: 'draft',
    client_id: 1,
    client_name: 'Mario Rossi',
    client_company: 'Rossi Meccanica',
    valid_until: '2026-11-11',
    sent_at: null,
    created_at: '2026-10-12T08:00:00Z',
    created_on: '2026-10-12',
    created_by: 'user-1',
    created_by_name: 'Anna Rossi',
    item_count: 1,
    total: 39.24,
    ...overrides,
  }
}

export function jobRow(overrides: Partial<ItemJob> = {}): ItemJob {
  return {
    id: nextId++,
    status: 'queued',
    error: null,
    queued_at: '2026-10-13T09:59:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  }
}

/** A quote item as the items query returns it; `job` is the newest slicing job (embedded as a 0–1 array). */
export function quoteItemRow(
  overrides: Partial<Tables<'quote_items'>> & { job?: ItemJob | null } = {},
) {
  const { job = null, ...rest } = overrides
  const id = rest.id ?? nextId++
  return {
    id,
    quote_id: 7,
    model_path: `7/u${id}/staffa.stl`,
    original_filename: 'staffa.stl',
    description: 'Staffa',
    printer_id: null,
    material_id: null,
    quantity: 1,
    layer_height_mm: 0.2,
    infill_percent: 20,
    supports: false,
    print_time_s: null,
    filament_g: null,
    bbox_x_mm: null,
    bbox_y_mm: null,
    bbox_z_mm: null,
    material_cost: null,
    machine_cost: null,
    energy_cost: null,
    failure_cost: null,
    setup_fee: null,
    markup_amount: null,
    markup_pct: null,
    computed_total: null,
    override_total: null,
    override_reason: null,
    item_total: null,
    priced_at: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    job: job ? [job] : [],
  }
}
