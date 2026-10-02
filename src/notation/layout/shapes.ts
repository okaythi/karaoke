/**
 * First layout stage: the shape of every chord and rest, independent of
 * where it ends up horizontally. Positions are relative to the event's
 * column anchor (the left edge of its normal-side noteheads) and to staff
 * steps; the system stage turns them into absolute coordinates.
 */
import * as F from '../core/fraction';
import { pitch as makePitch } from '../core/pitch';
import type { Pitch } from '../core/pitch';
import { entry } from '../catalogue/registry';
import type { SpannerEntry } from '../catalogue/types';
import { glyph } from '../fonts/glyphs';
import type { ScoreIndex } from '../model/query';
import { flagCount } from '../model/time';
import type { ChordEvent, RestEvent, ScoreEvent, StaffId } from '../model/types';
import { accidentalGlyph, resolveAccidentals } from '../rules/accidentals';
import type { ShownAccidental } from '../rules/accidentals';
import { beamGroups, graceBeamGroups } from '../rules/beaming';
import type { BeamGroup } from '../rules/beaming';
import { MIDDLE_LINE, isOnLine, stepOf, stepY } from '../rules/staffPosition';
import { stemDirection } from '../rules/stems';
import type { StemDirection } from '../rules/stems';
import { ENGRAVING, SIZE_SCALE } from './settings';
import type { LayoutSettings } from './settings';

export interface HeadShape {
  readonly noteId: string;
  readonly staff: StaffId;
  readonly step: number;
  /** Left edge of the notehead relative to the column anchor. */
  readonly dx: number;
  readonly glyph: string;
  readonly width: number;
  readonly displaced: boolean;
}

export interface AccidentalShape {
  readonly noteId: string;
  readonly staff: StaffId;
  readonly step: number;
  readonly glyph: string;
  /** Left edge of the accidental (or its opening parenthesis). */
  readonly dx: number;
  readonly courtesy: boolean;
  readonly width: number;
}

export interface DotShape {
  readonly staff: StaffId;
  readonly step: number;
  readonly dx: number;
}

export interface ChordShape {
  readonly kind: 'chord';
  readonly event: ChordEvent;
  readonly scale: number;
  readonly stem?: StemDirection;
  /** Stem centre relative to the column anchor. */
  readonly stemX: number;
  readonly heads: readonly HeadShape[];
  readonly accidentals: readonly AccidentalShape[];
  readonly dots: readonly DotShape[];
  readonly dotCount: number;
  readonly flags: number;
  readonly beamed: boolean;
  /** Ink extent left and right of the anchor. */
  left: number;
  right: number;
  /** Shift applied when voices on one staff would collide. */
  shift: number;
}

export interface RestShape {
  readonly kind: 'rest';
  readonly event: RestEvent;
  readonly scale: number;
  readonly glyph: string;
  /** Step of the glyph origin. */
  step: number;
  readonly width: number;
  readonly dotCount: number;
  left: number;
  right: number;
  shift: number;
}

export type EventShape = ChordShape | RestShape;

export interface BeamPlan extends BeamGroup {
  readonly stem: StemDirection;
  readonly grace: boolean;
}

export interface PreparedScore {
  readonly index: ScoreIndex;
  readonly settings: LayoutSettings;
  readonly accidentals: ReadonlyMap<string, ShownAccidental>;
  readonly shapes: ReadonlyMap<string, EventShape>;
  readonly beams: readonly BeamPlan[];
  readonly beamOf: ReadonlyMap<string, BeamPlan>;
  /** Octaves the written note sits from the sounding one, per event. */
  writtenShift(eventId: string): number;
  writtenPitch(noteId: string): Pitch;
  drawnStaff(event: ChordEvent, noteId: string): StaffId;
  /** Staff step of a note as drawn. */
  noteStep(noteId: string): number;
}

const HEAD_GLYPHS: Record<string, string> = { breve: 'noteheadDoubleWhole', whole: 'noteheadWhole', half: 'noteheadHalf' };
const REST_GLYPHS: Record<string, string> = {
  breve: 'restDoubleWhole', whole: 'restWhole', half: 'restHalf', quarter: 'restQuarter', eighth: 'rest8th',
  '16th': 'rest16th', '32nd': 'rest32nd', '64th': 'rest64th', '128th': 'rest128th'
};

export function eventScale(event: ScoreEvent): number {
  if (event.kind === 'chord' && event.grace) return SIZE_SCALE.grace;
  if (event.kind === 'chord' && event.cue) return SIZE_SCALE.cue;
  return SIZE_SCALE.full;
}

