# Pricing & Duplicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `price-quote` Edge Function that prices a draft quote's items, and a `duplicate-quote` Edge Function
that copies a quote, its files and its slicing results into a new priced draft.

**Architecture:**
- A pure pricing module computes the §5.2 formula with exact `BigInt` fractions.
- `price-quote` checks the caller is active staff, then writes the breakdown with the service role, guarded by each
  item's `updated_at`.
- `duplicate-quote` calls two new service-role-only SQL functions (create the quote copy, copy the items and jobs in
  one transaction), copies the files with Storage `copy` in between, and rolls back by hand if anything fails.

**Tech Stack:** Deno 2 (via scoop) for `supabase/functions`, `@supabase/supabase-js` 2.117.3, `@std/assert` and
`@std/path` from JSR, Supabase CLI 2.120 local stack (Edge Runtime, Postgres, Storage), pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-12-pricing-duplicate-design.md`

## Global Constraints

- Run every command from the repository root `C:\Progetti\3D-Quote` (the parent folder `C:\Progetti` has an unrelated
  npm project that npm can escape into).
- **Git and cloud:**
  - Commit on `develop`. Never push, never merge to `main`.
  - Never touch any cloud Supabase project. Migrations are applied to the local stack only; functions are not deployed.
- **Edge Function style:** `deno fmt` with no semicolons, single quotes, line width 100 (set in
  `supabase/functions/deno.json`). Comments are sparse and explain *why*.
- **Dependencies:** `@supabase/supabase-js` is imported only in `supabase/functions/_shared/supabase.ts`, as
  `npm:@supabase/supabase-js@2.117.3`. Test helpers import `jsr:@std/assert@1.0.13` and `jsr:@std/path@1.0.9` only in
  `supabase/functions/tests/deps.ts`.
- **Error contract:** functions answer JSON `{ "code": "<code>" }` with these statuses: `invalid_request` 400,
  `not_authenticated` 401, `not_staff` 403, `quote_not_found` 404, `quote_not_draft` 409, `duplicate_failed` 500,
  `internal_error` 500.
- **Money:** never use JavaScript floats for prices. Breakdown lines are stored rounded half up to 4 places,
  `computed_total` to 2 places, `markup_pct` to 2 places.
- **SQL:** service functions follow the worker pattern: `security invoker` wrapper in `public`, `security definer` in
  `private` with `set search_path = ''`, EXECUTE for `service_role` only, grants mirrored in
  `supabase/schemas/90_grants.sql` and a hand-written `_setup` migration.
- **Done means:** from the repo root, these all pass:
  - `npm run build`, `npm run lint`, `npm run format:check`, `npm test`;
  - `supabase test db`; `supabase db diff` prints "No schema changes found"; `npm run check:types-fresh`;
  - `npm run functions:check` and `npm run functions:test` (the latter needs `supabase start`).

## Review Focus

1. **A browser preflight** (`OPTIONS`, no `Authorization`) must get 200 with CORS headers, and every error response
   must carry them too, or the web app sees an opaque network error. Pinned in Task 3 (`answers the CORS preflight`).
2. **A price computed from a stale read** must not overwrite a newer change (quantity edited meanwhile). Pinned in
   Task 3 (`skips an item that changed after it was read`).
3. **An exact half cent** (e.g. 1.495, or 0.015 reached through 1 200 s = ⅓ h) must round up, where floats round down.
   Pinned in Task 1.
4. **A duplicate that fails halfway** (a source file missing) must leave no new quote and no copied files. Pinned in
   Task 4 (`cleans up when a file cannot be copied`).
5. **An item on a printer the owner has since deactivated** must still be priced with that printer's rates. Pinned in
   Task 3 (`prices an item whose printer was deactivated`).

---

## File map

```
package.json                                   # + functions:check, functions:test
supabase/
├── config.toml                                # + [functions.price-quote], [functions.duplicate-quote] verify_jwt = false
├── schemas/22_service_api.sql                 # service_create_quote_copy, service_copy_quote_items
├── schemas/90_grants.sql                      # + service role grants
├── migrations/<ts>_service_quote_copy.sql     # generated (db diff)
├── migrations/<ts>_service_quote_copy_setup.sql  # hand-written grants
├── tests/database/11_service_quote_copy.test.sql
└── functions/
    ├── deno.json                              # fmt, lint, compiler options
    ├── _shared/
    │   ├── supabase.ts                        # the one supabase-js import
    │   ├── clients.ts                         # serviceClient()
    │   ├── http.ts                            # CORS, HttpError, json(), createHandler(), readQuoteId()
    │   ├── auth.ts                            # requireStaff()
    │   ├── pricing.ts                         # Fraction, priceItem()
    │   └── price-quote.ts                     # loadPricingSnapshot(), writePrices(), priceQuote()
    ├── price-quote/index.ts
    ├── duplicate-quote/index.ts
    ├── duplicate-quote/duplicate.ts           # duplicateQuote()
    └── tests/
        ├── deps.ts                            # std assert + path
        ├── helpers.ts                         # local stack, clients, sign-in, fixtures, callFunction()
        ├── pricing.test.ts
        ├── price-quote.integration.test.ts
        └── duplicate-quote.integration.test.ts
apps/web/src/lib/database.types.ts             # regenerated
docs/                                          # ADR-0004, edge-functions.md, data-model, overview, getting-started, README
```

---

### Task 1: Deno tooling and the pricing core

**Files:**
- Create: `supabase/functions/deno.json`, `supabase/functions/_shared/pricing.ts`,
  `supabase/functions/tests/deps.ts`, `supabase/functions/tests/pricing.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces (`supabase/functions/_shared/pricing.ts`):
  - `type Decimal = string | number` — a `numeric` value as PostgREST returns it;
  - `class Fraction` with `static of(num: bigint, den?: bigint)`, `static fromDecimal(value: Decimal)`,
    `add(o)`, `mul(o)`, `div(o)`, `compare(o): -1 | 0 | 1`, `max(o)`, `toFixed(places: number): string`
    (half away from zero, i.e. half up for the non-negative amounts priced here);
  - `interface PriceInput { printTimeS: number; filamentG: Decimal; quantity: number; costPerKg: Decimal;
    hourlyRate: Decimal; powerW: number; energyPriceKwh: Decimal; failurePct: Decimal; setupFee: Decimal;
    markupPct: Decimal; minimumPrice: Decimal }`;
  - `interface PriceBreakdown { material_cost: string; machine_cost: string; energy_cost: string;
    failure_cost: string; setup_fee: string; markup_amount: string; markup_pct: string; computed_total: string }`;
  - `priceItem(input: PriceInput): PriceBreakdown`.
- Produces (`supabase/functions/tests/deps.ts`): re-exports `assert`, `assertEquals`, `assertExists`,
  `assertMatch`, `assertNotEquals`, `assertThrows` from `jsr:@std/assert@1.0.13` and `fromFileUrl` from
  `jsr:@std/path@1.0.9`.
- Produces (root `package.json`): `npm run functions:check`, `npm run functions:test`.

- [ ] **Step 1: Install Deno**

Run: `scoop install deno`
Then: `deno --version`
Expected: `deno 2.x.y`. (Scoop is how the Supabase CLI is installed on this machine; if scoop is unavailable use
`winget install DenoLand.Deno`.)

- [ ] **Step 2: Add the Deno config and the npm scripts**

Create `supabase/functions/deno.json`:

```json
{
  "compilerOptions": {
    "strict": true
  },
  "fmt": {
    "semiColons": false,
    "singleQuote": true,
    "lineWidth": 100
  },
  "lint": {
    "rules": {
      "exclude": ["no-import-prefix"]
    }
  },
  "lock": false
}
```

The `no-import-prefix` exclusion is there because the Edge Runtime bundles each function on its own, so the versioned
`npm:` / `jsr:` specifiers stay inline (in exactly two files, see Global Constraints) instead of in an import map.

In the root `package.json`, add these two entries at the end of `"scripts"` (after `check:types-fresh`):

```json
    "functions:check": "deno check --config supabase/functions/deno.json supabase/functions && deno lint --config supabase/functions/deno.json supabase/functions && deno fmt --check --config supabase/functions/deno.json supabase/functions",
    "functions:test": "deno test --config supabase/functions/deno.json --allow-net --allow-env --allow-read --allow-run=supabase supabase/functions/tests"
```

- [ ] **Step 3: Write the failing unit tests**

Create `supabase/functions/tests/deps.ts`:

```ts
export {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from 'jsr:@std/assert@1.0.13'
export { fromFileUrl } from 'jsr:@std/path@1.0.9'
```

Create `supabase/functions/tests/pricing.test.ts`:

