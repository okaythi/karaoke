/**
 * Ties and slurs, docs §5.10. Both are filled crescents: thin at the ends,
 * thicker in the middle. A curve's bulge is three quarters of its control
 * height; slurs grow their bulge until they clear everything beneath them,
 * then move their ends outward if even the highest allowed bulge is not
 * enough.
 */
import type { Box } from '../fonts/glyphs';
import type { ChordEvent, Spanner } from '../model/types';
import { MIDDLE_LINE } from '../rules/staffPosition';
import type { ItemLabel } from './builder';
import type { DrawnEvent, SystemContext } from './context';
import { inSystem } from './context';
import { semanticOf } from './notes';
import { ENGRAVING } from './settings';
import type { ChordShape } from './shapes';

export interface Point { readonly x: number; readonly y: number }

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Vertical offset of the curve from its chord at parameter t, for control height h. */
const bulgeAt = (t: number, height: number) => 3 * t * (1 - t) * height;

/** Draws a crescent from p0 to p1 with control height `height` (negative bulges upward). */
export function drawCurve(context: SystemContext, p0: Point, p1: Point, height: number, label: ItemLabel,
  thickness: { middle: number; end: number }): Box {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const side = Math.sign(height) || -1;
  const control = (t: number, h: number) => ({ x: p0.x + dx * t, y: p0.y + dy * t + h });
  // The bulge is three quarters of the control height, so the thickness needs a third more.
  const outer = height + side * thickness.middle / 0.75;
  const c1 = control(0.25, height), c2 = control(0.75, height);
  const o1 = control(0.25, outer), o2 = control(0.75, outer);
  const endOffset = side * thickness.end / 2;
  const d = `M${round(p0.x)} ${round(p0.y)} C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p1.x)} ${round(p1.y)}` +
    ` L${round(p1.x)} ${round(p1.y + endOffset)} C${round(o2.x)} ${round(o2.y + endOffset)} ${round(o1.x)} ${round(o1.y + endOffset)} ${round(p0.x)} ${round(p0.y + endOffset)} Z`;
  // Sloped curves reach their extreme away from t=0.5. Include both edges
  // and their endpoints so framing and collision checks see the actual ink.
  const ys = [...cubicExtrema(p0.y, c1.y, c2.y, p1.y),
    ...cubicExtrema(p0.y + endOffset, o1.y + endOffset, o2.y + endOffset, p1.y + endOffset)];
  const box = { x0: p0.x, x1: p1.x, y0: Math.min(...ys), y1: Math.max(...ys) };
  context.builder.path(d, box, label);
  return box;
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) roots.push((-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a));
  }
  return [p0, p3, ...roots.filter(t => t > 0 && t < 1).map(t =>
    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3)];
}

/**
 * Control height so a curve from p0 to p1 passes `padding` clear of every
 * obstacle on its side, starting from `minimum`. Returns the height and how
 * far the ends must move outward when the height alone cannot do it.
 */
export function clearingHeight(p0: Point, p1: Point, obstacles: readonly Box[], side: 'above' | 'below',
  minimum: number, maximum: number, padding: number): { height: number; lift: number } {
  const sign = side === 'above' ? -1 : 1;
  let needed = minimum;
  let lift = 0;
  const dx = p1.x - p0.x || 1;
  for (const box of obstacles) {
    for (const x of [box.x0, (box.x0 + box.x1) / 2, box.x1]) {
      const t = (x - p0.x) / dx;
      if (t <= 0.02 || t >= 0.98) continue;
      const chordY = p0.y + (p1.y - p0.y) * t;
      const edge = side === 'above' ? box.y0 - padding : box.y1 + padding;
      const required = (edge - chordY) / (3 * t * (1 - t));
      // Above, the curve must be at or above the edge: a more negative height.
      if (sign * required > needed) needed = sign * required;
      // Once curvature reaches its limit, move the ends by the actual
      // remaining vertical clearance. Multiplying the excess control height
      // by 0.75 exaggerates obstacles near an endpoint (where bulge is tiny).
      lift = Math.max(lift, sign * (edge - chordY) - bulgeAt(t, maximum));
    }
  }
  if (needed <= maximum) return { height: sign * needed, lift: 0 };
  return { height: sign * maximum, lift };
}

type TieSide = 'above' | 'below';

function tieSides(context: SystemContext, event: ChordEvent, shape: ChordShape): Map<string, TieSide> {
  const sides = new Map<string, TieSide>();
  const index = context.prepared.index;
  if (index.drawnVoices(event.measure, event.staff).length > 1) {
    for (const head of shape.heads) sides.set(head.noteId, event.voice % 2 === 1 ? 'above' : 'below');
    return sides;
  }
  const heads = [...shape.heads].sort((a, b) => a.step - b.step);
  if (heads.length === 1) {
    const head = heads[0];
    const side = shape.stem ? (shape.stem === 'up' ? 'below' : 'above') : head.step >= MIDDLE_LINE ? 'above' : 'below';
    sides.set(head.noteId, side);
    return sides;
  }
  heads.forEach((head, position) => {
    const middle = (heads.length - 1) / 2;
    const side: TieSide = position < middle ? 'below' : position > middle ? 'above' : head.step >= MIDDLE_LINE ? 'above' : 'below';
    sides.set(head.noteId, side);
  });
  return sides;
}

