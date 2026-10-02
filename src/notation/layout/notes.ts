/**
 * Draws chords and rests at their place in a system: noteheads, ledger
 * lines, accidentals, dots, and the stems and flags of unbeamed notes.
 * Beamed stems get their length from the beam stage.
 */
import { glyph } from '../fonts/glyphs';
import type { Box } from '../fonts/glyphs';
import type { ChordEvent, RestEvent, ScoreEvent, StaffId } from '../model/types';
import { MIDDLE_LINE, TOP_LINE, ledgerSteps, stepY } from '../rules/staffPosition';
import { union } from './display';
import type { DisplayItem, Semantic } from './display';
import { staffTop } from './context';
import type { DrawnEvent, SystemContext } from './context';
import { ENGRAVING } from './settings';
import type { ChordShape, RestShape } from './shapes';

const REST_ELEMENTS: Record<string, string> = {
  restWhole: 'rest.whole', restHalf: 'rest.half', restQuarter: 'rest.quarter', rest8th: 'rest.8th', rest16th: 'rest.16th',
  rest32nd: 'rest.32nd', rest64th: 'rest.64th', rest128th: 'rest.128th', restDoubleWhole: 'rest.whole'
};
const ACCIDENTAL_ELEMENTS: Record<string, string> = {
  accidentalSharp: 'acc.sharp', accidentalFlat: 'acc.flat', accidentalNatural: 'acc.natural',
  accidentalDoubleSharp: 'acc.double-sharp', accidentalDoubleFlat: 'acc.double-flat'
};
const FLAG_NAMES = ['', '8th', '16th', '32nd', '64th', '128th'];

export function semanticOf(event: ScoreEvent, staff: StaffId = event.staff, extra?: { roles?: readonly string[]; tags?: readonly string[] }): Semantic {
  const roles = [...(event.labels?.roles ?? []), ...(extra?.roles ?? [])];
  const tags = [...(event.labels?.tags ?? []), ...(extra?.tags ?? [])];
  return { staff, voice: event.voice, measure: event.measure, ...(roles.length ? { roles } : {}), ...(tags.length ? { tags } : {}) };
}

function headElement(event: ChordEvent): string {
  if (event.grace) return event.grace.placement === 'after' ? 'grace.after' : `grace.${event.grace.kind}`;
  return event.cue ? 'cue.note' : 'note.head';
}

export function drawRest(context: SystemContext, event: RestEvent, shape: RestShape, x: number): DrawnEvent {
  const { builder } = context;
  const top = staffTop(context, event.staff);
  let left = x + shape.shift;
  if (event.fullBar) {
    const placement = context.measures.get(event.measure)!;
    left = (placement.start + placement.end) / 2 - shape.width / 2;
  }
  const y = top + stepY(shape.step);
  const semantic = semanticOf(event);
  const items: DisplayItem[] = [];
  const element = event.fullBar ? 'rest.full-bar' : event.value.dots ? 'rest.dotted' : REST_ELEMENTS[shape.glyph] ?? 'rest.quarter';
  const restItem = builder.glyph(shape.glyph, left, y, { element, refs: [event.id], semantic }, { scale: shape.scale });
  items.push(restItem);
  // Whole and half rests outside the staff stand on a short ledger line.
  if ((shape.glyph === 'restWhole' || shape.glyph === 'restHalf') && (shape.step > TOP_LINE || shape.step < 0)) {
    const lineY = top + stepY(shape.step);
    items.push(builder.line(left - 0.3, lineY, left + shape.width + 0.3, lineY, ENGRAVING.legerLineThickness, { element: 'staff.ledger', refs: [event.id], semantic }));
  }
  for (let dot = 0; dot < shape.dotCount; dot++) {
    const dotX = left + shape.width + ENGRAVING.dotGap + dot * ENGRAVING.dotSpacing;
    items.push(builder.glyph('augmentationDot', dotX, top + stepY(5), { element: 'note.dot', refs: [event.id], semantic }));
  }
  return {
    eventId: event.id, staff: event.staff, voice: event.voice, measure: event.measure, x: left,
    heads: restItem.box, noteBoxes: new Map(), scale: shape.scale, items
  };
}

