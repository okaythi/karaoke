/**
 * Collects display items and works out their ink boxes as they are added,
 * so later placement can avoid everything drawn before it.
 */
import { glyph, measureText } from '../fonts/glyphs';
import type { Box, TextFace } from '../fonts/glyphs';
import type { DisplayItem, Primitive, Semantic } from './display';

export interface ItemLabel {
  readonly element: string;
  readonly refs?: readonly string[];
  readonly semantic?: Semantic;
}

export class DisplayBuilder {
  readonly items: DisplayItem[] = [];

  add(primitive: Primitive, box: Box, label: ItemLabel): DisplayItem {
    const item: DisplayItem = { primitive, box, element: label.element, refs: label.refs ?? [], semantic: label.semantic ?? {} };
    this.items.push(item);
    return item;
  }

  glyph(name: string, x: number, y: number, label: ItemLabel,
    options: { scale?: number; scaleX?: number; scaleY?: number; rotate?: number } = {}): DisplayItem {
    const scale = options.scale ?? 1;
    return this.add({ kind: 'glyph', glyph: name, x, y, scale, ...pick(options) }, glyphBox(name, x, y, options), label);
  }

  line(x1: number, y1: number, x2: number, y2: number, thickness: number, label: ItemLabel,
    options: { dash?: readonly [number, number]; cap?: 'butt' | 'round' } = {}): DisplayItem {
    const half = thickness / 2;
    const box = { x0: Math.min(x1, x2) - (y1 === y2 ? 0 : half), x1: Math.max(x1, x2) + (y1 === y2 ? 0 : half),
      y0: Math.min(y1, y2) - (x1 === x2 ? 0 : half), y1: Math.max(y1, y2) + (x1 === x2 ? 0 : half) };
    if (x1 === x2) { box.x0 = x1 - half; box.x1 = x1 + half; }
    if (y1 === y2) { box.y0 = y1 - half; box.y1 = y1 + half; }
    return this.add({ kind: 'line', x1, y1, x2, y2, thickness, ...options }, box, label);
  }

  polygon(points: readonly number[], label: ItemLabel): DisplayItem {
    const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1);
    return this.add({ kind: 'polygon', points }, { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, label);
  }

  path(d: string, box: Box, label: ItemLabel, options: { fill?: boolean; thickness?: number } = {}): DisplayItem {
    return this.add({ kind: 'path', d, fill: options.fill ?? true, thickness: options.thickness }, box, label);
  }

  text(text: string, x: number, y: number, face: TextFace, size: number, label: ItemLabel,
    options: { italic?: boolean; anchor?: 'start' | 'middle' | 'end' } = {}): DisplayItem {
    const metrics = measureText(text, face, size);
    const anchor = options.anchor ?? 'start';
    const x0 = anchor === 'start' ? x : anchor === 'middle' ? x - metrics.width / 2 : x - metrics.width;
    return this.add({ kind: 'text', text, x, y, face, size, italic: options.italic ?? false, anchor },
      { x0, x1: x0 + metrics.width, y0: y - metrics.ascent, y1: y + metrics.descent }, label);
  }

  rect(x: number, y: number, width: number, height: number, thickness: number, label: ItemLabel): DisplayItem {
    const half = thickness / 2;
    return this.add({ kind: 'rect', x, y, width, height, thickness },
      { x0: x - half, y0: y - half, x1: x + width + half, y1: y + height + half }, label);
  }

  /** Moves items vertically after they were placed and returns them in their new positions. */
  shift(items: readonly DisplayItem[], dy: number): DisplayItem[] {
    if (!dy) return [...items];
    return items.map(item => {
      const moved = shifted(item, 0, dy);
      const index = this.items.indexOf(item);
      if (index >= 0) this.items[index] = moved;
      return moved;
    });
  }
}

function pick(options: { scaleX?: number; scaleY?: number; rotate?: number }) {
  const result: { scaleX?: number; scaleY?: number; rotate?: number } = {};
  if (options.scaleX !== undefined) result.scaleX = options.scaleX;
  if (options.scaleY !== undefined) result.scaleY = options.scaleY;
  if (options.rotate) result.rotate = options.rotate;
  return result;
}

/** Ink box of a glyph drawn at (x, y). Rotation is about the origin, in quarter turns. */
export function glyphBox(name: string, x: number, y: number,
  options: { scale?: number; scaleX?: number; scaleY?: number; rotate?: number } = {}): Box {
  const scale = options.scale ?? 1;
  const sx = scale * (options.scaleX ?? 1), sy = scale * (options.scaleY ?? 1);
  const box = glyph(name).box;
  let corners = [[box.x0 * sx, box.y0 * sy], [box.x1 * sx, box.y0 * sy], [box.x0 * sx, box.y1 * sy], [box.x1 * sx, box.y1 * sy]];
  if (options.rotate) {
    const angle = (options.rotate * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    corners = corners.map(([cx, cy]) => [cx * cos - cy * sin, cx * sin + cy * cos]);
  }
  const xs = corners.map(corner => corner[0]), ys = corners.map(corner => corner[1]);
  return { x0: x + Math.min(...xs), x1: x + Math.max(...xs), y0: y + Math.min(...ys), y1: y + Math.max(...ys) };
}

export function shifted(item: DisplayItem, dx: number, dy: number): DisplayItem {
  const p = item.primitive;
  let primitive: Primitive;
  switch (p.kind) {
    case 'glyph': case 'text': case 'rect': primitive = { ...p, x: p.x + dx, y: p.y + dy }; break;
    case 'line': primitive = { ...p, x1: p.x1 + dx, x2: p.x2 + dx, y1: p.y1 + dy, y2: p.y2 + dy }; break;
    case 'polygon': primitive = { ...p, points: p.points.map((value, i) => value + (i % 2 ? dy : dx)) }; break;
    case 'path': primitive = { ...p, d: translatePath(p.d, dx, dy) }; break;
  }
  const box = item.box;
  return { ...item, primitive, box: { x0: box.x0 + dx, x1: box.x1 + dx, y0: box.y0 + dy, y1: box.y1 + dy } };
}

/** Translates an absolute path made of M, L, C, Q and Z commands. */
export function translatePath(d: string, dx: number, dy: number): string {
  let coordinate = 0;
  return d.replace(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi, token => {
    if (/[A-Z]/i.test(token)) { coordinate = 0; return token; }
    const value = Number(token) + (coordinate++ % 2 === 0 ? dx : dy);
    return String(Math.round(value * 1000) / 1000);
  });
}