```ts
import { assertEquals, assertThrows } from './deps.ts'
import { Fraction, type PriceInput, priceItem } from '../_shared/pricing.ts'

// Functional analysis §5.3: PETG 25.00/kg, 1.50/h and 120 W, energy 0.30/kWh, failure 10 %, setup 5.00,
// markup 30 %, minimum 10.00; 120 g and 5 h 30 min per copy; quantity 2.
const worked: PriceInput = {
  printTimeS: 19800,
  filamentG: '120.00',
  quantity: 2,
  costPerKg: '25.00',
  hourlyRate: '1.50',
  powerW: 120,
  energyPriceKwh: '0.3000',
  failurePct: '10.00',
  setupFee: '5.00',
  markupPct: '30.00',
  minimumPrice: '10.00',
}

// Only the setup fee and markup count, so the total is exactly setupFee × (1 + markup).
const setupOnly = (setupFee: string, markupPct: string): PriceInput => ({
  ...worked,
  printTimeS: 0,
  filamentG: 0,
  quantity: 1,
  setupFee,
  markupPct,
  minimumPrice: 0,
})

Deno.test('prices the worked example of the functional analysis', () => {
  assertEquals(priceItem(worked), {
    material_cost: '3.0000',
    machine_cost: '8.2500',
    energy_cost: '0.1980',
    failure_cost: '1.1448',
    setup_fee: '5.0000',
    markup_amount: '9.0557',
    markup_pct: '30.00',
    computed_total: '39.24',
  })
})

Deno.test('rounds an exact half cent up, where floats round it down', () => {
  // 1.15 × 1.30 = 1.495 exactly; in floats it is 1.4949999999999999.
  assertEquals(priceItem(setupOnly('1.15', '30.00')).computed_total, '1.50')
})

Deno.test('rounds just below a half cent down', () => {
  // 1.14 × 1.3114 = 1.494996
  assertEquals(priceItem(setupOnly('1.14', '31.14')).computed_total, '1.49')
})

Deno.test('prices fractions of an hour exactly', () => {
  // 1 200 s = 1/3 h; × 0.03/h = 0.01; + 50 % = 0.015 exactly, which floats compute as 0.014999999999999998.
  const result = priceItem({
    ...setupOnly('0', '50.00'),
    printTimeS: 1200,
    hourlyRate: '0.03',
    powerW: 1,
    energyPriceKwh: 0,
  })
  assertEquals(result.machine_cost, '0.0100')
  assertEquals(result.markup_amount, '0.0050')
  assertEquals(result.computed_total, '0.02')
})

Deno.test('applies the minimum price to the item total', () => {
  const result = priceItem({
    ...worked,
    quantity: 1,
    printTimeS: 600,
    filamentG: 5,
    setupFee: 0,
    markupPct: 0,
  })
  assertEquals(result.material_cost, '0.1250')
  assertEquals(result.computed_total, '10.00')
})

Deno.test('charges the setup fee once per item, not per copy', () => {
  // (11.448 + 1.1448) × 10 + 5.00 = 130.928; + 30 % = 170.2064
  const result = priceItem({ ...worked, quantity: 10 })
  assertEquals(result.setup_fee, '5.0000')
  assertEquals(result.markup_amount, '39.2784')
  assertEquals(result.computed_total, '170.21')
})

Deno.test('uses the markup it is given', () => {
  const result = priceItem({ ...worked, markupPct: '12.50' })
  assertEquals(result.markup_pct, '12.50')
  assertEquals(result.markup_amount, '3.7732')
  assertEquals(result.computed_total, '33.96')
})

Deno.test('reads numeric values sent as JSON numbers or strings', () => {
  assertEquals(Fraction.fromDecimal(0.3).toFixed(4), '0.3000')
  assertEquals(Fraction.fromDecimal('25.00').toFixed(2), '25.00')
  assertEquals(Fraction.fromDecimal('1e-7').toFixed(8), '0.00000010')
  assertEquals(Fraction.fromDecimal(-1.005).toFixed(2), '-1.01')
  assertThrows(() => Fraction.fromDecimal('1,5'), RangeError)
  assertThrows(() => Fraction.fromDecimal(Number.NaN), RangeError)
})

Deno.test('compares and divides fractions', () => {
  const third = Fraction.of(1n, 3n)
  assertEquals(third.mul(Fraction.of(3n)).compare(Fraction.of(1n)), 0)
  assertEquals(third.max(Fraction.of(1n, 4n)).toFixed(4), '0.3333')
  assertEquals(Fraction.of(2n, -4n).toFixed(1), '-0.5')
  assertThrows(() => Fraction.of(1n, 0n), RangeError)
})
```

- [ ] **Step 4: Run them to verify they fail**

Run: `deno test --config supabase/functions/deno.json supabase/functions/tests/pricing.test.ts`
Expected: FAIL — `Module not found "…/_shared/pricing.ts"`.

- [ ] **Step 5: Implement the pricing module**

Create `supabase/functions/_shared/pricing.ts`:

```ts
// The pricing formula of docs/frontend/functional-analysis.md §5.2, in exact arithmetic. Print time arrives in
// seconds, so hours are often not finite decimals (1 000 s = 0.2777… h); floats would round some half cents the
// wrong way.

/** A Postgres `numeric` as PostgREST returns it: a JSON number, or a string. */
export type Decimal = string | number

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

export class Fraction {
  private constructor(readonly num: bigint, readonly den: bigint) {}

  static of(num: bigint, den: bigint = 1n): Fraction {
    if (den === 0n) throw new RangeError('Division by zero')
    if (den < 0n) {
      num = -num
      den = -den
    }
    const divisor = gcd(num, den)
    return new Fraction(num / divisor, den / divisor)
  }

  static fromDecimal(value: Decimal): Fraction {
    const text = String(value).trim()
    const match = /^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
    if (!match) throw new RangeError(`Not a decimal number: ${text}`)
    const [, sign, whole, fraction = '', exponent = '0'] = match
    let num = BigInt(whole + fraction)
    let den = 10n ** BigInt(fraction.length)
    const shift = Number(exponent)
    if (shift > 0) num *= 10n ** BigInt(shift)
    if (shift < 0) den *= 10n ** BigInt(-shift)
    return Fraction.of(sign ? -num : num, den)
  }

  add(other: Fraction): Fraction {
    return Fraction.of(this.num * other.den + other.num * this.den, this.den * other.den)
  }

  mul(other: Fraction): Fraction {
    return Fraction.of(this.num * other.num, this.den * other.den)
  }

  div(other: Fraction): Fraction {
    return Fraction.of(this.num * other.den, this.den * other.num)
  }

  compare(other: Fraction): -1 | 0 | 1 {
    const diff = this.num * other.den - other.num * this.den
    return diff < 0n ? -1 : diff > 0n ? 1 : 0
  }

  max(other: Fraction): Fraction {
    return this.compare(other) >= 0 ? this : other
  }

  /** Rounds half away from zero (half up for the non-negative amounts priced here). */
  toFixed(places: number): string {
    const negative = this.num < 0n
    const scaled = (negative ? -this.num : this.num) * 10n ** BigInt(places)
    let rounded = scaled / this.den
    if ((scaled % this.den) * 2n >= this.den) rounded += 1n
    const digits = rounded.toString().padStart(places + 1, '0')
    const text = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`
    return negative && rounded !== 0n ? `-${text}` : text
  }
}

export interface PriceInput {
  printTimeS: number
  filamentG: Decimal
  quantity: number
  costPerKg: Decimal
  hourlyRate: Decimal
  powerW: number
  energyPriceKwh: Decimal
  failurePct: Decimal
  setupFee: Decimal
  markupPct: Decimal
  minimumPrice: Decimal
}

/** The `quote_items` price columns, as decimal strings. */
export interface PriceBreakdown {
  material_cost: string
  machine_cost: string
  energy_cost: string
  failure_cost: string
  setup_fee: string
  markup_amount: string
  markup_pct: string
  computed_total: string
}

const dec = Fraction.fromDecimal
const int = (value: number) => Fraction.of(BigInt(value))
const HUNDRED = int(100)
const THOUSAND = int(1000)

