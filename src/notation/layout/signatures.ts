/**
 * Clefs, key signatures and time signatures: their widths for spacing and
 * their drawing, at a line start, within a line and as courtesy signatures.
 * Docs §5.2–5.4.
 */
import type { KeySignature } from '../core/pitch';
import { glyph } from '../fonts/glyphs';
import type { ClefKind, TimeSignature } from '../model/types';
import { cancelledSteps, clefInfo, keySignatureSteps, stepY } from '../rules/staffPosition';
import type { DisplayBuilder } from './builder';
import type { Semantic } from './display';

const KEY_GAP = 0.08;
const CANCEL_GAP = 0.5;

export function clefAdvance(clef: ClefKind, scale = 1): number {
  return glyph(clefInfo(clef).glyph).advance * scale;
}

export function drawClef(builder: DisplayBuilder, clef: ClefKind, x: number, staffTop: number, scale: number,
  element: string, semantic: Semantic): number {
  const info = clefInfo(clef);
  builder.glyph(info.glyph, x, staffTop + stepY(info.originStep), { element, semantic }, { scale });
  return glyph(info.glyph).advance * scale;
}

export function keyWidth(key: KeySignature, previous: KeySignature | undefined, policy: 'traditional' | 'modern'): number {
  const accidental = key.fifths >= 0 ? 'accidentalSharp' : 'accidentalFlat';
  const cancelled = previous ? cancelledSteps(previous, key, 'treble', policy).length : 0;
  const count = Math.abs(key.fifths);
  return (cancelled ? cancelled * (glyph('accidentalNatural').advance + KEY_GAP) + (count ? CANCEL_GAP : 0) : 0) +
    count * (glyph(accidental).advance + KEY_GAP);
}

export function drawKey(builder: DisplayBuilder, key: KeySignature, previous: KeySignature | undefined, clef: ClefKind,
  x: number, staffTop: number, policy: 'traditional' | 'modern', element: string, semantic: Semantic): number {
  let at = x;
  if (previous) {
    const naturals = cancelledSteps(previous, key, clef, policy);
    for (const step of naturals) {
      builder.glyph('accidentalNatural', at, staffTop + stepY(step), { element: 'key.change', semantic });
      at += glyph('accidentalNatural').advance + KEY_GAP;
    }
    if (naturals.length && key.fifths) at += CANCEL_GAP;
  }
  const name = key.fifths >= 0 ? 'accidentalSharp' : 'accidentalFlat';
  for (const step of keySignatureSteps(key, clef)) {
    builder.glyph(name, at, staffTop + stepY(step), { element, semantic });
    at += glyph(name).advance + KEY_GAP;
  }
  return at - x;
}

function digits(value: number): string[] {
  return String(value).split('').map(digit => `timeSig${digit}`);
}

const digitsWidth = (names: string[]) => names.reduce((sum, name) => sum + glyph(name).advance, 0);

export function timeWidth(time: TimeSignature): number {
  if (time.symbol === 'common') return glyph('timeSigCommon').advance;
  if (time.symbol === 'cut') return glyph('timeSigCutCommon').advance;
  return Math.max(digitsWidth(digits(time.beats)), digitsWidth(digits(time.beatType)));
}

export function drawTime(builder: DisplayBuilder, time: TimeSignature, x: number, staffTop: number,
  element: string, semantic: Semantic): number {
  if (time.symbol === 'common' || time.symbol === 'cut') {
    const name = time.symbol === 'common' ? 'timeSigCommon' : 'timeSigCutCommon';
    builder.glyph(name, x, staffTop + stepY(4), { element: time.symbol === 'common' ? 'time.common' : 'time.cut', semantic });
    return glyph(name).advance;
  }
  const width = timeWidth(time);
  for (const [value, step] of [[time.beats, 6], [time.beatType, 2]] as const) {
    const names = digits(value);
    let at = x + (width - digitsWidth(names)) / 2;
    for (const name of names) {
      builder.glyph(name, at, staffTop + stepY(step), { element, semantic });
      at += glyph(name).advance;
    }
  }
  return width;
}

export function sameKey(a: KeySignature, b: KeySignature): boolean {
  return a.fifths === b.fifths && a.mode === b.mode;
}

export function sameTime(a: TimeSignature, b: TimeSignature): boolean {
  return a.beats === b.beats && a.beatType === b.beatType && (a.symbol ?? 'numeric') === (b.symbol ?? 'numeric');
}
