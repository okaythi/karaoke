/**
 * Where pitches, clefs and key signatures sit on a five-line staff.
 *
 * A staff position is a "step": 0 is the bottom line, 1 the first space, 8
 * the top line; each step is half a staff space. Steps outside 0–8 need
 * ledger lines. Docs §5.2, §5.3.
 */
import { diatonic, parsePitch } from '../core/pitch';
import type { KeySignature, Pitch } from '../core/pitch';
import type { ClefKind } from '../model/types';

export const MIDDLE_LINE = 4;
export const TOP_LINE = 8;

interface ClefInfo {
  /** Written pitch on the bottom line. */
  readonly bottomLine: string;
  readonly glyph: string;
  /** Step of the glyph's origin (the line the clef names). */
  readonly originStep: number;
  /** Key signature steps, in the order the accidentals are written. */
  readonly sharps: readonly number[];
  readonly flats: readonly number[];
}

const TREBLE_SHARPS = [8, 5, 9, 6, 3, 7, 4];
const TREBLE_FLATS = [4, 7, 3, 6, 2, 5, 1];
const shift = (steps: readonly number[], by: number) => steps.map(step => step + by);

const CLEFS: Record<ClefKind, ClefInfo> = {
  'treble': { bottomLine: 'E4', glyph: 'gClef', originStep: 2, sharps: TREBLE_SHARPS, flats: TREBLE_FLATS },
  'treble-8vb': { bottomLine: 'E3', glyph: 'gClef8vb', originStep: 2, sharps: TREBLE_SHARPS, flats: TREBLE_FLATS },
  'treble-8va': { bottomLine: 'E5', glyph: 'gClef8va', originStep: 2, sharps: TREBLE_SHARPS, flats: TREBLE_FLATS },
  'bass': { bottomLine: 'G2', glyph: 'fClef', originStep: 6, sharps: shift(TREBLE_SHARPS, -2), flats: shift(TREBLE_FLATS, -2) },
  'bass-8vb': { bottomLine: 'G1', glyph: 'fClef8vb', originStep: 6, sharps: shift(TREBLE_SHARPS, -2), flats: shift(TREBLE_FLATS, -2) },
  // The F clef a line lower: its signature zigzags inside the staff from the middle-line F.
  'baritone-f': { bottomLine: 'B2', glyph: 'fClef', originStep: 4, sharps: [4, 1, 5, 2, 6, 3, 7], flats: [7, 3, 6, 2, 5, 1, 4] },
  'alto': { bottomLine: 'F3', glyph: 'cClef', originStep: 4, sharps: shift(TREBLE_SHARPS, -1), flats: shift(TREBLE_FLATS, -1) },
  // Tenor clef sharps would sit above the staff in the treble pattern, so they start low.
  'tenor': { bottomLine: 'D3', glyph: 'cClef', originStep: 6, sharps: [2, 6, 3, 7, 4, 8, 5], flats: shift(TREBLE_FLATS, 1) }
};

const bottomDiatonic = new Map(Object.entries(CLEFS).map(([kind, info]) => [kind, diatonic(parsePitch(info.bottomLine))]));

export function clefInfo(clef: ClefKind): ClefInfo {
  return CLEFS[clef];
}

/**
 * Staff step of a written pitch. `octaveShift` is the octaves an ottava
 * moves the written note from the sounding one (−1 under 8va).
 */
export function stepOf(pitch: Pitch, clef: ClefKind, octaveShift = 0): number {
  return diatonic(pitch) + 7 * octaveShift - bottomDiatonic.get(clef)!;
}

/** Offset in staff spaces from the top line, downward. */
export function stepY(step: number): number {
  return (TOP_LINE - step) / 2;
}

export function isOnLine(step: number): boolean {
  return ((step % 2) + 2) % 2 === 0;
}

/** Steps of the ledger lines a note at `step` needs. */
export function ledgerSteps(step: number): number[] {
  const steps: number[] = [];
  for (let line = TOP_LINE + 2; line <= step; line += 2) steps.push(line);
  for (let line = -2; line >= step; line -= 2) steps.push(line);
  return steps;
}

/** Steps of the accidentals of a key signature in a clef. */
export function keySignatureSteps(key: KeySignature, clef: ClefKind): number[] {
  const info = CLEFS[clef];
  return key.fifths >= 0 ? info.sharps.slice(0, key.fifths) : info.flats.slice(0, -key.fifths);
}

/**
 * Naturals that cancel the old key before a new one: the old accidentals
 * that the new key does not keep. `traditional` cancels whenever the new key
 * has fewer of the same kind; `modern` only when going to C or switching
 * between sharps and flats.
 */
export function cancelledSteps(from: KeySignature, to: KeySignature, clef: ClefKind, policy: 'traditional' | 'modern'): number[] {
  const switching = Math.sign(from.fifths) !== Math.sign(to.fifths) && from.fifths !== 0;
  const fewer = Math.sign(from.fifths) === Math.sign(to.fifths) && Math.abs(to.fifths) < Math.abs(from.fifths);
  if (!switching && !(fewer && (policy === 'traditional' || to.fifths === 0))) return [];
  const old = keySignatureSteps(from, clef);
  return switching ? old : old.slice(Math.abs(to.fifths));
}
