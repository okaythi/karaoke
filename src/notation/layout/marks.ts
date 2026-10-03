/**
 * Places every attachment and spanner on a line of music, docs §4 and §8.3.
 *
 * Marks are placed layer by layer, outward from the noteheads. Each starts
 * where its catalogue entry says (side, alignment, inside the staff or not)
 * and moves outward until it clears everything already on its staff; then it
 * becomes an obstacle for the marks after it. Marks that share a baseline
 * (dynamics, pedals, octave lines, tempo) are then lined up at the outermost
 * position any of them needed.
 */
import * as F from '../core/fraction';
import { entry } from '../catalogue/registry';
import type { AttachmentEntry, CatalogueEntry, Decoration, Drawing, SideRule, SpannerEntry, TextStyle } from '../catalogue/types';
import { glyph, measureText } from '../fonts/glyphs';
import type { Box, TextFace } from '../fonts/glyphs';
import type { Anchor, Attachment, ChordEvent, ScoreEvent, Spanner, StaffId, Tuplet } from '../model/types';
import type { DisplayItem, Semantic } from './display';
import { overlaps, union } from './display';
import type { DrawnEvent, SystemContext } from './context';
import { inSystem, staffTop } from './context';
import { clearingHeight, drawCurve, slurEnd, slurSide } from './curves';
import { semanticOf } from './notes';
import { ENGRAVING, SIZE_SCALE } from './settings';
import type { ChordShape } from './shapes';

type Side = 'above' | 'below';

interface TextLook { readonly face: TextFace; readonly size: number; readonly italic: boolean }

export const TEXT_LOOKS: Record<TextStyle, TextLook> = {
  tempo: { face: 'AcademicoBold', size: 2.0, italic: false },
  expression: { face: 'Academico', size: 1.9, italic: true },
  technique: { face: 'Academico', size: 1.8, italic: true },
  navigation: { face: 'AcademicoBold', size: 1.8, italic: true },
  rehearsal: { face: 'AcademicoBold', size: 2.0, italic: false },
  small: { face: 'Academico', size: 1.4, italic: false }
};

const METRONOME_UNITS: Record<string, { glyph: string; dot: boolean }> = {
  whole: { glyph: 'metNoteWhole', dot: false }, half: { glyph: 'metNoteHalfUp', dot: false },
  quarter: { glyph: 'metNoteQuarterUp', dot: false }, eighth: { glyph: 'metNote8thUp', dot: false },
  'dotted-half': { glyph: 'metNoteHalfUp', dot: true }, 'dotted-quarter': { glyph: 'metNoteQuarterUp', dot: true },
  'dotted-eighth': { glyph: 'metNote8thUp', dot: true }
};

/** A placed mark: its items, which staff side it blocks, and the y its baseline group aligns. */
interface Placed {
  items: DisplayItem[];
  box: Box;
  readonly staff: StaffId;
  readonly side: Side;
  reference: number;
  readonly baseline?: string;
}

interface Job {
  readonly layer: number;
  readonly order: number;
  readonly run: () => Placed | undefined;
}

export interface MarkResult {
  /** Extra room the gap below a staff needs for the marks placed in it. */
  readonly gapShortfall: Map<StaffId, number>;
}

const label = (element: string, refs: readonly string[], semantic: Semantic) => ({ element, refs, semantic });

/** Extra distance past an obstacle when a mark moves clear of it. */
const CLEAR_STEP = 1e-3;

/** Music-font words on lines (8va, Ped.) are drawn a little smaller than the font's design size. */
const DECORATION_SCALE = 0.8;

