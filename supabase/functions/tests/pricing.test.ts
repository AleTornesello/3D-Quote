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
    failurePct: 0,
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