export function priceItem(input: PriceInput): PriceBreakdown {
  const hours = Fraction.of(BigInt(input.printTimeS), 3600n)
  // Per copy
  const material = dec(input.filamentG).div(THOUSAND).mul(dec(input.costPerKg))
  const machine = hours.mul(dec(input.hourlyRate))
  const energy = int(input.powerW).div(THOUSAND).mul(hours).mul(dec(input.energyPriceKwh))
  const copy = material.add(machine).add(energy)
  const failure = copy.mul(dec(input.failurePct)).div(HUNDRED)
  // Per item
  const setupFee = dec(input.setupFee)
  const markupPct = dec(input.markupPct)
  const production = copy.add(failure).mul(int(input.quantity)).add(setupFee)
  const markup = production.mul(markupPct).div(HUNDRED)
  const total = production.add(markup).max(dec(input.minimumPrice))

  return {
    material_cost: material.toFixed(4),
    machine_cost: machine.toFixed(4),
    energy_cost: energy.toFixed(4),
    failure_cost: failure.toFixed(4),
    setup_fee: setupFee.toFixed(4),
    markup_amount: markup.toFixed(4),
    markup_pct: markupPct.toFixed(2),
    computed_total: total.toFixed(2),
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `deno test --config supabase/functions/deno.json supabase/functions/tests/pricing.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Format, lint and type-check**

Run: `deno fmt --config supabase/functions/deno.json supabase/functions`
Run: `npm run functions:check`
Expected: no errors. If `deno lint` reports `no-import-prefix` as an unknown rule (older Deno), delete the `"lint"`
block from `deno.json` and run it again. If `deno check` refuses the directory argument, change it in the
`functions:check` script to the quoted glob `\"supabase/functions/**/*.ts\"` (Deno expands it itself).

- [ ] **Step 8: Commit**

```bash
git add package.json supabase/functions
git commit -m "feat(functions): add Deno tooling and exact-arithmetic item pricing"
```

---

### Task 2: Service functions for copying a quote

**Files:**
- Create: `supabase/tests/database/11_service_quote_copy.test.sql`, `supabase/schemas/22_service_api.sql`
- Modify: `supabase/schemas/90_grants.sql` (after the worker block)
- Create (generated): `supabase/migrations/<timestamp>_service_quote_copy.sql`
- Create: `supabase/migrations/<timestamp>_service_quote_copy_setup.sql`
- Modify (generated): `apps/web/src/lib/database.types.ts`

**Interfaces:**
- Produces, callable by `service_role` only:
  - `public.service_create_quote_copy(source_id bigint, created_by uuid) returns bigint` — raises
    `P0002 quote_not_found`;
  - `public.service_copy_quote_items(source_id bigint, new_id bigint, files jsonb) returns void` — `files` is
    `[{ "item_id": <bigint>, "model_path": "<new_id>/<uuid>/<name>" }]`, one entry per source item. Raises
    `P0002 quote_not_found` / `P0001 quote_not_draft` (target), `22023 invalid_copy`, `22023 invalid_model_path`,
    `P0002 model_not_found`.
  - From supabase-js: `admin.rpc('service_create_quote_copy', { source_id, created_by })` and
    `admin.rpc('service_copy_quote_items', { source_id, new_id, files })`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/11_service_quote_copy.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'owner.copy@test.local'),
  ('00000000-0000-4000-8000-0000000000c2', 'operator.copy@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000c1', 'Copy Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000c2', 'Copy Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (910001, 'Copy MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (910001, 'Copy PETG', 'PETG', 1.27, 25.00);
insert into public.clients (id, name) overriding system value values (910001, 'Copy Client');
insert into public.quotes (id, client_id, created_by, notes, markup_override_pct) overriding system value values
  (910001, 910001, '00000000-0000-4000-8000-0000000000c1', 'Rush job', 12.50);
insert into storage.objects (bucket_id, name) values
  ('models', '910001/s1/sliced.stl'),
  ('models', '910001/s2/waiting.stl'),
  ('models', '910001/s3/bare.stl');
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id, quantity,
  layer_height_mm, infill_percent, supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm,
  material_cost, computed_total, markup_pct, priced_at, override_total, override_reason
) overriding system value values
  (910101, 910001, '910001/s1/sliced.stl', 'sliced.stl', 'Sliced part', 910001, 910001, 3,
   0.15, 30, true, 19800, 120.00, 100.0, 80.0, 40.0, 3.0000, 39.24, 30.00, now(), 50.00, 'Agreed price'),
  (910102, 910001, '910001/s2/waiting.stl', 'waiting.stl', 'Waiting part', 910001, 910001, 1,
   0.20, 20, false, null, null, null, null, null, null, null, null, null, null, null),
  (910103, 910001, '910001/s3/bare.stl', 'bare.stl', 'Bare part', null, null, 1,
   0.20, 20, false, null, null, null, null, null, null, null, null, null, null, null);
-- An older failed attempt, then the newest succeeded one.
insert into public.slicing_jobs (
  quote_item_id, status, attempts, print_time_s, filament_g, filament_mm, layer_count,
  bbox_x_mm, bbox_y_mm, bbox_z_mm, slicer_version, started_at, finished_at
) values
  (910101, 'failed', 1, null, null, null, null, null, null, null, null, now(), now()),
  (910101, 'succeeded', 2, 19800, 120.00, 40000.00, 266, 100.0, 80.0, 40.0, 'PrusaSlicer 2.9.0', now(), now());
update public.quotes set status = 'sent', sent_at = now() where id = 910001;
do $$ begin perform pgmq.purge_queue('slicing_jobs'); end $$;

-- Privileges
select is(
  array(
    select f from unnest(array[
      'public.service_create_quote_copy(bigint,uuid)',
      'private.service_create_quote_copy(bigint,uuid)',
      'public.service_copy_quote_items(bigint,bigint,jsonb)',
      'private.service_copy_quote_items(bigint,bigint,jsonb)'
    ]) as f
    where has_function_privilege('authenticated', f, 'execute')
  ),
  array[]::text[],
  'authenticated cannot execute the service functions'
);
select ok(
  has_function_privilege('service_role', 'public.service_create_quote_copy(bigint,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.service_copy_quote_items(bigint,bigint,jsonb)', 'execute'),
  'the service role can execute them'
);

-- Creating the copy
set local role service_role;
select lives_ok(
  $$select public.service_create_quote_copy(910001, '00000000-0000-4000-8000-0000000000c2')$$,
  'the service role creates a copy of a sent quote'
);
select throws_ok(
  $$select public.service_create_quote_copy(999999999, '00000000-0000-4000-8000-0000000000c1')$$,
  'P0002', 'quote_not_found', 'an unknown source is rejected'
);
reset role;

select results_eq(
  $$select status, client_id, notes, markup_override_pct, created_by, valid_until, sent_at
    from public.quotes where client_id = 910001 and id <> 910001$$,
  $$select 'draft'::text, 910001::bigint, 'Rush job'::text, 12.50::numeric,
           '00000000-0000-4000-8000-0000000000c2'::uuid,
           private.shop_today() + (select default_validity_days from public.settings where id = 1),
           null::timestamptz$$,
  'the copy is a draft with the client, notes, markup and creator, and the default validity'
);
select isnt(
  (select number from public.quotes where client_id = 910001 and id <> 910001),
  (select number from public.quotes where id = 910001),
  'the copy gets its own number'
);

-- Copying the items (the Edge Function copies the files first)
insert into storage.objects (bucket_id, name)
select 'models', q.id || p.path
from public.quotes q, unnest(array['/n1/sliced.stl', '/n2/waiting.stl', '/n3/bare.stl']) as p (path)
where q.client_id = 910001 and q.id <> 910001;

set local role service_role;
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  '22023', 'invalid_copy', 'every source item must be listed'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 999999, 'model_path', c.id || '/n3/bare.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  '22023', 'invalid_copy', 'items of other quotes are rejected'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 910103, 'model_path', '910001/s3/bare.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  '22023', 'invalid_model_path', 'files must be in the new quote''s folder'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 910103, 'model_path', c.id || '/n9/missing.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  'P0002', 'model_not_found', 'files must have been copied'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, 910001, '[]'::jsonb)$$,
  'P0001', 'quote_not_draft', 'the target must be a draft'
);
select lives_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 910103, 'model_path', c.id || '/n3/bare.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  'the service role copies the items'
);
reset role;

select results_eq(
  $$select original_filename, description, printer_id, material_id, quantity, layer_height_mm, infill_percent,
           supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, override_total, override_reason
    from public.quote_items
    where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
    order by id$$,
  $$select original_filename, description, printer_id, material_id, quantity, layer_height_mm, infill_percent,
           supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, override_total, override_reason
    from public.quote_items where quote_id = 910001 order by id$$,
  'items carry settings, results and overrides, in the source order'
);
select is(
  array(
    select model_path from public.quote_items
    where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
    order by id
  ),
  array(
    select (select id from public.quotes where client_id = 910001 and id <> 910001) || u.path
    from unnest(array['/n1/sliced.stl', '/n2/waiting.stl', '/n3/bare.stl']) with ordinality as u (path, n)
    order by u.n
  ),
  'items point at the copied files'
);
select is(
  (select count(*)::int from public.quote_items
   where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and (material_cost is not null or computed_total is not null or markup_pct is not null or priced_at is not null)),
  0,
  'the price breakdown is not copied'
);
select results_eq(
  $$select j.status, j.attempts, j.print_time_s, j.filament_g, j.filament_mm, j.layer_count,
           j.bbox_x_mm, j.bbox_y_mm, j.bbox_z_mm, j.slicer_version, j.finished_at is not null
    from public.slicing_jobs j
    join public.quote_items i on i.id = j.quote_item_id
    where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
      and i.description = 'Sliced part'$$,
  $$values ('succeeded'::text, 2::smallint, 19800, 120.00::numeric, 40000.00::numeric, 266,
            100.0::numeric, 80.0::numeric, 40.0::numeric, 'PrusaSlicer 2.9.0'::text, true)$$,
  'a sliced item gets one succeeded job, with the newest succeeded job''s details'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and i.description = 'Waiting part' and j.status = 'queued'),
  1,
  'an unsliced item with printer and material is queued'
);
select is(
  (select (message ->> 'job_id')::bigint from pgmq.q_slicing_jobs),
  (select j.id from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and i.description = 'Waiting part'),
  'its queue message is sent'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and i.description = 'Bare part'),
  0,
  'an item without printer or material gets no job'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db`
Expected: `11_service_quote_copy.test.sql` FAILS with `function public.service_create_quote_copy(…) does not exist`
(or its privilege check fails); every other file passes.

- [ ] **Step 3: Add the functions to the declarative schema**

Create `supabase/schemas/22_service_api.sql`:

```sql
-- Service-role functions behind the duplicate-quote Edge Function. The function copies the model files with the
-- Storage API between the two calls, because files can't be copied from SQL.

