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
