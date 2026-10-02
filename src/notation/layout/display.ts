/**
 * The display list: positioned primitives in staff spaces (y down), each
 * labelled with the catalogue entry it draws and the score elements it
 * represents. Render draws it; style and playback select on its labels.
 */
import type { Box, TextFace } from '../fonts/glyphs';
import type { StaffId } from '../model/types';

export type Primitive =
  | {
      readonly kind: 'glyph'; readonly glyph: string; readonly x: number; readonly y: number;
      /** Uniform size factor (1 = a full-size staff). */
      readonly scale: number;
      /** Extra stretch for glyphs drawn to a length (brace). */
      readonly scaleX?: number; readonly scaleY?: number;
      /** Degrees, clockwise. */
      readonly rotate?: number;
    }
  | {
      readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number;
      readonly thickness: number; readonly dash?: readonly [number, number]; readonly cap?: 'butt' | 'round';
    }
  | { readonly kind: 'polygon'; readonly points: readonly number[] }
  | { readonly kind: 'path'; readonly d: string; readonly fill: boolean; readonly thickness?: number }
  | {
      readonly kind: 'text'; readonly text: string; readonly x: number; readonly y: number; readonly face: TextFace;
      readonly size: number; readonly italic: boolean; readonly anchor: 'start' | 'middle' | 'end';
    }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly thickness: number };

/** What a drawn item is about, for styling and playback. */
export interface Semantic {
  readonly staff?: StaffId;
  readonly voice?: number;
  readonly measure?: number;
  readonly roles?: readonly string[];
  readonly tags?: readonly string[];
}

export interface DisplayItem {
  readonly primitive: Primitive;
  /** Catalogue entry ID. */
  readonly element: string;
  /** Score IDs drawn by this item (a note, an event, a spanner …). */
  readonly refs: readonly string[];
  readonly semantic: Semantic;
  readonly box: Box;
}

export const union = (a: Box, b: Box): Box =>
  ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

export const translate = (box: Box, dx: number, dy: number): Box =>
  ({ x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy });

const EPSILON = 1e-6;

/** Whether two boxes come closer than `padding`; touching within rounding error does not count. */
export const overlaps = (a: Box, b: Box, padding = 0): boolean =>
  a.x0 < b.x1 + padding - EPSILON && b.x0 < a.x1 + padding - EPSILON &&
  a.y0 < b.y1 + padding - EPSILON && b.y0 < a.y1 + padding - EPSILON;