-- A new draft with the source's client, notes and markup override. The numbering trigger assigns the number and
-- the default validity.
create or replace function private.service_create_quote_copy(p_source_id bigint, p_created_by uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.quotes;
  v_id bigint;
begin
  select * into v_source from public.quotes where id = p_source_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  insert into public.quotes (client_id, notes, markup_override_pct, created_by)
  values (v_source.client_id, v_source.notes, v_source.markup_override_pct, p_created_by)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.service_create_quote_copy(source_id bigint, created_by uuid)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.service_create_quote_copy($1, $2);
$$;

-- Copies every source item into the new draft, pointing at its copied file. Results and price overrides are kept,
-- the price breakdown is not (the Edge Function prices the copy). A sliced item gets a succeeded job so it needn't
-- be sliced again; an unsliced item with printer and material is queued.
create or replace function private.service_copy_quote_items(p_source_id bigint, p_new_id bigint, p_files jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_item_id bigint;
begin
  perform private.require_draft_quote(p_new_id);

  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'invalid_copy' using errcode = '22023';
  end if;
  if (select array_agg((e ->> 'item_id')::bigint order by (e ->> 'item_id')::bigint)
      from jsonb_array_elements(p_files) as e)
     is distinct from
     (select array_agg(i.id order by i.id) from public.quote_items i where i.quote_id = p_source_id) then
    raise exception 'invalid_copy' using errcode = '22023';
  end if;

  for r in
    select i.*, e ->> 'model_path' as new_path
    from jsonb_array_elements(p_files) as e
    join public.quote_items i on i.id = (e ->> 'item_id')::bigint
    order by i.id
  loop
    if r.new_path is null or split_part(r.new_path, '/', 1) <> p_new_id::text then
      raise exception 'invalid_model_path' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'models' and name = r.new_path) then
      raise exception 'model_not_found' using errcode = 'P0002';
    end if;

    insert into public.quote_items (
      quote_id, model_path, original_filename, description, printer_id, material_id, quantity,
      layer_height_mm, infill_percent, supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm,
      override_total, override_reason
    ) values (
      p_new_id, r.new_path, r.original_filename, r.description, r.printer_id, r.material_id, r.quantity,
      r.layer_height_mm, r.infill_percent, r.supports, r.print_time_s, r.filament_g, r.bbox_x_mm, r.bbox_y_mm,
      r.bbox_z_mm, r.override_total, r.override_reason
    )
    returning id into v_item_id;

    if r.print_time_s is not null then
      -- The item's own results, so the copy matches what was priced; the rest from the newest succeeded job.
      insert into public.slicing_jobs (
        quote_item_id, status, attempts, print_time_s, filament_g, filament_mm, layer_count,
        bbox_x_mm, bbox_y_mm, bbox_z_mm, slicer_version, queued_at, started_at, finished_at
      )
      select v_item_id, 'succeeded', coalesce(j.attempts, 0), r.print_time_s, r.filament_g, j.filament_mm,
             j.layer_count, r.bbox_x_mm, r.bbox_y_mm, r.bbox_z_mm, j.slicer_version, now(), now(), now()
      from (select 1) as one
      left join lateral (
        select sj.attempts, sj.filament_mm, sj.layer_count, sj.slicer_version
        from public.slicing_jobs sj
        where sj.quote_item_id = r.id and sj.status = 'succeeded'
        order by sj.id desc
        limit 1
      ) as j on true;
    elsif r.printer_id is not null and r.material_id is not null then
      perform private.enqueue_slicing_job(v_item_id);
    end if;
  end loop;
end;
$$;

create or replace function public.service_copy_quote_items(source_id bigint, new_id bigint, files jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.service_copy_quote_items($1, $2, $3);
$$;
```

In `supabase/schemas/90_grants.sql`, add this block right after the `-- worker functions: service role only` block:

```sql
-- duplicate-quote service functions: service role only
grant execute on function
  public.service_create_quote_copy(bigint, uuid),
  private.service_create_quote_copy(bigint, uuid),
  public.service_copy_quote_items(bigint, bigint, jsonb),
  private.service_copy_quote_items(bigint, bigint, jsonb)
to service_role;
```

- [ ] **Step 4: Generate the migration and add the grants migration**

Run: `supabase db diff -f service_quote_copy`
Expected: a new `supabase/migrations/<timestamp>_service_quote_copy.sql` with the four `create or replace function`
statements and nothing else (besides Supabase's header lines). Open it and check.

Run: `supabase migration new service_quote_copy_setup`, then put this in the created file:

```sql
-- Function grants for the duplicate-quote service functions, mirrored in supabase/schemas/90_grants.sql. New
-- functions are executable by PUBLIC by default, so every grant is revoked before granting the service role.
revoke execute on function
  public.service_create_quote_copy(bigint, uuid),
  private.service_create_quote_copy(bigint, uuid),
  public.service_copy_quote_items(bigint, bigint, jsonb),
  private.service_copy_quote_items(bigint, bigint, jsonb)
from public, anon, authenticated;
grant execute on function
  public.service_create_quote_copy(bigint, uuid),
  private.service_create_quote_copy(bigint, uuid),
  public.service_copy_quote_items(bigint, bigint, jsonb),
  private.service_copy_quote_items(bigint, bigint, jsonb)
to service_role;
```

- [ ] **Step 5: Rebuild and run the tests**

Run: `supabase db reset` then `supabase test db`
Expected: all 12 files pass, including `11_service_quote_copy.test.sql` (19 tests) and `01_structure.test.sql`.

Run: `supabase db diff`
Expected: `No schema changes found`

Run: `supabase db advisors --local`
Expected: no new findings for the service functions.

- [ ] **Step 6: Regenerate the web app's database types**

Run: `npm run gen:types`
Expected: `apps/web/src/lib/database.types.ts` gains `service_create_quote_copy` and `service_copy_quote_items` under
`Functions`. Then run `npm run check:types-fresh` (prints that the file is up to date) and `npm run build` (passes).

- [ ] **Step 7: Commit**

```bash
git add supabase/schemas/22_service_api.sql supabase/schemas/90_grants.sql supabase/migrations supabase/tests/database/11_service_quote_copy.test.sql apps/web/src/lib/database.types.ts
git commit -m "feat(db): add service-role functions that copy a quote and its items"
```

---

### Task 3: Shared function plumbing and `price-quote`

**Files:**
- Create: `supabase/functions/_shared/supabase.ts`, `_shared/clients.ts`, `_shared/http.ts`, `_shared/auth.ts`,
  `_shared/price-quote.ts`, `supabase/functions/price-quote/index.ts`
- Create: `supabase/functions/tests/helpers.ts`, `supabase/functions/tests/price-quote.integration.test.ts`
- Modify: `supabase/config.toml` (function blocks)

**Interfaces:**
- Consumes: `priceItem`, `PriceInput`, `Decimal`, `Fraction` (Task 1).
- Produces:
  - `_shared/supabase.ts`: re-exports `createClient` and `type SupabaseClient` from `npm:@supabase/supabase-js@2.117.3`;
  - `_shared/clients.ts`: `serviceClient(): SupabaseClient`;
  - `_shared/http.ts`: `corsHeaders`, `class HttpError(status: number, code: string)`,
    `json(status: number, body: unknown): Response`,
    `createHandler(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>`,
    `readQuoteId(req: Request): Promise<number>`;
  - `_shared/auth.ts`: `requireStaff(req: Request, admin: SupabaseClient): Promise<string>` (the caller's user id);
  - `_shared/price-quote.ts`: `interface PricingSnapshot { quoteId: number; items: { id: number; updatedAt: string;
    input: PriceInput | null }[] }`, `interface PriceQuoteResult { priced: number; skipped: number }`,
    `loadPricingSnapshot(admin, quoteId): Promise<PricingSnapshot>`,
    `writePrices(admin, snapshot): Promise<PriceQuoteResult>`, `priceQuote(admin, quoteId): Promise<PriceQuoteResult>`;
  - `tests/helpers.ts` (used by Task 4): `OWNER_ID`, `OPERATOR_ID`, `OWNER_EMAIL`, `OPERATOR_EMAIL`, `PASSWORD`,
    `adminClient()`, `signIn(email, password?)`, `callFunction(name, body, token?)` →
    `{ status, headers, body }`, `preflight(name): Promise<Response>`, `createCatalog(admin)`,
    `createQuote(admin, clientId, extra?)`, `createItem(admin, quoteId, options)`, `markSent(admin, quoteId)`,
    `expectedPrice(admin, item)`, `must(query)`.

- [ ] **Step 1: Register the functions with JWT checking in code**

Append to `supabase/config.toml`:

```toml

# The functions check the caller's JWT themselves (auth.getUser), so their 401s carry CORS headers and a code.
[functions.price-quote]
verify_jwt = false

[functions.duplicate-quote]
verify_jwt = false
```

- [ ] **Step 2: Write the test helpers**

Create `supabase/functions/tests/helpers.ts`:

```ts
// Integration test helpers. They run against the local stack (`supabase start`), read its URLs and keys from
// `supabase status`, and create their own uniquely named rows, so runs don't depend on each other.
import { createClient, type SupabaseClient } from '../_shared/supabase.ts'
import { type Decimal, type PriceBreakdown, priceItem } from '../_shared/pricing.ts'
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

export async function adminClient(): Promise<SupabaseClient> {
  const { apiUrl, secretKey } = await localStack()
  return createClient(apiUrl, secretKey, noSession)
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
  body: { code?: string; priced?: number; skipped?: number; quote_id?: number }
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
      build_x_mm: 250,
      build_y_mm: 210,
      build_z_mm: 220,
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
    admin.from('quotes').insert({ client_id: clientId, created_by: OWNER_ID, ...extra }).select('id')
      .single(),
  )
  return quote.id
}

export interface ItemOptions {
  printerId?: number
  materialId?: number
  quantity?: number
  /** Sets the item's results and a succeeded job. */
  sliced?: boolean
  override?: { total: number; reason: string }
}

export interface ItemRow {
  id: number
  model_path: string
  updated_at: string
  quantity: number
  print_time_s: number | null
  filament_g: Decimal | null
  printer_id: number | null
  material_id: number | null
}

/** Uploads a small file and creates an item for it with the service role. */
export async function createItem(
  admin: SupabaseClient,
  quoteId: number,
  options: ItemOptions = {},
): Promise<ItemRow> {
  const path = `${quoteId}/${crypto.randomUUID()}/part.stl`
  await must(admin.storage.from('models').upload(path, new Blob(['solid itest\nendsolid itest\n'])))
  const item = await must<ItemRow>(
    admin.from('quote_items').insert({
      quote_id: quoteId,
      model_path: path,
      original_filename: 'part.stl',
      description: 'Part',
      printer_id: options.printerId ?? null,
      material_id: options.materialId ?? null,
      quantity: options.quantity ?? 1,
      ...(options.sliced
        ? { print_time_s: 19800, filament_g: 120, bbox_x_mm: 100, bbox_y_mm: 80, bbox_z_mm: 40 }
        : {}),
      ...(options.override
        ? { override_total: options.override.total, override_reason: options.override.reason }
        : {}),
    }).select(
      'id, model_path, updated_at, quantity, print_time_s, filament_g, printer_id, material_id',
    ).single(),
  )
  if (options.sliced) {
    await must(
      admin.from('slicing_jobs').insert({
        quote_item_id: item.id,
        status: 'succeeded',
        attempts: 1,
        print_time_s: 19800,
        filament_g: 120,
        filament_mm: 40000,
        layer_count: 266,
        bbox_x_mm: 100,
        bbox_y_mm: 80,
        bbox_z_mm: 40,
        slicer_version: 'itest',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      }),
    )
  }
  return item
}

export async function markSent(admin: SupabaseClient, quoteId: number): Promise<void> {
  await must(
    admin.from('quotes').update({ status: 'sent', sent_at: new Date().toISOString() }).eq(
      'id',
      quoteId,
    ),
  )
}

/** What priceItem gives for this item with the current settings, printer and material. */
export async function expectedPrice(
  admin: SupabaseClient,
  item: ItemRow,
  markupOverridePct: Decimal | null = null,
): Promise<PriceBreakdown> {
  const settings = await must<Record<string, Decimal>>(
    admin.from('settings').select('*').eq('id', 1).single(),
  )
  const printer = await must<{ hourly_rate: Decimal; power_w: number }>(
    admin.from('printers').select('hourly_rate, power_w').eq('id', item.printer_id).single(),
  )
  const material = await must<{ cost_per_kg: Decimal }>(
    admin.from('materials').select('cost_per_kg').eq('id', item.material_id).single(),
  )
  return priceItem({
    printTimeS: item.print_time_s!,
    filamentG: item.filament_g!,
    quantity: item.quantity,
    costPerKg: material.cost_per_kg,
    hourlyRate: printer.hourly_rate,
    powerW: printer.power_w,
    energyPriceKwh: settings.energy_price_kwh,
    failurePct: settings.failure_allowance_pct,
    setupFee: settings.setup_fee,
    markupPct: markupOverridePct ?? settings.default_markup_pct,
    minimumPrice: settings.minimum_item_price,
  })
}
```

- [ ] **Step 3: Write the failing integration tests**

Create `supabase/functions/tests/price-quote.integration.test.ts`:

```ts
import { assert, assertEquals } from './deps.ts'
import { Fraction } from '../_shared/pricing.ts'
import { loadPricingSnapshot, writePrices } from '../_shared/price-quote.ts'
import {
  adminClient,
  callFunction,
  createCatalog,
  createItem,
  createQuote,
  expectedPrice,
  markSent,
  must,
  OPERATOR_EMAIL,
  preflight,
  signIn,
} from './helpers.ts'

const COLUMNS =
  'id, material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct, computed_total, override_total, item_total, priced_at'

type Row = Record<string, string | number | null>

/** The stored breakdown as the decimal strings priceItem returns. */
function breakdown(row: Row) {
  const fixed = (value: string | number | null, places: number) =>
    value === null ? null : Fraction.fromDecimal(value).toFixed(places)
  return {
    material_cost: fixed(row.material_cost, 4),
    machine_cost: fixed(row.machine_cost, 4),
    energy_cost: fixed(row.energy_cost, 4),
    failure_cost: fixed(row.failure_cost, 4),
    setup_fee: fixed(row.setup_fee, 4),
    markup_amount: fixed(row.markup_amount, 4),
    markup_pct: fixed(row.markup_pct, 2),
    computed_total: fixed(row.computed_total, 2),
  }
}

Deno.test('prices sliced items, skips unsliced ones and keeps overrides', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  const sliced = await createItem(admin, quoteId, { printerId, materialId, quantity: 2, sliced: true })
  const waiting = await createItem(admin, quoteId, { printerId, materialId })
  const overridden = await createItem(admin, quoteId, {
    printerId,
    materialId,
    sliced: true,
    override: { total: 50, reason: 'Agreed price' },
  })

  const response = await callFunction('price-quote', { quote_id: quoteId }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.status, 200)
  assertEquals(response.body, { priced: 2, skipped: 1 })
  const rows = await must<Row[]>(
    admin.from('quote_items').select(COLUMNS).eq('quote_id', quoteId).order('id'),
  )
  assertEquals(breakdown(rows[0]), await expectedPrice(admin, sliced))
  assert(rows[0].priced_at !== null)
  assertEquals(rows[1].computed_total, null)
  assertEquals(rows[1].priced_at, null)
  assertEquals(breakdown(rows[2]), await expectedPrice(admin, overridden))
  assertEquals(Number(rows[2].override_total), 50)
  assertEquals(Number(rows[2].item_total), 50)
  assertEquals(waiting.id, rows[1].id)
})

Deno.test('uses the quote markup override', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId, { markup_override_pct: 12.5 })
  const item = await createItem(admin, quoteId, { printerId, materialId, sliced: true })

  const response = await callFunction('price-quote', { quote_id: quoteId }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.status, 200)
  const row = await must<Row>(admin.from('quote_items').select(COLUMNS).eq('id', item.id).single())
  assertEquals(breakdown(row), await expectedPrice(admin, item, 12.5))
  assertEquals(breakdown(row).markup_pct, '12.50')
})

