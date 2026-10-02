/**
 * Exact rational numbers for musical time. Every duration and position in the
 * score is a fraction of a whole note, so tuplets of any ratio stay exact.
 * Values are immutable and always reduced, with a positive denominator.
 */
export interface Fraction {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function frac(n: number, d = 1): Fraction {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0)
    throw new RangeError(`Invalid fraction ${n}/${d}`);
  const sign = d < 0 ? -1 : 1;
  const divisor = gcd(n, d);
  return Object.freeze({ n: (sign * n) / divisor, d: (sign * d) / divisor });
}

export const ZERO = frac(0);
export const ONE = frac(1);

export const add = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.n, a.d * b.d);
export const div = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d, a.d * b.n);
export const scale = (a: Fraction, factor: number): Fraction => frac(a.n * factor, a.d);

export const compare = (a: Fraction, b: Fraction): number => a.n * b.d - b.n * a.d;
export const eq = (a: Fraction, b: Fraction): boolean => a.n === b.n && a.d === b.d;
export const lt = (a: Fraction, b: Fraction): boolean => compare(a, b) < 0;
export const le = (a: Fraction, b: Fraction): boolean => compare(a, b) <= 0;
export const gt = (a: Fraction, b: Fraction): boolean => compare(a, b) > 0;
export const ge = (a: Fraction, b: Fraction): boolean => compare(a, b) >= 0;
export const min = (a: Fraction, b: Fraction): Fraction => (le(a, b) ? a : b);
export const max = (a: Fraction, b: Fraction): Fraction => (ge(a, b) ? a : b);
export const isZero = (a: Fraction): boolean => a.n === 0;
export const toNumber = (a: Fraction): number => a.n / a.d;

export function sum(values: readonly Fraction[]): Fraction {
  return values.reduce(add, ZERO);
}

/** Whether `a` is a whole multiple of `unit`. */
export function isMultipleOf(a: Fraction, unit: Fraction): boolean {
  return div(a, unit).d === 1;
}

/** The largest multiple of `unit` that is not greater than `a`. */
export function floorTo(a: Fraction, unit: Fraction): Fraction {
  const ratio = div(a, unit);
  return mul(frac(Math.floor(ratio.n / ratio.d)), unit);
}

export function format(a: Fraction): string {
  return a.d === 1 ? String(a.n) : `${a.n}/${a.d}`;
}

/** Parses "3/8", "1" or "-1/4". */
export function parse(text: string): Fraction {
  const match = /^\s*(-?\d+)(?:\s*\/\s*(\d+))?\s*$/.exec(text);
  if (!match) throw new SyntaxError(`Not a fraction: "${text}"`);
  return frac(Number(match[1]), match[2] ? Number(match[2]) : 1);
}

/** Sort comparator. */
export const byValue = (a: Fraction, b: Fraction): number => compare(a, b);

/** A string key for maps and sets: equal fractions give equal keys. */
export const key = format;