function tieEndpoints(box: Box, side: TieSide, isStart: boolean, after?: number): Point {
  const centre = (box.y0 + box.y1) / 2;
  const y = centre + (side === 'above' ? -0.45 : 0.45);
  return { x: isStart ? Math.max(box.x1, after ?? -Infinity) + 0.15 : box.x0 - 0.15, y };
}

export function drawTies(context: SystemContext): void {
  const { prepared } = context;
  const { index } = prepared;
  for (const spanner of index.spanners('tie')) {
    if (!('note' in spanner.start) || !('note' in spanner.end)) continue;
    const from = index.note(spanner.start.note), to = index.note(spanner.end.note);
    const startHere = inSystem(context, from.event.measure), endHere = inSystem(context, to.event.measure);
    if (!startHere && !endHere) continue;
    const shape = prepared.shapes.get(from.event.id) as ChordShape;
    const side = tieSides(context, from.event, shape).get(from.note.id) ?? 'above';
    const label = { element: 'tie', refs: [spanner.id, from.note.id, to.note.id], semantic: semanticOf(from.event) };
    const thickness = { middle: ENGRAVING.tieMidpointThickness * shape.scale, end: ENGRAVING.tieEndpointThickness * shape.scale };
    const startDrawn = context.drawn.get(from.event.id), endDrawn = context.drawn.get(to.event.id);
    const startBox = startDrawn?.noteBoxes.get(from.note.id), endBox = endDrawn?.noteBoxes.get(to.note.id);
    const dotsEnd = startDrawn ? Math.max(...startDrawn.items.filter(item => item.element === 'note.dot').map(item => item.box.x1), -Infinity) : undefined;
    const p0 = startHere && startBox ? tieEndpoints(startBox, side, true, dotsEnd) : undefined;
    const p1 = endHere && endBox ? tieEndpoints(endBox, side, false) : undefined;
    if (p0 && p1) drawTie(context, p0, p1, side, label, thickness);
    else if (p0) drawTie(context, p0, { x: context.contentEnd + 0.8, y: p0.y }, side, label, thickness);
    else if (p1) drawTie(context, { x: context.contentStart - 0.6, y: p1.y }, p1, side, label, thickness);
  }
  for (const attachment of index.score.attachments) {
    if (attachment.kind !== 'tie.lv' || !('note' in attachment.anchor)) continue;
    const ref = index.note(attachment.anchor.note);
    const drawn = context.drawn.get(ref.event.id);
    const box = drawn?.noteBoxes.get(ref.note.id);
    if (!drawn || !box) continue;
    const shape = prepared.shapes.get(ref.event.id) as ChordShape;
    const side = attachment.side ?? tieSides(context, ref.event, shape).get(ref.note.id) ?? 'above';
    const p0 = tieEndpoints(box, side, true);
    // Let-ring ties stop short of whatever comes next.
    const next = context.timeline.find(column => column.measure === ref.event.measure && column.x > drawn.x + 0.01 && !column.grace);
    const length = Math.min(1.8 * shape.scale, (next ? next.x : context.measures.get(ref.event.measure)!.end) - p0.x - 0.4);
    drawTie(context, p0, { x: p0.x + Math.max(0.8, length), y: p0.y }, side,
      { element: 'tie.lv', refs: [attachment.id, ref.note.id], semantic: semanticOf(ref.event) },
      { middle: ENGRAVING.tieMidpointThickness * shape.scale, end: ENGRAVING.tieEndpointThickness * shape.scale });
  }
}

function drawTie(context: SystemContext, p0: Point, p1: Point, side: TieSide, label: ItemLabel, thickness: { middle: number; end: number }): void {
  const length = p1.x - p0.x;
  const bulge = Math.max(0.35, Math.min(1.1, 0.25 + length * 0.06));
  drawCurve(context, p0, p1, (side === 'above' ? -1 : 1) * bulge / 0.75, label, thickness);
}

/** Where a slur meets an event: on the notehead side at the outer head, on the stem side at the stem tip. */
export function slurEnd(drawn: DrawnEvent, side: 'above' | 'below', isStart: boolean): Point {
  const stem = drawn.stem;
  const onStemSide = stem && ((stem.direction === 'up') === (side === 'above'));
  if (onStemSide && stem) return { x: stem.x + (isStart ? 0.2 : -0.2), y: stem.tipY + (side === 'above' ? -0.6 : 0.6) };
  const box = drawn.heads;
  const x = (box.x0 + box.x1) / 2 + (isStart ? 0.15 : -0.15);
  return { x, y: side === 'above' ? box.y0 - 0.55 : box.y1 + 0.55 };
}

export function slurSide(context: SystemContext, spanner: Spanner, events: readonly ChordEvent[]): 'above' | 'below' {
  if (spanner.side) return spanner.side;
  const index = context.prepared.index;
  const first = events[0];
  if (first && index.drawnVoices(first.measure, first.staff).length > 1) return first.voice % 2 === 1 ? 'above' : 'below';
  const stems = events.map(event => (context.prepared.shapes.get(event.id) as ChordShape | undefined)?.stem).filter(Boolean);
  if (stems.length && stems.every(stem => stem === 'up')) return 'below';
  return 'above';
}