Deno.test('prices an item whose printer was deactivated', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  const item = await createItem(admin, quoteId, { printerId, materialId, sliced: true })
  await must(admin.from('printers').update({ active: false }).eq('id', printerId))

  const response = await callFunction('price-quote', { quote_id: quoteId }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.body, { priced: 1, skipped: 0 })
  const row = await must<Row>(admin.from('quote_items').select(COLUMNS).eq('id', item.id).single())
  assertEquals(breakdown(row), await expectedPrice(admin, item))
})

Deno.test('answers an empty draft with nothing priced', async () => {
  const admin = await adminClient()
  const { clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)

  const response = await callFunction('price-quote', { quote_id: quoteId }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.status, 200)
  assertEquals(response.body, { priced: 0, skipped: 0 })
})

Deno.test('skips an item that changed after it was read', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  const item = await createItem(admin, quoteId, { printerId, materialId, sliced: true })

  const snapshot = await loadPricingSnapshot(admin, quoteId)
  await must(admin.from('quote_items').update({ quantity: 5 }).eq('id', item.id))
  const result = await writePrices(admin, snapshot)

  assertEquals(result, { priced: 0, skipped: 1 })
  const row = await must<Row>(admin.from('quote_items').select(COLUMNS).eq('id', item.id).single())
  assertEquals(row.computed_total, null)
})