export function prepare(index: ScoreIndex, settings: LayoutSettings): PreparedScore {
  const shifts = ottavaShifts(index);
  const writtenShift = (eventId: string) => shifts.get(eventId) ?? 0;
  const writtenPitch = (noteId: string): Pitch => {
    const { note, event } = index.note(noteId);
    const shift = writtenShift(event.id);
    return shift ? makePitch(note.pitch.step, note.pitch.alter, note.pitch.octave + shift) : note.pitch;
  };
  const drawnStaff = (event: ChordEvent, noteId: string): StaffId =>
    event.notes.find(note => note.id === noteId)?.staff ?? event.staff;
  const noteStep = (noteId: string): number => {
    const { event } = index.note(noteId);
    const staff = drawnStaff(event, noteId);
    return stepOf(writtenPitch(noteId), index.clefAt(staff, event.measure, event.offset));
  };
  const accidentals = resolveAccidentals(index, writtenPitch, drawnStaff, { courtesy: settings.courtesyAccidentals });

  // Height of a note above its own staff's middle line, for stem decisions.
  // Notes on another staff count as far beyond the staff in that direction.
  const height = (event: ChordEvent, noteId: string): number => {
    const staff = drawnStaff(event, noteId);
    const step = noteStep(noteId) - MIDDLE_LINE;
    if (staff === event.staff) return step;
    return index.staffIndex(staff) > index.staffIndex(event.staff) ? step - 20 : step + 20;
  };
  const multiVoice = (event: ScoreEvent) => index.drawnVoices(event.measure, event.staff).length > 1;

  const beams: BeamPlan[] = [];
  const beamOf = new Map<string, BeamPlan>();
  for (let measure = 0; measure < index.measureCount; measure++) {
    for (const staff of index.score.staves) {
      for (const voice of index.voicesIn(measure, staff.id)) {
        const plain = beamGroups(index, measure, staff.id, voice, { beamOverRests: settings.beamOverRests });
        const graces = graceBeamGroups(index, measure, staff.id, voice);
        for (const [group, grace] of [...plain.map(item => [item, false] as const), ...graces.map(item => [item, true] as const)]) {
          const first = group.events[0];
          const explicit = group.events.find(event => event.stem)?.stem;
          const stem = explicit ?? (grace && !multiVoice(first) ? 'up' : stemDirection(
            group.events.flatMap(event => event.notes.map(note => height(event, note.id))),
            { multiVoice: multiVoice(first), voice, balanced: settings.balancedStem }));
          const plan = { ...group, stem, grace };
          beams.push(plan);
          for (const event of group.events) beamOf.set(event.id, plan);
        }
      }
    }
  }

  const shapes = new Map<string, EventShape>();
  for (const event of index.score.events) {
    if (event.kind === 'chord') {
      const plan = beamOf.get(event.id);
      const stemless = event.value.base === 'whole' || event.value.base === 'breve';
      const stem: StemDirection | undefined = stemless ? undefined : event.stem ?? plan?.stem ??
        (event.grace && !multiVoice(event) ? 'up' : stemDirection(event.notes.map(note => height(event, note.id)),
          { multiVoice: multiVoice(event), voice: event.voice, balanced: settings.balancedStem }));
      shapes.set(event.id, chordShape(event, stem, !!plan, noteStep, drawnStaff, accidentals, multiVoice(event)));
    } else if (event.kind === 'rest') {
      shapes.set(event.id, restShape(event));
    }
  }
  separateVoices(index, shapes);
  return { index, settings, accidentals, shapes, beams, beamOf, writtenShift, writtenPitch, drawnStaff, noteStep };
}

/** Octave shifts from ottava spanners, by event. */
function ottavaShifts(index: ScoreIndex): Map<string, number> {
  const shifts = new Map<string, number>();
  for (const spanner of index.score.spanners) {
    const known = entry(spanner.kind) as SpannerEntry;
    if (!known.writtenOctaves || !('event' in spanner.start) || !('event' in spanner.end)) continue;
    const start = index.event(spanner.start.event), end = index.event(spanner.end.event);
    const from = index.absolute(start.measure, start.offset), to = index.absolute(end.measure, end.offset);
    for (const event of index.score.events) {
      if (event.staff !== start.staff) continue;
      const at = index.absolute(event.measure, event.offset);
      if (F.ge(at, from) && F.le(at, to)) shifts.set(event.id, known.writtenOctaves);
    }
  }
  return shifts;
}

