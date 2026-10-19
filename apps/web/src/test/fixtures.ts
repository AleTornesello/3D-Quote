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
    type: 'FDM',
    failure_rate: 0,
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

/** A consumable row as the consumables list query returns it, with the lines of sent quotes (`reserved`) embedded. */
export function consumableRow(
  overrides: Partial<Tables<'consumables'>> & { reserved?: number[] } = {},
) {
  const { reserved = [], ...rest } = overrides
  return {
    id: nextId++,
    name: 'Vite M3',
    unit: 'pz',
    unit_price: 0.1,
    stock: 10,
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    reserved: reserved.map((quantity) => ({ quantity, quotes: { status: 'sent' } })),
  }
}

/** A quote line as the lines query returns it, with the consumable's name, unit and stock embedded. */
export function quoteConsumableRow(
  overrides: Partial<Tables<'quote_consumables'>> & {
    consumable?: { name: string; unit: string; stock: number }
  } = {},
) {
  const { consumable = { name: 'Vite M3', unit: 'pz', stock: 10 }, ...rest } = overrides
  return {
    id: nextId++,
    quote_id: 7,
    consumable_id: 1,
    quantity: 1,
    unit_price: 0.1,
    line_total: (rest.quantity ?? 1) * (rest.unit_price ?? 0.1),
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    consumable,
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
    plate_count: 1,
    total: 39.24,
    ...overrides,
  }
}

export function plateMaterialRow(
  overrides: Partial<Tables<'quote_plate_materials'>> = {},
): Tables<'quote_plate_materials'> {
  return {
    id: nextId++,
    plate_id: 1,
    material_id: 1,
    grams: 12,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

/** A quote plate as the plates query returns it, with its materials embedded. */
export function quotePlateRow(
  overrides: Partial<Tables<'quote_plates'>> & {
    materials?: Tables<'quote_plate_materials'>[]
  } = {},
) {
  const { materials = [], ...rest } = overrides
  const id = rest.id ?? nextId++
  return {
    id,
    quote_id: 7,
    description: 'Plate 1',
    printer_id: null,
    print_time_s: null,
    quantity: 1,
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
    plate_total: null,
    priced_at: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...rest,
    materials: materials.map((m) => ({ ...m, plate_id: id })),
  }
}