Deno.test('refuses a quote that is not a draft', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const quoteId = await createQuote(admin, clientId)
  await createItem(admin, quoteId, { printerId, materialId, sliced: true })
  await markSent(admin, quoteId)

  const response = await callFunction('price-quote', { quote_id: quoteId }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.status, 409)
  assertEquals(response.body, { code: 'quote_not_draft' })
})

Deno.test('answers 404 for an unknown quote', async () => {
  const response = await callFunction('price-quote', { quote_id: 2147480000 }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.status, 404)
  assertEquals(response.body, { code: 'quote_not_found' })
})

Deno.test('rejects bad requests', async () => {
  const token = await signIn(OPERATOR_EMAIL)
  for (const body of ['not json', '{"quote_id":"7"}', '{"quote_id":0}', '{"quote_id":1.5}', '{}']) {
    const response = await callFunction('price-quote', body, token)
    assertEquals(response.status, 400, body)
    assertEquals(response.body, { code: 'invalid_request' }, body)
  }
})

Deno.test('rejects callers without a valid session', async () => {
  for (const token of [undefined, 'not-a-jwt']) {
    const response = await callFunction('price-quote', { quote_id: 1 }, token)
    assertEquals(response.status, 401)
    assertEquals(response.body, { code: 'not_authenticated' })
    assertEquals(response.headers.get('access-control-allow-origin'), '*')
  }
})

Deno.test('rejects signed-in users without an active staff row', async () => {
  const admin = await adminClient()
  const email = `nostaff-${crypto.randomUUID().slice(0, 8)}@test.local`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
  })
  if (error) throw error
  try {
    const response = await callFunction('price-quote', { quote_id: 1 }, await signIn(email))
    assertEquals(response.status, 403)
    assertEquals(response.body, { code: 'not_staff' })
  } finally {
    await admin.auth.admin.deleteUser(data.user.id)
  }
})

Deno.test('answers the CORS preflight', async () => {
  const response = await preflight('price-quote')

  assertEquals(response.status, 200)
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
  assert(response.headers.get('access-control-allow-headers')?.includes('authorization'))
  assert(response.headers.get('access-control-allow-methods')?.includes('POST'))
})
```

- [ ] **Step 4: Run them to verify they fail**

Run: `supabase stop` then `supabase start` (picks up the new `config.toml` blocks), then run the file:
`deno test --config supabase/functions/deno.json --allow-net --allow-env --allow-read --allow-run=supabase supabase/functions/tests/price-quote.integration.test.ts`
Expected: FAIL — `Module not found "…/_shared/price-quote.ts"`.

- [ ] **Step 5: Implement the shared plumbing**

Create `supabase/functions/_shared/supabase.ts`:

```ts
// The one place supabase-js is imported, so its version is pinned once.
export { createClient } from 'npm:@supabase/supabase-js@2.117.3'
export type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
```

Create `supabase/functions/_shared/clients.ts`:

```ts
import { createClient, type SupabaseClient } from './supabase.ts'

// The new secret key when the runtime provides it, the legacy service_role key otherwise.
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    const key = JSON.parse(keys).default
    if (typeof key === 'string' && key !== '') return key
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  throw new Error('No service key in the environment')
}

/** A client that bypasses RLS. Use it only after requireStaff(). */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('SUPABASE_URL is not set')
  return createClient(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

Create `supabase/functions/_shared/http.ts`:

```ts
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** An error the caller sees as `{ code }` with this status. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Answers the preflight, allows only POST, and turns every error into `{ code }` with CORS headers. */
export function createHandler(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    try {
      if (req.method !== 'POST') throw new HttpError(400, 'invalid_request')
      return await handler(req)
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { code: error.code })
      console.error(error)
      return json(500, { code: 'internal_error' })
    }
  }
}

export async function readQuoteId(req: Request): Promise<number> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, 'invalid_request')
  }
  const id = typeof body === 'object' && body !== null
    ? (body as { quote_id?: unknown }).quote_id
    : undefined
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, 'invalid_request')
  }
  return id
}
```

Create `supabase/functions/_shared/auth.ts`:

```ts
import type { SupabaseClient } from './supabase.ts'
import { HttpError } from './http.ts'

/** The caller's user id, if the bearer token is a valid session of an active staff member. */
export async function requireStaff(req: Request, admin: SupabaseClient): Promise<string> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'not_authenticated')

  const { data, error } = await admin.auth.getUser(token)
  // An Auth outage is not the caller's fault: let it surface as a 500.
  if (error && (error.status ?? 0) >= 500) throw error
  if (error || !data.user) throw new HttpError(401, 'not_authenticated')

  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('active')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (staffError) throw staffError
  if (!staff?.active) throw new HttpError(403, 'not_staff')
  return data.user.id
}
```

- [ ] **Step 6: Implement pricing a quote and the function**

Create `supabase/functions/_shared/price-quote.ts`:

```ts
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
    items: (items as ItemRow[]).map((item) => ({
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
```

Create `supabase/functions/price-quote/index.ts`:

```ts
// POST { quote_id } → 200 { priced, skipped }. See docs/supabase/edge-functions.md.
import { requireStaff } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/clients.ts'
import { createHandler, json, readQuoteId } from '../_shared/http.ts'
import { priceQuote } from '../_shared/price-quote.ts'

Deno.serve(createHandler(async (req) => {
  const admin = serviceClient()
  await requireStaff(req, admin)
  const quoteId = await readQuoteId(req)
  return json(200, await priceQuote(admin, quoteId))
}))
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:
`deno test --config supabase/functions/deno.json --allow-net --allow-env --allow-read --allow-run=supabase supabase/functions/tests/price-quote.integration.test.ts`
Expected: PASS, 11 tests. If every call answers 500 `internal_error`, read the function log with
`docker logs supabase_edge_runtime_3d-quote --tail 50` — the likely cause is the service key (see `clients.ts`).

- [ ] **Step 8: Format, check and run everything**

Run: `deno fmt --config supabase/functions/deno.json supabase/functions`
Run: `npm run functions:check` and `npm run functions:test`
Expected: no errors; all unit and integration tests pass.

- [ ] **Step 9: Commit**

```bash
git add supabase/config.toml supabase/functions
git commit -m "feat(functions): add price-quote, which prices a draft's sliced items with guarded writes"
```

---

### Task 4: `duplicate-quote`

**Files:**
- Create: `supabase/functions/duplicate-quote/duplicate.ts`, `supabase/functions/duplicate-quote/index.ts`
- Create: `supabase/functions/tests/duplicate-quote.integration.test.ts`

**Interfaces:**
- Consumes: `service_create_quote_copy`, `service_copy_quote_items` (Task 2); `serviceClient`, `requireStaff`,
  `createHandler`, `json`, `readQuoteId`, `HttpError`, `priceQuote` (Task 3); the test helpers (Task 3).
- Produces: `duplicateQuote(admin: SupabaseClient, sourceId: number, callerId: string): Promise<number>` (the new
  quote id); `POST /functions/v1/duplicate-quote { quote_id }` → `201 { quote_id }`.

- [ ] **Step 1: Write the failing integration tests**

Create `supabase/functions/tests/duplicate-quote.integration.test.ts`:

```ts
import { assert, assertEquals, assertMatch, assertNotEquals } from './deps.ts'
import {
  adminClient,
  callFunction,
  createCatalog,
  createItem,
  createQuote,
  markSent,
  must,
  OPERATOR_EMAIL,
  OPERATOR_ID,
  preflight,
  signIn,
} from './helpers.ts'
import type { SupabaseClient } from '../_shared/supabase.ts'

interface QuoteRow {
  id: number
  number: string
  status: string
  client_id: number
  notes: string | null
  markup_override_pct: number | null
  created_by: string
}

interface CopiedItem {
  id: number
  model_path: string
  original_filename: string
  computed_total: number | null
  override_total: number | null
  override_reason: string | null
  print_time_s: number | null
  slicing_jobs: { status: string }[]
}

async function topLevelFolders(admin: SupabaseClient): Promise<string[]> {
  const entries = await must<{ name: string }[]>(
    admin.storage.from('models').list('', { limit: 10000 }),
  )
  return entries.map((entry) => entry.name).sort()
}

Deno.test('duplicates a sent quote into a new priced draft', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const sourceId = await createQuote(admin, clientId, { notes: 'Rush job', markup_override_pct: 12.5 })
  const sliced = await createItem(admin, sourceId, {
    printerId,
    materialId,
    sliced: true,
    override: { total: 50, reason: 'Agreed price' },
  })
  const waiting = await createItem(admin, sourceId, { printerId, materialId })
  const bare = await createItem(admin, sourceId)
  await markSent(admin, sourceId)

  const response = await callFunction('duplicate-quote', { quote_id: sourceId }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.status, 201)
  const newId = response.body.quote_id!
  const [source, copy] = await Promise.all(
    [sourceId, newId].map((id) =>
      must<QuoteRow>(admin.from('quotes').select('*').eq('id', id).single())
    ),
  )
  assertEquals(copy.status, 'draft')
  assertEquals(copy.client_id, clientId)
  assertEquals(copy.notes, 'Rush job')
  assertEquals(Number(copy.markup_override_pct), 12.5)
  assertEquals(copy.created_by, OPERATOR_ID)
  assertNotEquals(copy.number, source.number)

  const items = await must<CopiedItem[]>(
    admin.from('quote_items')
      .select(
        'id, model_path, original_filename, computed_total, override_total, override_reason, print_time_s, slicing_jobs(status)',
      )
      .eq('quote_id', newId)
      .order('id'),
  )
  assertEquals(items.length, 3)
  for (const [item, original] of items.map((item, i) => [item, [sliced, waiting, bare][i]] as const)) {
    assertMatch(item.model_path, new RegExp(`^${newId}/[0-9a-f-]{36}/part\\.stl$`))
    assertNotEquals(item.model_path, original.model_path)
    await must(admin.storage.from('models').download(item.model_path))
  }
  // The sliced item keeps its results, override and a succeeded job, and is priced.
  assertEquals(items[0].print_time_s, 19800)
  assertEquals(Number(items[0].override_total), 50)
  assertEquals(items[0].override_reason, 'Agreed price')
  assertEquals(items[0].slicing_jobs.map((job) => job.status), ['succeeded'])
  assert(items[0].computed_total !== null)
  // The unsliced item is queued again; the bare one waits for printer and material.
  assertEquals(items[1].slicing_jobs.map((job) => job.status), ['queued'])
  assertEquals(items[1].computed_total, null)
  assertEquals(items[2].slicing_jobs, [])
})

