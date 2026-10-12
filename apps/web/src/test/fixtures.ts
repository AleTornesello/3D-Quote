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
    sent_at: null,
    created_at: '2026-10-12T08:00:00Z',
    updated_at: '2026-10-12T08:00:00Z',
    ...overrides,
  }
}