export function placeMarks(context: SystemContext): MarkResult {
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

  // ── Attachments ─────────────────────────────────────────────────────────
  const placeAttachment = (attachment: Attachment, known: AttachmentEntry, event: ScoreEvent | undefined,
    drawn: DrawnEvent | undefined, barline: number | undefined): Placed | undefined => {
    const drawing = known.drawing;
    let anchorStaff = event?.staff ?? staves[0];
    let noteBox: Box | undefined;
    if ('note' in attachment.anchor && drawn) {
      const ref = index.note(attachment.anchor.note);
      anchorStaff = prepared.drawnStaff(ref.event, ref.note.id);
      noteBox = drawn.noteBoxes.get(ref.note.id);
    }
    const { staff, side } = sideFor(known.side, anchorStaff, event, attachment.side);
    const semantic: Semantic = event ? semanticOf(event, staff) : { staff };
    const refs = [attachment.id, ...(event ? [event.id] : [])];
    const align = drawing.type === 'glyph' || drawing.type === 'text' ? drawing.align : 'event';
    const shape = event ? prepared.shapes.get(event.id) : undefined;
    const chord = shape?.kind === 'chord' ? shape : undefined;
    const onStemSide = !!(chord?.stem && drawn?.stem && ((chord.stem === 'up') === (side === 'above')));
    const top = staffTop(context, staff);

    let x = barline ?? context.contentStart;
    if (drawn) {
      const normalHead = chord?.heads.find(head => !head.displaced);
      const headCentre = normalHead ? drawn.x + normalHead.dx + normalHead.width / 2 : (drawn.heads.x0 + drawn.heads.x1) / 2;
      switch (align) {
        case 'event': x = noteBox ? (noteBox.x0 + noteBox.x1) / 2 : onStemSide && known.layer <= 2 ? drawn.stem!.x : headCentre; break;
        case 'stem': x = drawn.stem?.x ?? headCentre; break;
        case 'event-left': {
          // Words follow a dynamic already set on the same note (p dolce, subito ff).
          const before = known.baseline !== 'dynamics' ? [] : builder.items.filter(item => item.refs.includes(drawn.eventId) &&
            item.refs[0] !== attachment.id && item.element.startsWith('dyn.') && !item.element.startsWith('dyn.hairpin') && item.semantic.staff === staff);
          x = before.length ? Math.max(drawn.heads.x0, ...before.map(item => item.box.x1 + 0.5)) : drawn.heads.x0;
          break;
        }
        case 'event-right': x = drawn.heads.x1 + 0.4; break;
        case 'after': x = (drawn.heads.x1 + nextColumnX(event!)) / 2; break;
        case 'measure': { const placement = context.measures.get(event!.measure)!; x = (placement.start + placement.end) / 2; break; }
        case 'measure-start': x = context.measures.get(event!.measure)!.start; break;
        default: x = headCentre;
      }
    } else if ('barline' in attachment.anchor && align === 'measure') {
      const placement = context.measures.get(attachment.anchor.barline.measure);
      if (placement) x = (placement.start + placement.end) / 2;
    }

    if (drawing.type === 'glyph') {
      const name = glyphFor(drawing, side, attachment.params);
      const smallOnly = known.sizes.includes('small-text') && !known.sizes.includes('full');
      const scale = smallOnly ? SIZE_SCALE['small-text'] : known.layer <= 2 && drawn ? drawn.scale : 1;
      const box = glyph(name).box;
      const width = (box.x1 - box.x0) * scale;
      const centred = align !== 'event-left' && align !== 'event-right' && align !== 'measure-start';
      const gx = centred ? x - width / 2 - box.x0 * scale : x - box.x0 * scale;

      if (align === 'stem') {
        // Tremolo strokes cross the stem between notehead and tip; on a whole note, where the stem would be.
        const stem = drawn?.stem;
        const y = stem ? (stem.baseY + stem.tipY) / 2 + (stem.direction === 'up' ? 0.3 : -0.3) : (drawn ? drawn.heads.y0 - 2 : top);
        const item = builder.glyph(name, (stem?.x ?? x) - ((box.x0 + box.x1) / 2) * scale, y, label(known.id, refs, semantic), { scale });
        return { items: [item], box: item.box, staff, side, reference: y };
      }
      if (known.side === 'through') {
        const y = known.id === 'nav.bar-repeat' ? top + 2 : top + 1;
        const item = builder.glyph(name, gx, y, label(known.id, refs, semantic), { scale });
        return { items: [item], box: item.box, staff, side, reference: y };
      }
      const anchorBox = noteBox ?? (onStemSide && drawn?.stem ? stemBox(drawn) : drawn?.heads);
      const edge = side === 'above' ? (anchorBox?.y0 ?? top) - 0.3 : (anchorBox?.y1 ?? top + 4) + 0.3;
      const y = side === 'above' ? edge - box.y1 * scale : edge - box.y0 * scale;
      const item = builder.glyph(name, gx, y, label(known.id, refs, semantic), { scale });
      if (drawing.inside && !onStemSide) {
        // Inside the staff a mark centres in a space, never on a line, and only moves outward.
        const centreOf = (dy: number) => (item.box.y0 + item.box.y1) / 2 + dy;
        const snap = (dy: number) => {
          const centre = centreOf(dy);
          if (centre <= top || centre >= top + 4) return dy;
          const spaces = [0.5, 1.5, 2.5, 3.5].map(offset => top + offset)
            .filter(space => (side === 'above' ? space <= centre + 1e-6 : space >= centre - 1e-6));
          if (!spaces.length) return dy + (side === 'above' ? top - 0.6 - item.box.y1 - dy : top + 4.6 - item.box.y0 - dy);
          const target = side === 'above' ? Math.max(...spaces) : Math.min(...spaces);
          return dy + target - centre;
        };
        return settle([item], staff, side, clearShift(item.box, staff, side, { snap }), y, known.baseline);
      }
      return settle([item], staff, side, clearShift(item.box, staff, side, { outside: true, contour: known.layer >= 4 }), y, known.baseline);
    }

    if (drawing.type === 'text') {
      const look = TEXT_LOOKS[drawing.style];
      if (drawing.content === 'metronome') return placeMetronome(attachment, x, staff, side, semantic, refs, look);
      const text = attachment.text ?? drawing.default ?? '';
      const metrics = measureText(text, look.face, look.size);
      const anchor = align === 'event' || align === 'barline' || align === 'measure' ? 'middle' : align === 'before-barline' ? 'end' : 'start';
      const y = side === 'above' ? top - 1 : top + 5 + metrics.ascent;
      const items = [builder.text(text, align === 'before-barline' ? x - 0.4 : x, y, look.face, look.size, label(known.id, refs, semantic),
        { italic: look.italic, anchor })];
      if (drawing.enclosure === 'box') {
        const pad = 0.4, box = items[0].box;
        items.push(builder.rect(box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + pad * 2, box.y1 - box.y0 + pad * 2,
          ENGRAVING.textEnclosureThickness, label(known.id, refs, semantic)));
      }
      const box = items.map(item => item.box).reduce(union);
      return settle(items, staff, side, clearShift(box, staff, side, { outside: true, contour: known.layer >= 4 }), y, known.baseline);
    }
    return undefined;
  };

  const placeMetronome = (attachment: Attachment, x: number, staff: StaffId, side: Side, semantic: Semantic,
    refs: readonly string[], look: TextLook): Placed => {
    const unit = METRONOME_UNITS[String(attachment.params?.unit ?? 'quarter')] ?? METRONOME_UNITS.quarter;
    // Tempo words on the same event come first; the mark follows on their baseline.
    const event = eventOf(attachment.anchor);
    const words = builder.items.filter(item => item.element === 'tempo.text' && event && item.refs.includes(event.id));
    const y = words[0]?.primitive.kind === 'text' ? words[0].primitive.y : staffTop(context, staff) - 1;
    let at = words.length ? Math.max(...words.map(item => item.box.x1)) + 1 : x;
    const items: DisplayItem[] = [];
    const scale = 0.85;
    if (words.length) {
      const open = builder.text('(', at, y, look.face, look.size, label('tempo.metronome', refs, semantic));
      items.push(open);
      at = open.box.x1 + 0.1;
    }
    items.push(builder.glyph(unit.glyph, at, y, label('tempo.metronome', refs, semantic), { scale }));
    at += glyph(unit.glyph).advance * scale + 0.15;
    if (unit.dot) {
      items.push(builder.glyph('metAugmentationDot', at, y, label('tempo.metronome', refs, semantic), { scale }));
      at += glyph('metAugmentationDot').advance * scale + 0.15;
    }
    items.push(builder.text(` = ${attachment.params?.bpm ?? ''}${words.length ? ')' : ''}`, at, y, 'Academico', look.size, label('tempo.metronome', refs, semantic)));
    const box = items.map(item => item.box).reduce(union);
    if (words.length) return { items, box, staff, side, reference: y };
    return settle(items, staff, side, clearShift(box, staff, side, { outside: true, contour: true }), y, 'tempo');
  };

  for (const attachment of index.score.attachments) {
    const known = entry(attachment.kind) as AttachmentEntry;
    const type = known.drawing.type;
    if (type !== 'glyph' && type !== 'text') continue;
    const barline = barlineX(attachment.anchor);
    if (!inSystem(context, measureOf(attachment.anchor)) && barline === undefined) continue;
    const event = eventOf(attachment.anchor);
    const drawn = event ? context.drawn.get(event.id) : undefined;
    if (event && !drawn) continue;
    jobs.push({ layer: known.layer, order: order++, run: () => placeAttachment(attachment, known, event, drawn, barline) });
  }

  // ── Vertical signs (arpeggios) ─────────────────────────────────────────
  const placeVertical = (known: CatalogueEntry, ref: string, events: readonly ScoreEvent[]): Placed | undefined => {
    const drawing = known.drawing;
    if (drawing.type !== 'vertical') return undefined;
    const drawnEvents = events.map(event => context.drawn.get(event.id)).filter((item): item is DrawnEvent => !!item);
    if (!drawnEvents.length) return undefined;
    const top = Math.min(...drawnEvents.map(item => item.heads.y0)) - 0.3;
    const bottom = Math.max(...drawnEvents.map(item => item.heads.y1)) + 0.3;
    const leftInk = Math.min(...drawnEvents.map(item => {
      const shape = prepared.shapes.get(item.eventId);
      return item.x + (shape?.kind === 'chord' ? Math.min(shape.left, 0) : 0);
    }));
    const semantic = semanticOf(events[0]);
    const refs = [ref, ...events.map(event => event.id)];
    const items: DisplayItem[] = [];
    if (drawing.bracket) {
      const x = leftInk - 0.5, thickness = ENGRAVING.tupletBracketThickness;
      items.push(builder.line(x, top, x, bottom, thickness, label(known.id, refs, semantic)));
      items.push(builder.line(x, top, x + 0.45, top, thickness, label(known.id, refs, semantic)));
      items.push(builder.line(x, bottom, x + 0.45, bottom, thickness, label(known.id, refs, semantic)));
    } else {
      // SMuFL draws arpeggio wiggles horizontally; they are turned to run up (or down) the chord.
      const segment = glyph(drawing.segment);
      // Turned a quarter turn, the wiggle runs upward from its origin. An upward
      // arrow caps the top; a downward arrow starts the line at the bottom.
      const up = drawing.cap?.up, down = drawing.cap?.down;
      const capLength = (up ? glyph(up).advance : 0) + (down ? glyph(down).advance : 0);
      const count = Math.max(1, Math.round((bottom - top - capLength) / segment.advance));
      const originX = leftInk - 0.35;
      const rotate = -90;
      let y = bottom;
      if (down) { items.push(builder.glyph(down, originX, y, label(known.id, refs, semantic), { rotate })); y -= glyph(down).advance; }
      for (let n = 0; n < count; n++, y -= segment.advance)
        items.push(builder.glyph(drawing.segment, originX, y, label(known.id, refs, semantic), { rotate }));
      if (up) items.push(builder.glyph(up, originX, y, label(known.id, refs, semantic), { rotate }));
    }
    return { items, box: items.map(item => item.box).reduce(union), staff: events[0].staff, side: 'above', reference: top };
  };

  for (const attachment of index.score.attachments) {
    const known = entry(attachment.kind);
    const event = known.drawing.type === 'vertical' ? eventOf(attachment.anchor) : undefined;
    if (event && context.drawn.has(event.id)) jobs.push({ layer: 0, order: order++, run: () => placeVertical(known, attachment.id, [event]) });
  }

  // ── Tuplets ─────────────────────────────────────────────────────────────
  const placeTuplet = (tuplet: Tuplet, members: readonly ScoreEvent[]): Placed | undefined => {
    const drawnMembers = members.map(event => context.drawn.get(event.id)!).sort((a, b) => a.x - b.x);
    const first = drawnMembers[0], last = drawnMembers.at(-1)!;
    const chords = members.filter((event): event is ChordEvent => event.kind === 'chord');
    const stems = chords.map(event => (prepared.shapes.get(event.id) as ChordShape).stem).filter(Boolean);
    const ups = stems.filter(stem => stem === 'up').length;
    const side: Side = tuplet.side && tuplet.side !== 'auto' ? tuplet.side : stems.length && ups * 2 < stems.length ? 'below' : 'above';
    const staff = members[0].staff;
    // One beam covering exactly the tuplet's notes needs no bracket.
    const plan = chords.length ? prepared.beamOf.get(chords[0].id) : undefined;
    const exactBeam = !!plan && members.every(event => plan.events.includes(event as ChordEvent)) &&
      plan.events.every(event => members.includes(event));
    const bracket = tuplet.bracket === 'show' || (tuplet.bracket !== 'hide' && !exactBeam);
    const conventional = tuplet.normal === 2 ** Math.floor(Math.log2(tuplet.actual)) || ((tuplet.actual === 2 || tuplet.actual === 4) && tuplet.normal === 3);
    const mode = tuplet.number && tuplet.number !== 'auto' ? tuplet.number : conventional ? 'number' : 'ratio';
    if (mode === 'none' && !bracket) return undefined;
    const semantic = semanticOf(members[0]);
    const refs = [tuplet.id];
    const items: DisplayItem[] = [];
    const scale = 0.72;
    const stemSide = (drawn: DrawnEvent) => !!drawn.stem && ((drawn.stem.direction === 'up') === (side === 'above'));
    const x0 = stemSide(first) ? first.stem!.x - 0.3 : first.heads.x0 - 0.2;
    const x1 = stemSide(last) ? last.stem!.x + 0.3 : last.heads.x1 + 0.2;
    const centre = (x0 + x1) / 2;
    const digits = (value: number) => String(value).split('').map(digit => `tuplet${digit}`);
    const names = mode === 'ratio' ? [...digits(tuplet.actual), 'tupletColon', ...digits(tuplet.normal)] : mode === 'number' ? digits(tuplet.actual) : [];
    const width = names.reduce((sum, name) => sum + glyph(name).advance * scale, 0);
    const numberHeight = 1.5 * scale;
    const extreme = side === 'above'
      ? Math.min(...drawnMembers.map(item => Math.min(item.heads.y0, item.stem?.tipY ?? Infinity))) - 0.6
      : Math.max(...drawnMembers.map(item => Math.max(item.heads.y1, item.stem?.tipY ?? -Infinity))) + 0.6;
    const baseline = side === 'above' ? extreme : extreme + numberHeight;
    let at = centre - width / 2;
    for (const name of names) {
      items.push(builder.glyph(name, at, baseline, label('tuplet.number', refs, semantic), { scale }));
      at += glyph(name).advance * scale;
    }
    if (bracket) {
      const lineY = baseline - numberHeight / 2;
      const hook = side === 'above' ? 0.6 : -0.6;
      const gapLeft = names.length ? centre - width / 2 - 0.3 : centre, gapRight = names.length ? centre + width / 2 + 0.3 : centre;
      const thickness = ENGRAVING.tupletBracketThickness;
      for (const [ax, ay, bx, by] of [[x0, lineY + hook, x0, lineY], [x0, lineY, gapLeft, lineY], [gapRight, lineY, x1, lineY], [x1, lineY, x1, lineY + hook]])
        items.push(builder.line(ax, ay, bx, by, thickness, label('tuplet.bracket', refs, semantic)));
    }
    if (!items.length) return undefined;
    const box = items.map(item => item.box).reduce(union);
    return settle(items, staff, side, clearShift(box, staff, side), baseline);
  };

  const tupletMembers = new Map<string, ScoreEvent[]>();
  for (const eventId of context.drawn.keys()) {
    const event = index.event(eventId);
    for (const tuplet of index.tupletChain(event)) {
      const members = tupletMembers.get(tuplet.id) ?? [];
      members.push(event);
      tupletMembers.set(tuplet.id, members);
    }
  }
  for (const [id, members] of tupletMembers) {
    const tuplet = index.tuplet(id);
    jobs.push({ layer: 6, order: order++, run: () => placeTuplet(tuplet, members) });
  }

  // ── Spanners ────────────────────────────────────────────────────────────
  const placeSlur = (spanner: Spanner, known: SpannerEntry): Placed | undefined => {
    const start = eventOf(spanner.start), end = eventOf(spanner.end);
    if (!start || !end) return undefined;
    const startDrawn = context.drawn.get(start.id), endDrawn = context.drawn.get(end.id);
    const from = index.absolute(start.measure, start.offset), to = index.absolute(end.measure, end.offset);
    const under = index.score.events.filter((event): event is ChordEvent => event.kind === 'chord' && event.staff === start.staff &&
      event.voice === start.voice && F.ge(index.absolute(event.measure, event.offset), from) && F.le(index.absolute(event.measure, event.offset), to));
    const side = slurSide(context, spanner, under);
    const staff = start.staff;
    const top = staffTop(context, staff);
    const fallbackY = side === 'above' ? top - 1 : top + 5;
    let p0 = startDrawn ? slurEnd(startDrawn, side, true) : undefined;
    let p1 = endDrawn ? slurEnd(endDrawn, side, false) : undefined;
    p0 ??= { x: context.contentStart - 0.5, y: p1?.y ?? fallbackY };
    p1 ??= { x: context.contentEnd + 0.6, y: p0.y };
    const relevant = obstacles.get(staff)!.filter(box => box.x1 > p0!.x + 0.3 && box.x0 < p1!.x - 0.3);
    const scale = startDrawn?.scale ?? 1;
    const minimum = Math.max(0.7, Math.min(2.2, 0.5 + (p1.x - p0.x) * 0.08)) / 0.75;
    const { height, lift } = clearingHeight(p0, p1, relevant, side, minimum, Math.max(minimum, 4.5), 0.3);
    const sign = side === 'above' ? -1 : 1;
    const before = builder.items.length;
    const box = drawCurve(context, { x: p0.x, y: p0.y + sign * lift }, { x: p1.x, y: p1.y + sign * lift }, height,
      label(known.id, [spanner.id], semanticOf(start)),
      { middle: ENGRAVING.slurMidpointThickness * scale, end: ENGRAVING.slurEndpointThickness * scale });
    return { items: builder.items.slice(before), box, staff, side, reference: box.y0 };
  };

  const placeLine = (spanner: Spanner, known: SpannerEntry): Placed | undefined => {
    const drawing = known.drawing;
    if (drawing.type !== 'line') return undefined;
    const start = eventOf(spanner.start), end = eventOf(spanner.end);
    const startMeasure = measureOf(spanner.start), endMeasure = measureOf(spanner.end);
    const startBar = barlineX(spanner.start), endBar = barlineX(spanner.end);
    const startsHere = start ? inSystem(context, startMeasure) : startBar !== undefined;
    const endsHere = end ? inSystem(context, endMeasure) : endBar !== undefined;
    const { staff, side } = sideFor(known.side, start?.staff ?? end?.staff ?? staves[0], start, spanner.side);
    const semantic: Semantic = start ? semanticOf(start, staff) : { staff };
    const refs = [spanner.id];
    const element = known.id;
    const make = (glyphLabel = element) => label(glyphLabel, refs, semantic);

    // Glissandi run from notehead to notehead and are not stacked.
    if ('note' in spanner.start && 'note' in spanner.end) {
      const a = index.note(spanner.start.note), b = index.note(spanner.end.note);
      const boxA = context.drawn.get(a.event.id)?.noteBoxes.get(a.note.id), boxB = context.drawn.get(b.event.id)?.noteBoxes.get(b.note.id);
      if (!boxA || !boxB) return undefined;
      const item = builder.line(boxA.x1 + 0.4, (boxA.y0 + boxA.y1) / 2, boxB.x0 - 0.6, (boxB.y0 + boxB.y1) / 2, ENGRAVING.octaveLineThickness, make());
      return { items: [item], box: item.box, staff, side, reference: 0 };
    }

    const startDrawn = start ? context.drawn.get(start.id) : undefined;
    const endDrawn = end ? context.drawn.get(end.id) : undefined;
    // A dynamic on the first note of a span comes first, and the span follows it.
    const dynamicOn = (event: ScoreEvent) => builder.items.find(item => item.element.startsWith('dyn.') && !item.element.startsWith('dyn.hairpin') &&
      !item.element.startsWith('dyn.text') && item.refs.includes(event.id) && item.refs[0] !== spanner.id && item.primitive.kind === 'glyph');
    const startDynamic = startsHere && start && known.baseline === 'dynamics' ? dynamicOn(start) : undefined;
    const x0 = startsHere ? Math.max(startDrawn?.heads.x0 ?? startBar ?? context.contentStart, startDynamic ? startDynamic.box.x1 + 0.6 : -Infinity)
      : context.contentStart;
    let x1 = context.contentEnd - 0.4;
    if (endsHere) {
      if (endDrawn) {
        if (known.endsAt === 'onset') x1 = endDrawn.heads.x0 - 0.2;
        else if (drawing.extent === 'duration') x1 = Math.max(endDrawn.heads.x1 + 0.2, nextColumnX(end!) - 0.8);
        else x1 = endDrawn.heads.x1 + 0.2;
      }
      else if (endBar !== undefined) x1 = endBar - 0.3;
      // A hairpin stops short of a dynamic on its last note.
      const endDynamic = end && known.baseline === 'dynamics' ? dynamicOn(end) : undefined;
      if (endDynamic) x1 = Math.min(x1, endDynamic.box.x0 - 0.6);
    }
    const top = staffTop(context, staff);
    const lineY = side === 'above' ? top - 2 : top + 6;
    const items: DisplayItem[] = [];
    let lineStart = x0, lineEnd = x1;
    const decorate = (decoration: Decoration | undefined, at: number, atEnd: boolean): void => {
      if (!decoration) return;
      if (decoration.kind === 'hook') {
        const toward = (decoration.toward === 'staff') === (side === 'above') ? 1 : -1;
        items.push(builder.line(at, lineY, at, lineY + toward * 0.9, ENGRAVING.octaveLineThickness, make()));
      } else if (decoration.kind === 'glyph') {
        const name = side === 'below' && decoration.below ? decoration.below : decoration.glyph;
        const scale = DECORATION_SCALE;
        const box = glyph(name).box;
        const gy = lineY - ((box.y0 + box.y1) / 2) * scale;
        let gx = atEnd ? at - (box.x1 - box.x0) * scale : at;
        if (decoration.parenthesize) {
          const open = builder.text('(', gx, gy, 'Academico', 2.2, make(), { italic: true });
          items.push(open);
          gx = open.box.x1 + 0.05;
        }
        const mark = builder.glyph(name, gx - box.x0 * scale, gy, make(), { scale });
        items.push(mark);
        let right = mark.box.x1;
        if (decoration.parenthesize) {
          const close = builder.text(')', right + 0.05, gy, 'Academico', 2.2, make(), { italic: true });
          items.push(close);
          right = close.box.x1;
        }
        if (atEnd) lineEnd = Math.min(lineEnd, gx - 0.4); else lineStart = Math.max(lineStart, right + 0.4);
      } else if (decoration.kind === 'text') {
        const look = TEXT_LOOKS[decoration.style];
        const raw = (atEnd ? undefined : spanner.text) ?? decoration.default ?? '';
        const text = decoration.parenthesize ? `(${raw})` : raw;
        const metrics = measureText(text, look.face, look.size);
        const item = builder.text(text, at, lineY + metrics.ascent / 2, look.face, look.size, make(), { italic: look.italic, anchor: atEnd ? 'end' : 'start' });
        items.push(item);
        if (atEnd) lineEnd = Math.min(lineEnd, item.box.x0 - 0.4); else lineStart = Math.max(lineStart, item.box.x1 + 0.5);
      }
    };
    decorate(startsHere ? drawing.start : drawing.continuation, x0, false);
    if (startsHere && drawing.label && spanner.text) {
      // A bracket's label sits inside it, just after the opening hook.
      const look = TEXT_LOOKS[drawing.label];
      const metrics = measureText(spanner.text, look.face, look.size);
      const ty = side === 'above' ? lineY + 0.4 + metrics.ascent : lineY - 0.4;
      items.push(builder.text(spanner.text, x0 + 0.5, ty, look.face, look.size, make(), { italic: look.italic }));
    }
    if (endsHere && spanner.params?.open !== true) decorate(drawing.end, x1, true);
    const thickness = known.family === 'pedal' ? ENGRAVING.pedalLineThickness : known.family === 'dyn' ? ENGRAVING.hairpinThickness : ENGRAVING.octaveLineThickness;
    if (lineEnd > lineStart + 0.2) {
      switch (drawing.line) {
        case 'solid': items.push(builder.line(lineStart, lineY, lineEnd, lineY, thickness, make())); break;
        case 'dashed': items.push(builder.line(lineStart, lineY, lineEnd, lineY, thickness, make(), { dash: [0.6, 0.5] })); break;
        case 'wiggle': {
          const wiggle = glyph('wiggleTrill');
          for (let at = lineStart; at + wiggle.advance <= lineEnd + 0.01; at += wiggle.advance)
            items.push(builder.glyph('wiggleTrill', at, lineY - (wiggle.box.y0 + wiggle.box.y1) / 2, make()));
          break;
        }
        case 'hairpin-open': case 'hairpin-close': {
          const opening = lineEnd - lineStart > 10 ? 1 : 0.75;
          const growing = drawing.line === 'hairpin-open';
          // A hairpin continued from the previous line restarts slightly open.
          const startOpen = growing ? (startsHere ? 0 : opening * 0.4) : opening;
          const endOpen = growing ? opening : (endsHere ? 0 : opening * 0.4);
          items.push(builder.line(lineStart, lineY - startOpen / 2, lineEnd, lineY - endOpen / 2, thickness, make()));
          items.push(builder.line(lineStart, lineY + startOpen / 2, lineEnd, lineY + endOpen / 2, thickness, make()));
          break;
        }
        case 'none': break;
      }
      if (drawing.line === 'solid' && known.family === 'pedal') {
        // Pedal changes inside a bracket: a notch up toward the staff.
        for (const change of index.score.attachments) {
          if (change.kind !== 'pedal.change') continue;
          const at = eventOf(change.anchor);
          const drawnChange = at ? context.drawn.get(at.id) : undefined;
          if (!drawnChange || at!.staff !== start?.staff || drawnChange.heads.x0 <= lineStart || drawnChange.heads.x0 >= lineEnd) continue;
          const nx = drawnChange.heads.x0;
          const notch = label('pedal.change', [change.id], semantic);
          items.push(builder.line(nx - 0.45, lineY, nx, lineY - 0.8, thickness, notch));
          items.push(builder.line(nx, lineY - 0.8, nx + 0.45, lineY, thickness, notch));
        }
      }
    }
    if (!items.length) return undefined;
    // Hairpins line up with dynamics: their centre at the dynamics' middle height.
    const reference = known.baseline === 'dynamics' ? lineY + 0.55 : lineY;
    const box = items.map(item => item.box).reduce(union);
    return settle(items, staff, side, clearShift(box, staff, side, { outside: true, contour: known.layer >= 4 }), reference, known.baseline);
  };

  for (const spanner of index.score.spanners) {
    const known = entry(spanner.kind) as SpannerEntry;
    const drawing = known.drawing;
    if (spanner.kind === 'tie' || drawing.type === 'structure') continue;
    if (measureOf(spanner.end) < context.plan.first || measureOf(spanner.start) > context.plan.last) continue;
    if (drawing.type === 'vertical') {
      const events = [eventOf(spanner.start), eventOf(spanner.end)].filter((event): event is ScoreEvent => !!event);
      jobs.push({ layer: 0, order: order++, run: () => placeVertical(known, spanner.id, events) });
    } else if (drawing.type === 'curve') {
      jobs.push({ layer: known.layer, order: order++, run: () => placeSlur(spanner, known) });
    } else {
      // Line spanners go after the attachments of their layer, so hairpins see the dynamics they end at.
      jobs.push({ layer: known.layer, order: 1e6 + order++, run: () => placeLine(spanner, known) });
    }
  }

  // ── Run, layer by layer ─────────────────────────────────────────────────
  jobs.sort((a, b) => a.layer - b.layer || a.order - b.order);
  const allPlaced: Placed[] = [];
  for (const layer of [...new Set(jobs.map(job => job.layer))]) {
    const placed: Placed[] = [];
    for (const job of jobs.filter(item => item.layer === layer)) {
      const result = job.run();
      if (!result) continue;
      placed.push(result);
      allPlaced.push(result);
      remember(result);
    }
    const baselineGroups = new Map<string, Placed[]>();
    for (const item of placed) {
      if (!item.baseline) continue;
      const groupKey = `${item.baseline}:${item.staff}:${item.side}`;
      (baselineGroups.get(groupKey) ?? baselineGroups.set(groupKey, []).get(groupKey)!).push(item);
    }
    for (const members of baselineGroups.values()) {
      const above = members[0].side === 'above';
      const target = above ? Math.min(...members.map(item => item.reference)) : Math.max(...members.map(item => item.reference));
      // Members share the baseline unless that would put two of them on top of each other;
      // then the later one moves further out.
      const aligned: Box[] = [];
      for (const member of [...members].sort((a, b) => a.box.x0 - b.box.x0)) {
        let dy = target - member.reference;
        for (let guard = 0; guard < 20; guard++) {
          const moved = { ...member.box, y0: member.box.y0 + dy, y1: member.box.y1 + dy };
          const hit = aligned.find(box => overlaps(moved, box, 0.3));
          if (!hit) break;
          dy += above ? hit.y0 - 0.3 - moved.y1 - CLEAR_STEP : hit.y1 + 0.3 - moved.y0 + CLEAR_STEP;
        }
        if (Math.abs(dy) > 1e-6) {
          member.items = builder.shift(member.items, dy);
          member.box = { ...member.box, y0: member.box.y0 + dy, y1: member.box.y1 + dy };
          member.reference += dy;
          remember(member);
        }
        aligned.push(member.box);
      }
    }
  }
  // Check the completed layout, including marks above the lower staff.
  for (const item of allPlaced) {
    const next = item.side === 'below' ? nextStaff(item.staff) : undefined;
    if (!next) continue;
    const lowerInk = [...staffInk.get(next)!, ...allPlaced
      .filter(mark => mark.staff === next && mark.side === 'above').map(mark => mark.box)];
    const inkTop = Math.min(staffTop(context, next), ...lowerInk
      .filter(box => box.x0 < item.box.x1 && box.x1 > item.box.x0)
      .map(box => box.y0));
    const room = inkTop - ENGRAVING.staffClearance - item.box.y1;
    if (room < 0) gapShortfall.set(item.staff, Math.max(gapShortfall.get(item.staff) ?? 0, -room));
  }
  return { gapShortfall };
}

function stemBox(drawn: DrawnEvent): Box {
  const stem = drawn.stem!;
  return { x0: stem.x - 0.1, x1: stem.x + 0.1, y0: Math.min(stem.baseY, stem.tipY), y1: Math.max(stem.baseY, stem.tipY) };
}