Deno.test('cleans up when a file cannot be copied', async () => {
  const admin = await adminClient()
  const { printerId, materialId, clientId } = await createCatalog(admin)
  const sourceId = await createQuote(admin, clientId)
  await createItem(admin, sourceId, { printerId, materialId, sliced: true })
  const lost = await createItem(admin, sourceId, { printerId, materialId, sliced: true })
  await must(admin.storage.from('models').remove([lost.model_path]))
  const foldersBefore = await topLevelFolders(admin)

  const response = await callFunction('duplicate-quote', { quote_id: sourceId }, await signIn(OPERATOR_EMAIL))

  assertEquals(response.status, 500)
  assertEquals(response.body, { code: 'duplicate_failed' })
  const quotes = await must<{ id: number }[]>(admin.from('quotes').select('id').eq('client_id', clientId))
  assertEquals(quotes.map((quote) => quote.id), [sourceId])
  assertEquals(await topLevelFolders(admin), foldersBefore)
})

Deno.test('answers 404 for an unknown quote', async () => {
  const response = await callFunction(
    'duplicate-quote',
    { quote_id: 2147480000 },
    await signIn(OPERATOR_EMAIL),
  )

  assertEquals(response.status, 404)
  assertEquals(response.body, { code: 'quote_not_found' })
})

Deno.test('rejects callers without a session', async () => {
  const response = await callFunction('duplicate-quote', { quote_id: 1 })

  assertEquals(response.status, 401)
  assertEquals(response.body, { code: 'not_authenticated' })
})

