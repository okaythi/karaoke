/**
 * What the mark placers share for one line of music: the obstacles placed so far,
 * the queue of placement jobs, and the geometry helpers every kind of mark uses.
 */
import * as F from '../../core/fraction';
import type { Drawing, SideRule, TextStyle } from '../../catalogue/types';
import type { Box, TextFace } from '../../fonts/glyphs';
import type { Anchor, Attachment, ScoreEvent, StaffId } from '../../model/types';
import type { DisplayItem, Semantic } from '../display';
import { overlaps, union } from '../display';
import type { DrawnEvent, SystemContext } from '../context';
import { staffTop } from '../context';
import { ENGRAVING } from '../settings';

export type Side = 'above' | 'below';

export interface TextLook { readonly face: TextFace; readonly size: number; readonly italic: boolean }

export const TEXT_LOOKS: Record<TextStyle, TextLook> = {
  tempo: { face: 'AcademicoBold', size: 2.0, italic: false },
  expression: { face: 'Academico', size: 1.9, italic: true },
  technique: { face: 'Academico', size: 1.8, italic: true },
  navigation: { face: 'AcademicoBold', size: 1.8, italic: true },
  rehearsal: { face: 'AcademicoBold', size: 2.0, italic: false },
  small: { face: 'Academico', size: 1.4, italic: false }
};

export const METRONOME_UNITS: Record<string, { glyph: string; dot: boolean }> = {
  whole: { glyph: 'metNoteWhole', dot: false }, half: { glyph: 'metNoteHalfUp', dot: false },
  quarter: { glyph: 'metNoteQuarterUp', dot: false }, eighth: { glyph: 'metNote8thUp', dot: false },
  'dotted-half': { glyph: 'metNoteHalfUp', dot: true }, 'dotted-quarter': { glyph: 'metNoteQuarterUp', dot: true },
  'dotted-eighth': { glyph: 'metNote8thUp', dot: true }
};

/** A placed mark: its items, which staff side it blocks, and the y its baseline group aligns. */
export interface Placed {
  items: DisplayItem[];
  box: Box;
  readonly staff: StaffId;
  readonly side: Side;
  reference: number;
  readonly baseline?: string;
}

export interface Job {
  readonly layer: number;
  readonly order: number;
  readonly run: () => Placed | undefined;
}



export const label = (element: string, refs: readonly string[], semantic: Semantic) => ({ element, refs, semantic });

/** Extra distance past an obstacle when a mark moves clear of it. */
export const CLEAR_STEP = 1e-3;

/** Music-font words on lines (8va, Ped.) are drawn a little smaller than the font's design size. */
export const DECORATION_SCALE = 0.8;

