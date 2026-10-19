// Integration test helpers. They run against the local stack (`supabase start`), read its URLs and keys from
// `supabase status`, and create their own uniquely named rows, so runs don't depend on each other.
import { createClient, type SupabaseClient } from '../_shared/supabase.ts'
import { type Decimal, type PriceBreakdown, pricePlate } from '../_shared/pricing.ts'
import { fromFileUrl } from './deps.ts'

export const OWNER_ID = '00000000-0000-4000-8000-000000000001'
export const OPERATOR_ID = '00000000-0000-4000-8000-000000000002'
export const OWNER_EMAIL = 'owner@3dquote.local'
export const OPERATOR_EMAIL = 'operator@3dquote.local'
export const PASSWORD = 'password123'

interface LocalStack {
  apiUrl: string
  functionsUrl: string
  publishableKey: string
  secretKey: string
}

let stack: LocalStack | undefined

async function localStack(): Promise<LocalStack> {
  if (stack) return stack
  const output = await new Deno.Command('supabase', {
    args: ['status', '-o', 'json'],
    cwd: fromFileUrl(new URL('../../..', import.meta.url)),
    stdout: 'piped',
    stderr: 'null',
  }).output()
  const text = new TextDecoder().decode(output.stdout)
  if (!output.success || !text.includes('{')) {
    throw new Error('`supabase status` failed: run `supabase start` first')
  }
  const env = JSON.parse(text.slice(text.indexOf('{')))
  stack = {
    apiUrl: env.API_URL,
    functionsUrl: env.FUNCTIONS_URL,
    publishableKey: env.PUBLISHABLE_KEY,
    secretKey: env.SECRET_KEY,
  }
  return stack
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

/** A service-role client; `fetchImpl` lets a test act between the requests a function makes. */
export async function adminClient(fetchImpl?: typeof fetch): Promise<SupabaseClient> {
  const { apiUrl, secretKey } = await localStack()
  return createClient(
    apiUrl,
    secretKey,
    fetchImpl ? { ...noSession, global: { fetch: fetchImpl } } : noSession,
  )
}

export async function signIn(email: string, password = PASSWORD): Promise<string> {
  const { apiUrl, publishableKey } = await localStack()
  const client = createClient(apiUrl, publishableKey, noSession)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session.access_token
}

export interface FunctionResponse {
  status: number
  headers: Headers
  body: {
    code?: string
    priced?: number
    skipped?: number
    quote_id?: number
    user_id?: string
    email_sent?: boolean
    link?: string
  }
}

export async function callFunction(
  name: string,
  body: unknown,
  token?: string,
): Promise<FunctionResponse> {
  const { functionsUrl, publishableKey } = await localStack()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: publishableKey,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: response.status, headers: response.headers, body: await response.json() }
}