function chordShape(
  event: ChordEvent, stem: StemDirection | undefined, beamed: boolean, noteStep: (id: string) => number,
  drawnStaff: (event: ChordEvent, id: string) => StaffId, accidentals: ReadonlyMap<string, ShownAccidental>, multiVoice: boolean
): ChordShape {
  const scale = eventScale(event);
  const headGlyph = HEAD_GLYPHS[event.value.base] ?? 'noteheadBlack';
  const width = glyph(headGlyph).advance * scale;
  const stemThickness = ENGRAVING.stemThickness * scale;
  const heads: HeadShape[] = [];

  // Seconds: neighbouring notes go on opposite sides of the stem, per staff.
  const byStaff = new Map<StaffId, { id: string; step: number }[]>();
  for (const note of event.notes) {
    const staff = drawnStaff(event, note.id);
    (byStaff.get(staff) ?? byStaff.set(staff, []).get(staff)!).push({ id: note.id, step: noteStep(note.id) });
  }
  const up = stem !== 'down';
  for (const [staff, notes] of byStaff) {
    const ordered = [...notes].sort((a, b) => (up ? a.step - b.step : b.step - a.step));
    let previous: { step: number; displaced: boolean } | undefined;
    for (const note of ordered) {
      const displaced = !!previous && !previous.displaced && Math.abs(note.step - previous.step) <= 1;
      const offset = displaced ? (up ? width - stemThickness : -(width - stemThickness)) : 0;
      heads.push({ noteId: note.id, staff, step: note.step, dx: offset, glyph: headGlyph, width, displaced });
      previous = { step: note.step, displaced };
    }
  }
  const headsLeft = Math.min(...heads.map(head => head.dx));
  const headsRight = Math.max(...heads.map(head => head.dx + head.width));
  const stemX = stem === 'down' ? stemThickness / 2 : width - stemThickness / 2;

  // Accidentals in columns, nearest first, in zig-zag order from the outside in.
  const shown = heads.filter(head => accidentals.has(head.noteId)).sort((a, b) => b.step - a.step);
  const zigzag: HeadShape[] = [];
  for (let low = 0, high = shown.length - 1; low <= high;) {
    zigzag.push(shown[low++]);
    if (low <= high) zigzag.push(shown[high--]);
  }
  const columns: { right: number; items: { top: number; bottom: number; staff: StaffId }[]; width: number; members: AccidentalShape[] }[] = [];
  const placed: AccidentalShape[] = [];
  for (const head of zigzag) {
    const { alter, courtesy } = accidentals.get(head.noteId)!;
    const name = accidentalGlyph(alter);
    const shape = glyph(name);
    const parens = courtesy ? glyph('accidentalParensLeft').advance * 2 * scale : 0;
    const accidentalWidth = shape.advance * scale + parens;
    const centre = stepY(head.step);
    const top = centre + shape.box.y0 * scale, bottom = centre + shape.box.y1 * scale;
    // Heads on the left of the stem push all accidentals further left.
    const clash = (column: (typeof columns)[number]) =>
      column.items.some(item => item.staff === head.staff && top < item.bottom - 0.1 && item.top < bottom - 0.1);
    let column = columns.find(candidate => !clash(candidate));
    if (!column) {
      const right = columns.length ? columns.at(-1)!.right - columns.at(-1)!.width - ENGRAVING.accidentalColumnGap * scale
        : headsLeft - ENGRAVING.accidentalGap * scale;
      column = { right, items: [], width: 0, members: [] };
      columns.push(column);
    }
    column.items.push({ top, bottom, staff: head.staff });
    column.width = Math.max(column.width, accidentalWidth);
    const accidental = { noteId: head.noteId, staff: head.staff, step: head.step, glyph: name, dx: 0, courtesy, width: accidentalWidth };
    column.members.push(accidental);
    placed.push(accidental);
  }
  // Columns widen as members join; settle positions right to left afterwards.
  let right = headsLeft - ENGRAVING.accidentalGap * scale;
  const accidentalShapes: AccidentalShape[] = [];
  for (const column of columns) {
    for (const member of column.members) accidentalShapes.push({ ...member, dx: right - member.width });
    right -= column.width + ENGRAVING.accidentalColumnGap * scale;
  }

  // Dots sit in spaces; a note on a line moves to the space on its voice's side.
  const dots: DotShape[] = [];
  const dotCount = event.value.dots;
  if (dotCount) {
    const dotX = headsRight + ENGRAVING.dotGap * scale;
    const towardBelow = multiVoice && event.voice % 2 === 0;
    const taken = new Set<string>();
    for (const head of [...heads].sort((a, b) => (towardBelow ? a.step - b.step : b.step - a.step))) {
      let step = isOnLine(head.step) ? head.step + (towardBelow ? -1 : 1) : head.step;
      while (taken.has(`${head.staff}:${step}`)) step += towardBelow ? 2 : -2;
      taken.add(`${head.staff}:${step}`);
      dots.push({ staff: head.staff, step, dx: dotX });
    }
  }
  const flags = flagCount(event.value.base);
  const flagWidth = stem && flags && !beamed ? glyph(up ? 'flag8thUp' : 'flag8thDown').box.x1 * scale : 0;
  const dotsRight = dotCount ? headsRight + ENGRAVING.dotGap * scale + (dotCount - 1) * ENGRAVING.dotSpacing * scale + glyph('augmentationDot').advance * scale : headsRight;
  return {
    kind: 'chord', event, scale, stem, stemX, heads, accidentals: accidentalShapes, dots, dotCount, flags, beamed,
    left: Math.min(headsLeft, ...accidentalShapes.map(item => item.dx)),
    right: Math.max(dotsRight, stem === 'up' ? stemX + flagWidth : flagWidth),
    shift: 0
  };
}

