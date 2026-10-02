import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import type { DurationBase, NoteValue, TimeSignature } from './types';

/** Note values from longest to shortest, with their length in whole notes. */
export const BASES: readonly { base: DurationBase; length: Fraction; flags: number }[] = [
  { base: 'breve', length: F.frac(2), flags: 0 },
  { base: 'whole', length: F.frac(1), flags: 0 },
  { base: 'half', length: F.frac(1, 2), flags: 0 },
  { base: 'quarter', length: F.frac(1, 4), flags: 0 },
  { base: 'eighth', length: F.frac(1, 8), flags: 1 },
  { base: '16th', length: F.frac(1, 16), flags: 2 },
  { base: '32nd', length: F.frac(1, 32), flags: 3 },
  { base: '64th', length: F.frac(1, 64), flags: 4 },
  { base: '128th', length: F.frac(1, 128), flags: 5 }
];

const byBase = new Map(BASES.map(item => [item.base, item]));

export function baseLength(base: DurationBase): Fraction {
  return byBase.get(base)!.length;
}

/** Flags or beams a value carries: 1 for an eighth, 2 for a 16th. */
export function flagCount(base: DurationBase): number {
  return byBase.get(base)!.flags;
}

/** Written length of a value with its dots, before any tuplet. */
export function durationOf(value: NoteValue): Fraction {
  // Each dot adds half of the previous addition: 1 + 1/2 + 1/4 …
  const factor = F.sub(F.frac(2), F.frac(1, 2 ** value.dots));
  return F.mul(baseLength(value.base), factor);
}

/** The single (possibly dotted) value with exactly this length, if there is one. */
export function valueFor(length: Fraction, maxDots = 2): NoteValue | undefined {
  for (const { base } of BASES)
    for (let dots = 0; dots <= maxDots; dots++)
      if (F.eq(durationOf({ base, dots }), length)) return { base, dots };
  return undefined;
}

/** Length of a full measure in whole notes. */
export function meterLength(time: TimeSignature): Fraction {
  return F.frac(time.beats, time.beatType);
}

export function sameValue(a: NoteValue, b: NoteValue): boolean {
  return a.base === b.base && a.dots === b.dots;
}
