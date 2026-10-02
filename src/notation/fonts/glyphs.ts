/**
 * Measured glyphs and text. All sizes are in staff spaces, with y growing
 * downward as in SVG. The data comes from scripts/notation/build-fonts.py,
 * so layout needs no DOM and gives the same result in tests and browsers.
 */
import metrics from './metrics.json';

export const MUSIC_FONT = metrics.music.family;
/** A music font's em is four staff spaces (SMuFL). */
export const MUSIC_EM = 4;

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface Glyph {
  readonly name: string;
  readonly char: string;
  /** Ink box relative to the glyph origin, y down. */
  readonly box: Box;
  readonly advance: number;
}

type RawGlyph = { codepoint: string; box: number[]; advance: number };
const music = metrics.music.glyphs as Record<string, RawGlyph>;
const cache = new Map<string, Glyph>();

export function hasGlyph(name: string): boolean {
  return name in music;
}

export function glyph(name: string): Glyph {
  let found = cache.get(name);
  if (found) return found;
  const raw = music[name];
  if (!raw) throw new Error(`Glyph ${name} is not measured; run scripts/notation/build-fonts.py`);
  const [x0, y0, x1, y1] = raw.box;
  found = {
    name, char: String.fromCodePoint(parseInt(raw.codepoint, 16)), advance: raw.advance,
    box: { x0, y0: -y1, x1, y1: -y0 }
  };
  cache.set(name, found);
  return found;
}

export function glyphWidth(name: string): number {
  const { box } = glyph(name);
  return box.x1 - box.x0;
}

export type TextFace = 'Academico' | 'AcademicoBold';

type RawText = { ascent: number; descent: number; capHeight: number; xHeight: number; fallbackAdvance: number; advances: Record<string, number> };
const faces = metrics.text as Record<TextFace, RawText>;

export interface TextMetrics {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}

/** Width and vertical extent of a run of text at `size` staff spaces per em. */
export function measureText(text: string, face: TextFace, size: number): TextMetrics {
  const font = faces[face];
  let width = 0;
  for (const char of text) width += font.advances[char] ?? font.fallbackAdvance;
  return { width: width * size, ascent: font.capHeight * size, descent: (/[gjpqy,]/.test(text) ? font.descent : 0.02) * size };
}

export function fontFamily(face: TextFace): string {
  return face === 'AcademicoBold' ? 'AcademicoBold' : 'Academico';
}