export async function preflight(name: string): Promise<Response> {
  const { functionsUrl } = await localStack()
  const response = await fetch(`${functionsUrl}/${name}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info',
    },
  })
  await response.body?.cancel()
  return response
}

/** Unwraps a supabase-js result, throwing its error. */
export async function must<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as T
}

const unique = () => crypto.randomUUID().slice(0, 8)

export interface Catalog {
  printerId: number
  materialId: number
  clientId: number
}

export async function createCatalog(admin: SupabaseClient): Promise<Catalog> {
  const tag = unique()
  const printer = await must<{ id: number }>(
    admin.from('printers').insert({
      name: `itest printer ${tag}`,
      model: 'Test',
      hourly_rate: 1.5,
      power_w: 120,
    }).select('id').single(),
  )
  const material = await must<{ id: number }>(
    admin.from('materials').insert({
      name: `itest material ${tag}`,
      type: 'PETG',
      density_g_cm3: 1.27,
      cost_per_kg: 25,
    }).select('id').single(),
  )
  const client = await must<{ id: number }>(
    admin.from('clients').insert({ name: `itest client ${tag}` }).select('id').single(),
  )
  return { printerId: printer.id, materialId: material.id, clientId: client.id }
}

export async function createQuote(
  admin: SupabaseClient,
  clientId: number,
  extra: { notes?: string; markup_override_pct?: number } = {},
): Promise<number> {
  const quote = await must<{ id: number }>(
    admin.from('quotes').insert({ client_id: clientId, created_by: OWNER_ID, ...extra }).select(
      'id',
    )
      .single(),
  )
  return quote.id
}

export interface PlateOptions {
  printerId?: number
  /** Leave out for none; null makes the plate incomplete. */
  printTimeS?: number | null
  quantity?: number
  materials?: { materialId: number; grams: number }[]
  override?: { total: number; reason: string }
}

export interface PlateRow {
  id: number
  updated_at: string
  quantity: number
  print_time_s: number | null
  printer_id: number | null
  materials: { material_id: number; grams: Decimal }[]
}

const PLATE_COLUMNS =
  'id, updated_at, quantity, print_time_s, printer_id, materials:quote_plate_materials(material_id, grams)'

/** Creates a plate and its material rows with the service role, then reads it back (the rows bump updated_at). */
export async function createPlate(
  admin: SupabaseClient,
  quoteId: number,
  options: PlateOptions = {},
): Promise<PlateRow> {
  const plate = await must<{ id: number }>(
    admin.from('quote_plates').insert({
      quote_id: quoteId,
      description: 'Plate',
      printer_id: options.printerId ?? null,
      print_time_s: options.printTimeS ?? null,
      quantity: options.quantity ?? 1,
      ...(options.override
        ? { override_total: options.override.total, override_reason: options.override.reason }
        : {}),
    }).select('id').single(),
  )
  if (options.materials?.length) {
    await must(
      admin.from('quote_plate_materials').insert(
        options.materials.map((m) => ({
          plate_id: plate.id,
          material_id: m.materialId,
          grams: m.grams,
        })),
      ),
    )
  }
  return must<PlateRow>(
    admin.from('quote_plates').select(PLATE_COLUMNS).eq('id', plate.id).single(),
  )
}

/** A complete plate: the catalog's printer, 5 h 30 min, 120 g of the catalog's material. */
export function completePlate(catalog: Catalog, extra: PlateOptions = {}): PlateOptions {
  return {
    printerId: catalog.printerId,
    printTimeS: 19800,
    materials: [{ materialId: catalog.materialId, grams: 120 }],
    ...extra,
  }
}

export async function markSent(admin: SupabaseClient, quoteId: number): Promise<void> {
  // A non-draft quote must carry a VAT rate (quotes_vat_rate_check): take the shop's current one.
  const settings = await must<{ vat_rate_pct: Decimal }>(
    admin.from('settings').select('vat_rate_pct').eq('id', 1).single(),
  )
  await must(
    admin.from('quotes').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      vat_rate_pct: settings.vat_rate_pct,
    }).eq('id', quoteId),
  )
}

/** What pricePlate gives for this plate with the current settings, printer and materials. */
export async function expectedPrice(
  admin: SupabaseClient,
  plate: PlateRow,
  markupOverridePct: Decimal | null = null,
): Promise<PriceBreakdown> {
  const settings = await must<Record<string, Decimal>>(
    admin.from('settings').select('*').eq('id', 1).single(),
  )
  const printer = await must<{ hourly_rate: Decimal; power_w: number; failure_rate: number }>(
    admin.from('printers').select('hourly_rate, power_w, failure_rate').eq('id', plate.printer_id)
      .single(),
  )
  const costs = await must<{ id: number; cost_per_kg: Decimal }[]>(
    admin.from('materials').select('id, cost_per_kg').in(
      'id',
      plate.materials.map((m) => m.material_id),
    ),
  )
  return pricePlate({
    printTimeS: plate.print_time_s!,
    materials: plate.materials.map((m) => ({
      grams: m.grams,
      costPerKg: costs.find((c) => c.id === m.material_id)!.cost_per_kg,
    })),
    quantity: plate.quantity,
    hourlyRate: printer.hourly_rate,
    powerW: printer.power_w,
    energyPriceKwh: settings.energy_price_kwh,
    failurePct: printer.failure_rate,
    setupFee: settings.setup_fee,
    markupPct: markupOverridePct ?? settings.default_markup_pct,
    minimumPrice: settings.minimum_item_price,
  })
}