function restShape(event: RestEvent): RestShape {
  const scale = eventScale(event);
  const name = event.fullBar ? 'restWhole' : REST_GLYPHS[event.value.base];
  const shape = glyph(name);
  // Whole rests hang from the fourth line; every other rest centres on the middle line.
  const step = name === 'restWhole' || name === 'restDoubleWhole' ? 6 : 4;
  const dotCount = event.fullBar ? 0 : event.value.dots;
  const width = shape.advance * scale;
  const dotsRight = dotCount ? width + ENGRAVING.dotGap + (dotCount - 1) * ENGRAVING.dotSpacing + glyph('augmentationDot').advance : width;
  return { kind: 'rest', event, scale, glyph: name, step, width, dotCount, left: 0, right: dotsRight, shift: 0 };
}

/**
 * Voices on one staff at one moment: rests move away from the other voices'
 * notes, and a down-stem chord that would touch an up-stem chord moves right.
 */
function separateVoices(index: ScoreIndex, shapes: Map<string, EventShape>): void {
  for (let measure = 0; measure < index.measureCount; measure++) {
    for (const staff of index.score.staves) {
      const events = index.eventsIn(measure, staff.id).filter(event => event.kind !== 'space' && !(event.kind === 'chord' && event.grace));
      if (new Set(events.map(event => event.voice)).size < 2) continue;
      for (const event of events) {
        const shape = shapes.get(event.id);
        if (!shape) continue;
        const start = event.offset, end = index.end(event);
        const others = events.filter(other => other.voice !== event.voice &&
          F.lt(other.offset, end) && F.lt(start, index.end(other)));
        const otherSteps = others.flatMap(other => {
          const otherShape = shapes.get(other.id);
          return otherShape?.kind === 'chord' ? otherShape.heads.filter(head => head.staff === staff.id).map(head => head.step) : [];
        });
        if (shape.kind === 'rest') {
          const upper = event.voice % 2 === 1;
          if (!otherSteps.length) { shape.step += upper ? 2 : -2; continue; }
          const box = glyph(shape.glyph).box;
          // Rest extent in steps around its origin.
          const top = shape.step - box.y0 * 2, bottom = shape.step - box.y1 * 2;
          if (upper) {
            const highest = Math.max(...otherSteps);
            const lift = Math.max(0, highest + 2 - bottom);
            shape.step += Math.ceil(lift / 2) * 2;
          } else {
            const lowest = Math.min(...otherSteps);
            const drop = Math.max(0, top - (lowest - 2));
            shape.step -= Math.ceil(drop / 2) * 2;
          }
          continue;
        }
        if (shape.stem !== 'down') continue;
        // Unisons and seconds against an up-stem chord at the same moment shift this chord right.
        const partners = events.filter(other => other.voice !== event.voice && F.eq(other.offset, event.offset));
        for (const partner of partners) {
          const partnerShape = shapes.get(partner.id);
          if (partnerShape?.kind !== 'chord' || partnerShape.stem === 'down') continue;
          const close = shape.heads.some(head => partnerShape.heads.some(other =>
            other.staff === head.staff && Math.abs(other.step - head.step) <= 1 &&
            !(other.step === head.step && other.glyph === head.glyph && shape.heads.length === 1 && partnerShape.heads.length === 1 && shape.dotCount === partnerShape.dotCount)));
          if (close) shape.shift = Math.max(shape.shift, Math.max(...partnerShape.heads.map(head => head.dx + head.width)) - Math.min(...shape.heads.map(head => head.dx)) + 0.05);
        }
      }
    }
  }
}