Deno.test('answers the CORS preflight', async () => {
  const response = await preflight('duplicate-quote')

  assertEquals(response.status, 200)
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run:
`deno test --config supabase/functions/deno.json --allow-net --allow-env --allow-read --allow-run=supabase supabase/functions/tests/duplicate-quote.integration.test.ts`
Expected: FAIL — every call answers 404 (`Function not found`) or the test fails on the status, because
`duplicate-quote` doesn't exist yet.

- [ ] **Step 3: Implement the duplication**

Create `supabase/functions/duplicate-quote/duplicate.ts`:

```ts
import type { SupabaseClient } from '../_shared/supabase.ts'
import { HttpError } from '../_shared/http.ts'

interface SourceItem {
  id: number
  model_path: string
}

/**
 * Creates a draft copy of the quote: the quote row, then each file copied into the new quote's folder, then the
 * items in one transaction. Storage and SQL can't share a transaction, so a failure undoes the copy by hand.
 */
export async function duplicateQuote(
  admin: SupabaseClient,
  sourceId: number,
  callerId: string,
): Promise<number> {
  const { data: source, error } = await admin.from('quotes').select('id').eq('id', sourceId)
    .maybeSingle()
  if (error) throw error
  if (!source) throw new HttpError(404, 'quote_not_found')

  const { data: items, error: itemsError } = await admin
    .from('quote_items')
    .select('id, model_path')
    .eq('quote_id', sourceId)
    .order('id')
  if (itemsError) throw itemsError

  const { data: newId, error: createError } = await admin.rpc('service_create_quote_copy', {
    source_id: sourceId,
    created_by: callerId,
  })
  if (createError) throw createError

  const copied: string[] = []
  try {
    const files: { item_id: number; model_path: string }[] = []
    for (const item of items as SourceItem[]) {
      // The source key's file name is already a valid storage key; the original file name may not be.
      const fileName = item.model_path.split('/').pop()
      const path = `${newId}/${crypto.randomUUID()}/${fileName}`
      const { error: copyError } = await admin.storage.from('models').copy(item.model_path, path)
      if (copyError) throw copyError
      copied.push(path)
      files.push({ item_id: item.id, model_path: path })
    }
    const { error: copyItemsError } = await admin.rpc('service_copy_quote_items', {
      source_id: sourceId,
      new_id: newId,
      files,
    })
    if (copyItemsError) throw copyItemsError
  } catch (cause) {
    console.error(`Duplicating quote ${sourceId} failed`, cause)
    await undoCopy(admin, newId, copied)
    throw new HttpError(500, 'duplicate_failed')
  }
  return newId
}

async function undoCopy(admin: SupabaseClient, quoteId: number, paths: string[]): Promise<void> {
  if (paths.length > 0) {
    const { error } = await admin.storage.from('models').remove(paths)
    if (error) console.error(`Removing the files copied for quote ${quoteId} failed`, error)
  }
  // Allowed: the copy is a draft. Its items, if any, cascade.
  const { error } = await admin.from('quotes').delete().eq('id', quoteId)
  if (error) console.error(`Deleting the partial copy ${quoteId} failed`, error)
}
```

Create `supabase/functions/duplicate-quote/index.ts`:

```ts
// POST { quote_id } → 201 { quote_id } of the new draft. See docs/supabase/edge-functions.md.
import { requireStaff } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/clients.ts'
import { createHandler, json, readQuoteId } from '../_shared/http.ts'
import { priceQuote } from '../_shared/price-quote.ts'
import { duplicateQuote } from './duplicate.ts'

Deno.serve(createHandler(async (req) => {
  const admin = serviceClient()
  const callerId = await requireStaff(req, admin)
  const sourceId = await readQuoteId(req)
  const newId = await duplicateQuote(admin, sourceId, callerId)
  try {
    await priceQuote(admin, newId)
  } catch (error) {
    // The copy is complete; it gets priced on the next change or Recalculate.
    console.error(`Pricing the copy ${newId} failed`, error)
  }
  return json(201, { quote_id: newId })
}))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
`deno test --config supabase/functions/deno.json --allow-net --allow-env --allow-read --allow-run=supabase supabase/functions/tests/duplicate-quote.integration.test.ts`
Expected: PASS, 5 tests. (A new function folder is picked up by the running Edge Runtime; if it still answers
`Function not found`, run `supabase stop` and `supabase start`.)

- [ ] **Step 5: Format, check and run everything**

Run: `deno fmt --config supabase/functions/deno.json supabase/functions`
Run: `npm run functions:check` and `npm run functions:test`
Expected: no errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions
git commit -m "feat(functions): add duplicate-quote, which copies files and results into a new priced draft"
```

---

### Task 5: Documentation and final verification

**Files:**
- Create: `docs/architecture/adr/0004-pricing-and-duplication-in-edge-functions.md`, `docs/supabase/edge-functions.md`
- Modify: `docs/architecture/overview.md`, `docs/supabase/data-model.md`, `docs/development/getting-started.md`,
  `docs/README.md`, `docs/superpowers/specs/2026-10-12-pricing-duplicate-design.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Write ADR-0004**

Create `docs/architecture/adr/0004-pricing-and-duplication-in-edge-functions.md`:

```markdown
# ADR-0004: Pricing and duplication in Edge Functions

- **Status: Accepted**
- **Date:** 2026-10-12

## Context

[ADR-0003](0003-database-schema-and-security.md) put pricing in an Edge Function but left open when it runs. The
pricing rules are in the [functional analysis §5](../../frontend/functional-analysis.md#5-pricing-rules): full
precision, with only the item total rounded half up to 2 decimals. Print time arrives in seconds, so hours are often
not finite decimals. Duplicating a quote must reuse its model files, but `quote_items.model_path` is unique and must
start with the item's quote id.

## Decision

- **`price-quote`** prices every item of a draft that has a printer, a material and slice results. The **web app
  calls it** after each change it makes, after a slice finishes, and from **Recalculate prices**. Nothing prices a
  quote nobody has open.
- **Exact arithmetic:** a `BigInt` fraction type, no dependency. No float is ever used for money.
- **Guarded writes:** the breakdown is written with the service role only if the item's `updated_at` still matches
  what was read, so a price computed from stale inputs never overwrites a newer change. Changes to settings,
  printers or materials don't touch items; their effect waits for the next call.
- **`duplicate-quote`** creates the draft (`service_create_quote_copy`), copies each file into the new quote's folder
  with Storage `copy`, then inserts the items with their results, price overrides and a `succeeded` job in one
  transaction (`service_copy_quote_items`). Nothing is sliced again. Storage and SQL can't share a transaction, so a
  failure deletes the copied files and the new draft by hand.
- Both functions check the caller's JWT and active staff row themselves (`verify_jwt = false`), so every error,
  401 included, carries CORS headers and a `{ code }`.

## Alternatives considered

- **Pricing as a SQL function** run inside every change: always consistent, but rejected to keep ADR-0003's decision.
- **A database webhook** calling the function on every item change: automatic, but asynchronous and with more moving
  parts (pg_net, secrets, retries).
- **Sharing files between quotes:** no copying, but removing an item or a draft would need to know whether another
  quote still uses the file.
- **Re-slicing duplicated items:** simpler, but the copy can't be sent until the worker slices everything again.

## Consequences

- A quote whose rates changed shows old prices until someone edits it or presses Recalculate.
- The web app must call `price-quote` after every change that clears prices; the web quotes spec owns that.
- Copied files double storage use for duplicated quotes.
- Edge Function code and tests need Deno; see [getting started](../../development/getting-started.md).
```

- [ ] **Step 2: Write the Edge Functions page**

Create `docs/supabase/edge-functions.md`:

```markdown
# Edge Functions

Server-side actions that need the service role. The code is in `supabase/functions/`; the decisions are in
[ADR-0004](../architecture/adr/0004-pricing-and-duplication-in-edge-functions.md).

## Calling them

`POST /functions/v1/<name>` with a JSON body, the signed-in user's JWT in `Authorization: Bearer <token>` and the
publishable key in `apikey` (`supabase.functions.invoke` sends both). Only active staff may call them. Errors are
JSON `{ "code": "<code>" }`:

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Not a `POST`, or the body has no positive integer `quote_id` |
| 401 | `not_authenticated` | No bearer token, or not a valid session |
| 403 | `not_staff` | The user has no active staff row |
| 404 | `quote_not_found` | No quote with that id |
| 409 | `quote_not_draft` | `price-quote` on a quote that isn't (or stopped being) a draft |
| 500 | `duplicate_failed` | `duplicate-quote` couldn't copy a file or the items; nothing was left behind |
| 500 | `internal_error` | Anything else; the function log has the cause |

## `price-quote`

Body `{ "quote_id": 42 }` → `200 { "priced": 2, "skipped": 1 }`.

Prices every item of the draft that has a printer, a material and slice results, with the
[pricing rules](../frontend/functional-analysis.md#5-pricing-rules). The other items are skipped. An item changed
between reading and writing is skipped too, so call it again after your own change has landed. Price overrides are
never touched. Inactive printers and materials are still priced with their rates.

## `duplicate-quote`

Body `{ "quote_id": 42 }` → `201 { "quote_id": 57 }`.

Copies a quote in any status into a new draft by the caller: same client, notes and markup override; default
validity; a new number. Files are copied into the new quote's folder. Items keep their settings, results and price
overrides; sliced items get a `succeeded` job, unsliced ones with printer and material are queued. The copy is then
priced.

## Local development

`supabase start` serves every function at `http://127.0.0.1:54321/functions/v1/<name>`, reloading on save. Logs:
`docker logs supabase_edge_runtime_3d-quote`.

| Command | What it does |
|---|---|
| `npm run functions:check` | `deno check`, `deno lint` and `deno fmt --check` on `supabase/functions` |
| `npm run functions:test` | Unit tests, and integration tests against the running local stack |

Integration tests sign in as the seed users and create their own uniquely named rows; `supabase db reset` clears them.
```

- [ ] **Step 3: Update the other docs**

In `docs/architecture/overview.md`:
- in the components table, replace the Edge Functions row's last cell with:
  `Server-side actions that need the service role: pricing a draft (\`price-quote\`) and duplicating a quote (\`duplicate-quote\`). See [Edge Functions](../supabase/edge-functions.md).`
- in the sequence diagram, replace the last line
  `Web->>DB: compute price for the item (Edge Function or SQL function — open question)` with:

```
    Web->>Fn: price-quote(quote_id)
    Fn->>DB: write each item's price breakdown (service role)
```

- under **Open questions**, delete the **When pricing runs** bullet.

In `docs/supabase/data-model.md`:
- after the web app functions table (before `## Errors`), add:

```markdown
**Service functions** (`service_role`, used by the [`duplicate-quote` Edge Function](edge-functions.md)):

| Function | Does |
|---|---|
| `service_create_quote_copy(source_id bigint, created_by uuid) → bigint` | Inserts a draft with the source's client, notes and markup override; the trigger assigns the number and default validity. Raises `quote_not_found`. |
| `service_copy_quote_items(source_id bigint, new_id bigint, files jsonb) → void` | `files` is `[{item_id, model_path}]`, one per source item, each path under `<new_id>/` and already in `models`. Copies settings, results and price overrides (not the breakdown); a sliced item gets a `succeeded` job, an unsliced one with printer and material is queued. Raises `quote_not_draft`, `invalid_copy`, `invalid_model_path`, `model_not_found`. |

Item prices are written by the [`price-quote` Edge Function](edge-functions.md) with the service role.
```

- in the `## Errors` table, change the `22023` row's messages to end with `…, job_message_mismatch, invalid_copy`.

In `docs/development/getting-started.md`:
- add a row to the **Prerequisites** table after the Supabase CLI row:
  `| [Deno](https://deno.com) | ≥ 2 (on Windows: \`scoop install deno\`) | Edge Function checks and tests (\`supabase/functions\`) |`
- add a row to **Common commands** after the `supabase start` row:
  `| \`npm run functions:check\` / \`npm run functions:test\` | Type-check, lint and format-check the Edge Functions / run their tests (integration tests need \`supabase start\`) |`

In `docs/README.md`:
- add a row after the **Data model** row:
  `| [Edge Functions](supabase/edge-functions.md) | price-quote and duplicate-quote: requests, errors, local testing |`
- in the **Architecture decisions** row, append `, [0004 pricing and duplication](architecture/adr/0004-pricing-and-duplication-in-edge-functions.md)`
  after the 0003 link.

In `docs/superpowers/specs/2026-10-12-pricing-duplicate-design.md`, change `- **Status:** Draft — awaiting review` to
`- **Status:** Implemented`.

- [ ] **Step 4: Full verification**

Run, from the repo root:

```bash
npm run build && npm run lint && npm run format:check && npm test
supabase test db
supabase db diff
npm run check:types-fresh
npm run functions:check
npm run functions:test
```

Expected:
- build, lint, format and web tests pass;
- `supabase test db` passes all 12 files;
- `supabase db diff` prints `No schema changes found`;
- `check:types-fresh` prints that the types are up to date;
- `functions:check` reports nothing; `functions:test` passes (9 unit + 16 integration tests).

- [ ] **Step 5: Manual smoke check with curl**

With the stack running, get a token and call both functions on a seeded quote you create:

```bash
supabase status -o env   # note API_URL and PUBLISHABLE_KEY
```

Sign in as `owner@3dquote.local` / `password123` through `POST <API_URL>/auth/v1/token?grant_type=password` (header
`apikey`), then `POST <API_URL>/functions/v1/price-quote` with `{"quote_id": <a draft id>}`. Check the response and
the item's `computed_total` in Studio (`http://127.0.0.1:54323`). Note anything that differs from the spec in the
final report rather than fixing it silently.

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: record pricing and duplication in Edge Functions; document both endpoints"
```

## Not done yet

- Calling `price-quote` and `duplicate-quote` from the web app, and mapping their codes in `toAppError` (web quotes
  spec).
- Deploying the functions to the cloud project, with their `verify_jwt = false` settings.
- Removing orphaned files in `models`.