export function drawChord(context: SystemContext, event: ChordEvent, shape: ChordShape, columnX: number): DrawnEvent {
  const { builder } = context;
  const x = columnX + shape.shift;
  const items: DisplayItem[] = [];
  const noteBoxes = new Map<string, Box>();
  const element = headElement(event);

  for (const head of shape.heads) {
    const y = staffTop(context, head.staff) + stepY(head.step);
    const note = event.notes.find(item => item.id === head.noteId)!;
    const semantic = semanticOf(event, head.staff, note.labels);
    const item = builder.glyph(head.glyph, x + head.dx, y, { element, refs: [head.noteId, event.id], semantic }, { scale: shape.scale });
    items.push(item);
    noteBoxes.set(head.noteId, item.box);
  }

  // Ledger lines, per staff and per line, wide enough for every head that needs them.
  const extension = ENGRAVING.legerLineExtension * shape.scale;
  const ledgers = new Map<string, { staff: StaffId; step: number; x0: number; x1: number }>();
  for (const head of shape.heads) {
    for (const step of ledgerSteps(head.step)) {
      const key = `${head.staff}:${step}`;
      const current = ledgers.get(key);
      const x0 = x + head.dx - extension, x1 = x + head.dx + head.width + extension;
      ledgers.set(key, current ? { ...current, x0: Math.min(current.x0, x0), x1: Math.max(current.x1, x1) } : { staff: head.staff, step, x0, x1 });
    }
  }
  for (const ledger of ledgers.values()) {
    const y = staffTop(context, ledger.staff) + stepY(ledger.step);
    items.push(builder.line(ledger.x0, y, ledger.x1, y, ENGRAVING.legerLineThickness * Math.max(shape.scale, 0.8),
      { element: 'staff.ledger', refs: [event.id], semantic: semanticOf(event, ledger.staff) }));
  }

  for (const accidental of shape.accidentals) {
    const y = staffTop(context, accidental.staff) + stepY(accidental.step);
    const semantic = semanticOf(event, accidental.staff);
    let at = x + accidental.dx;
    const refs = [accidental.noteId, event.id];
    if (accidental.courtesy) {
      items.push(builder.glyph('accidentalParensLeft', at, y, { element: 'acc.courtesy', refs, semantic }, { scale: shape.scale }));
      at += glyph('accidentalParensLeft').advance * shape.scale;
    }
    items.push(builder.glyph(accidental.glyph, at, y, { element: ACCIDENTAL_ELEMENTS[accidental.glyph], refs, semantic }, { scale: shape.scale }));
    if (accidental.courtesy) {
      at += glyph(accidental.glyph).advance * shape.scale;
      items.push(builder.glyph('accidentalParensRight', at, y, { element: 'acc.courtesy', refs, semantic }, { scale: shape.scale }));
    }
  }

  for (const dot of shape.dots) {
    const y = staffTop(context, dot.staff) + stepY(dot.step);
    for (let count = 0; count < shape.dotCount; count++)
      items.push(builder.glyph('augmentationDot', x + dot.dx + count * ENGRAVING.dotSpacing * shape.scale, y,
        { element: 'note.dot', refs: [event.id], semantic: semanticOf(event, dot.staff) }, { scale: shape.scale }));
  }

  const heads = [...noteBoxes.values()].reduce(union);
  let stem: DrawnEvent['stem'];
  if (shape.stem) {
    const headYs = shape.heads.map(head => staffTop(context, head.staff) + stepY(head.step));
    const up = shape.stem === 'up';
    // The stem starts at the far notehead and runs past the near one.
    const anchorOffset = 0.168 * shape.scale;
    const baseY = up ? Math.max(...headYs) - anchorOffset : Math.min(...headYs) + anchorOffset;
    const nearY = up ? Math.min(...headYs) : Math.max(...headYs);
    const extraFlags = Math.max(0, shape.flags - 2) * 0.5;
    let tipY = up ? nearY - (ENGRAVING.stemLength + extraFlags) * shape.scale : nearY + (ENGRAVING.stemLength + extraFlags) * shape.scale;
    // Notes far outside the staff still reach the middle line.
    const homeStaff = shape.heads.find(head => head.staff === event.staff) ? event.staff : shape.heads[0].staff;
    const middle = staffTop(context, homeStaff) + stepY(MIDDLE_LINE);
    if (!event.grace && !shape.beamed) tipY = up ? Math.min(tipY, middle) : Math.max(tipY, middle);
    stem = { direction: shape.stem, x: x + shape.stemX, baseY, tipY };
  }
  const drawn: DrawnEvent = {
    eventId: event.id, staff: event.staff, voice: event.voice, measure: event.measure, x, heads, noteBoxes, stem,
    scale: shape.scale, items
  };
  if (stem && !shape.beamed) drawStem(context, event, shape, drawn);
  return drawn;
}

/** Draws the stem (and flag, for an unbeamed note) once its tip is final. */
export function drawStem(context: SystemContext, event: ChordEvent, shape: ChordShape, drawn: DrawnEvent): void {
  const stem = drawn.stem;
  if (!stem) return;
  const { builder } = context;
  const semantic = semanticOf(event);
  const thickness = ENGRAVING.stemThickness * shape.scale;
  stem.item = builder.line(stem.x, stem.baseY, stem.x, stem.tipY, thickness, { element: 'note.stem', refs: [event.id], semantic });
  drawn.items.push(stem.item);
  if (shape.beamed || !shape.flags) {
    if (event.grace?.kind === 'acciaccatura' && !shape.beamed) drawSlash(context, event, shape, drawn);
    return;
  }
  const up = stem.direction === 'up';
  const name = `flag${FLAG_NAMES[Math.min(shape.flags, 5)]}${up ? 'Up' : 'Down'}`;
  drawn.items.push(builder.glyph(name, stem.x - thickness / 2, stem.tipY, { element: 'note.flag', refs: [event.id], semantic }, { scale: shape.scale }));
  if (event.grace?.kind === 'acciaccatura') drawSlash(context, event, shape, drawn);
}

/** The acciaccatura slash across the stem (and flag or first beam). */
export function drawSlash(context: SystemContext, event: ChordEvent, shape: ChordShape, drawn: DrawnEvent): void {
  const stem = drawn.stem;
  if (!stem) return;
  const up = stem.direction === 'up';
  const name = up ? 'graceNoteSlashStemUp' : 'graceNoteSlashStemDown';
  const box = glyph(name).box;
  const width = (box.x1 - box.x0) * shape.scale, height = (box.y1 - box.y0) * shape.scale;
  const y = up ? stem.tipY + 1.6 * shape.scale + height / 2 : stem.tipY - 1.6 * shape.scale - height / 2;
  drawn.items.push(context.builder.glyph(name, stem.x - width / 2, y, { element: 'grace.acciaccatura', refs: [event.id], semantic: semanticOf(event) },
    { scale: shape.scale }));
}