export function markScope(context: SystemContext) {
  const { prepared, builder } = context;
  const { index } = prepared;
  const staves = index.score.staves.map(staff => staff.id).filter(id => context.staffTops.has(id));
  const obstacles = new Map<StaffId, Box[]>(staves.map(staff => [staff, []]));
  for (const item of builder.items) {
    const staff = item.semantic.staff;
    if (staff && item.element !== 'staff.lines') obstacles.get(staff)?.push(item.box);
  }
  const gapShortfall = new Map<StaffId, number>();
  // Keep the original staff ink separate from marks later shared with neighbours.
  const staffInk = new Map(staves.map(staff => [staff, [...obstacles.get(staff)!]]));

  const group = (staff: StaffId) => index.groupOf(staff)?.staves ?? [staff];
  const nextStaff = (staff: StaffId) => group(staff)[group(staff).indexOf(staff) + 1];
  const previousStaff = (staff: StaffId) => group(staff)[group(staff).indexOf(staff) - 1];

  const remember = (placed: Placed) => {
    obstacles.get(placed.staff)?.push(placed.box);
    // Neighbouring ink is handled by growing the gap, not by pushing a mark
    // through the neighbour. Otherwise every rebuild chases that staff outward.
  };

  /**
   * Shift that moves `box` outward until it clears the staff's obstacles.
   * Inner marks take the nearest free spot (a staccato under a slur's arc);
   * outer marks (`contour`) go beyond everything already on that side.
   */
  const clearShift = (box: Box, staff: StaffId, side: Side,
    options: { outside?: boolean; snap?: (dy: number) => number; contour?: boolean } = {}): number => {
    const top = staffTop(context, staff), bottom = top + 4;
    const padding = ENGRAVING.markPadding / 2;
    let dy = 0;
    if (options.outside) dy = side === 'above' ? Math.min(dy, top - ENGRAVING.staffClearance - box.y1) : Math.max(dy, bottom + ENGRAVING.staffClearance - box.y0);
    if (options.snap) dy = options.snap(dy);
    if (options.contour) {
      // Everything over the same stretch that reaches the mark's starting height or beyond.
      for (const other of obstacles.get(staff)!) {
        if (other.x1 + padding <= box.x0 || other.x0 >= box.x1 + padding) continue;
        if (side === 'above' && other.y0 < box.y1 + dy) dy = Math.min(dy, other.y0 - padding - box.y1 - CLEAR_STEP);
        if (side === 'below' && other.y1 > box.y0 + dy) dy = Math.max(dy, other.y1 + padding - box.y0 + CLEAR_STEP);
      }
      return dy;
    }
    for (let guard = 0; guard < 200; guard++) {
      const moved = { ...box, y0: box.y0 + dy, y1: box.y1 + dy };
      const hit = obstacles.get(staff)!.find(other => overlaps(moved, other, padding));
      if (!hit) break;
      // Step just past the obstacle, so a box resting on it no longer counts as touching.
      dy = side === 'above' ? hit.y0 - padding - box.y1 - CLEAR_STEP : hit.y1 + padding - box.y0 + CLEAR_STEP;
      if (options.snap) dy = options.snap(dy);
    }
    return dy;
  };

  const settle = (items: DisplayItem[], staff: StaffId, side: Side, dy: number, reference: number, baseline?: string): Placed => {
    const moved = builder.shift(items, dy);
    const box = moved.map(item => item.box).reduce(union);
    return { items: moved, box, staff, side, reference: reference + dy, baseline };
  };

  const sideFor = (rule: SideRule | undefined, staff: StaffId, event: ScoreEvent | undefined, override?: Side): { staff: StaffId; side: Side } => {
    if (override) return { staff, side: override };
    const multiVoice = event ? index.drawnVoices(event.measure, event.staff).length > 1 : false;
    const voiceSide: Side = event && multiVoice && event.voice % 2 === 0 ? 'below' : 'above';
    switch (rule) {
      case 'notehead': {
        if (multiVoice) return { staff, side: voiceSide };
        const shape = event ? prepared.shapes.get(event.id) : undefined;
        if (shape?.kind === 'chord' && shape.stem) return { staff, side: shape.stem === 'up' ? 'below' : 'above' };
        if (shape?.kind === 'chord') return { staff, side: Math.max(...shape.heads.map(head => head.step)) >= 4 ? 'above' : 'below' };
        return { staff, side: 'above' };
      }
      case 'voice': return { staff, side: voiceSide };
      case 'below': case 'between-staves': return { staff, side: 'below' };
      case 'outer': return { staff, side: previousStaff(staff) && !nextStaff(staff) ? 'below' : 'above' };
      case 'system': return { staff: staves[0], side: 'above' };
      default: return { staff, side: 'above' };
    }
  };

  const eventOf = (anchor: Anchor): ScoreEvent | undefined => {
    if ('event' in anchor) return index.event(anchor.event);
    if ('note' in anchor) return index.note(anchor.note).event;
    return undefined;
  };
  const measureOf = (anchor: Anchor): number => {
    if ('event' in anchor) return index.event(anchor.event).measure;
    if ('note' in anchor) return index.note(anchor.note).event.measure;
    if ('barline' in anchor) return anchor.barline.measure;
    return anchor.position.measure;
  };
  const barlineX = (anchor: Anchor): number | undefined => {
    if (!('barline' in anchor)) return undefined;
    const { measure, side } = anchor.barline;
    const placement = context.measures.get(measure);
    if (placement) return side === 'end' ? placement.end : placement.startBarline;
    if (side === 'start' && measure === context.plan.last + 1) return context.contentEnd;
    return undefined;
  };

  /** x of the next column after an event, or its measure's barline. */
  const nextColumnX = (event: ScoreEvent): number => {
    const at = index.absolute(event.measure, event.offset);
    const later = context.timeline.find(column => !column.grace && F.gt(index.absolute(column.measure, column.offset), at));
    const end = context.measures.get(event.measure)!.end;
    return later && later.measure === event.measure ? later.x : end;
  };

  const glyphFor = (drawing: Extract<Drawing, { type: 'glyph' }>, side: Side, params?: Attachment['params']): string => {
    const variants = drawing.variants;
    const value = variants && params?.[variants.param] !== undefined ? String(params[variants.param]) : undefined;
    if (variants && value !== undefined) {
      const table = side === 'below' && variants.below ? variants.below : variants.above;
      if (table[value]) return table[value];
    }
    return side === 'below' && drawing.below ? drawing.below : drawing.above;
  };

  const jobs: Job[] = [];
  let order = 0;
  /** Jobs within a layer run in the order they were queued. */
  const nextOrder = () => order++;

  return {
    context, prepared, builder, index, staves, obstacles, gapShortfall, staffInk, group, nextStaff, previousStaff, remember, clearShift, settle, sideFor, eventOf, measureOf, barlineX, nextColumnX, glyphFor, jobs, nextOrder
  };
}

export type MarkScope = ReturnType<typeof markScope>;

export function stemBox(drawn: DrawnEvent): Box {
  const stem = drawn.stem!;
  return { x0: stem.x - 0.1, x1: stem.x + 0.1, y0: Math.min(stem.baseY, stem.tipY), y1: Math.max(stem.baseY, stem.tipY) };
}
