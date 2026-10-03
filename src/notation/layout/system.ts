/**
 * Lays out one line of music (a system): staves, the line's prefix, measures
 * and barlines, every event, then beams, ties and marks. When marks between
 * two staves do not fit, the gap grows and the line is laid out again.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { glyph } from '../fonts/glyphs';
import type { Box } from '../fonts/glyphs';
import type { StaffId } from '../model/types';
import { drawBeams, drawTremoloBetween } from './beams';
import { barlineWidth, endBarline, keyChange, midPrefixWidth, timeChange } from './breaking';
import type { LinePlan } from './breaking';
import { DisplayBuilder } from './builder';
import { anchorPositions } from './columns';
import type { MeasureSpacing } from './columns';
import type { MeasurePlacement, SystemContext } from './context';
import { drawTies } from './curves';
import type { DisplayItem, Semantic } from './display';
import { union } from './display';
import { placeMarks } from './marks';
import { drawChord, drawRest } from './notes';
import { ENGRAVING, SIZE_SCALE } from './settings';
import { drawClef, drawKey, drawTime, keyWidth, timeWidth, clefAdvance } from './signatures';
import type { ChordShape, PreparedScore, RestShape } from './shapes';

export interface EngravedSystem {
  readonly number: number;
  readonly first: number;
  readonly last: number;
  readonly items: readonly DisplayItem[];
  /** Ink bounds of the whole line. */
  readonly box: Box;
  /** Width of the staff lines. */
  readonly width: number;
  readonly staffTops: ReadonlyMap<StaffId, number>;
  readonly timeline: readonly { measure: number; offset: Fraction; x: number; grace: boolean }[];
  readonly measures: readonly { measure: number; start: number; end: number }[];
}

const REPEAT_DOT_GAP = 0.4;

export function engraveSystem(prepared: PreparedScore, spacings: readonly MeasureSpacing[], plan: LinePlan, number: number): EngravedSystem {
  const gaps = new Map<StaffId, number>();
  let result = build(prepared, spacings, plan, number, gaps);
  for (let attempt = 0; attempt < 3 && result.shortfall.size; attempt++) {
    for (const [staff, needed] of result.shortfall) {
      const current = gaps.get(staff) ?? prepared.settings.staffGap;
      // Collision clearance takes priority over the preferred maximum gap.
      // Capping this leaves expressions inside the neighbouring staff.
      gaps.set(staff, current + needed + 0.5);
    }
    result = build(prepared, spacings, plan, number, gaps);
  }
  return result.system;
}

function build(prepared: PreparedScore, spacings: readonly MeasureSpacing[], plan: LinePlan, number: number,
  gaps: ReadonlyMap<StaffId, number>): { system: EngravedSystem; shortfall: Map<StaffId, number> } {
  const { index, settings } = prepared;
  const builder = new DisplayBuilder();
  const staves = index.score.staves.map(staff => staff.id);

  // Staves from the top: a group keeps its staves close, groups sit further apart.
  const staffTops = new Map<StaffId, number>();
  let y = 0;
  staves.forEach((staff, position) => {
    if (position > 0) {
      const previous = staves[position - 1];
      const together = index.groupOf(previous) && index.groupOf(previous) === index.groupOf(staff);
      y += 4 + (together ? gaps.get(previous) ?? settings.staffGap : settings.groupGap);
    }
    staffTops.set(staff, y);
  });
  const bottomOf = (staff: StaffId) => staffTops.get(staff)! + 4;
  const groupsForBarlines = barlineGroups(prepared);

  const context: SystemContext = {
    prepared, plan, builder, staffTops, measures: new Map(), drawn: new Map(),
    contentStart: plan.prefix, contentEnd: 0, width: 0, timeline: []
  };
  const measures = context.measures as Map<number, MeasurePlacement>;

  // Line prefix: clef, key and time on every staff.
  const indent = plan.first === 0 ? settings.firstIndent : 0;
  let x = indent + 1;
  const clefWidth = Math.max(...staves.map(staff => clefAdvance(index.clefAt(staff, plan.first, F.ZERO))));
  for (const staff of staves) {
    const clef = index.clefAt(staff, plan.first, F.ZERO);
    drawClef(builder, clef, x, staffTops.get(staff)!, 1, `clef.${clef}`, { staff, measure: plan.first });
  }
  x += clefWidth + 0.8;
  const key = index.keyAt(plan.first);
  if (key.fifths) {
    for (const staff of staves)
      drawKey(builder, key, undefined, index.clefAt(staff, plan.first, F.ZERO), x, staffTops.get(staff)!, settings.keyCancellation, 'key.signature', { staff, measure: plan.first });
    x += keyWidth(key, undefined, settings.keyCancellation) + 0.8;
  }
  if (plan.showTime) {
    const time = index.timeAt(plan.first);
    for (const staff of staves) drawTime(builder, time, x, staffTops.get(staff)!, 'time.numeric', { staff, measure: plan.first });
    x += timeWidth(time) + 0.6;
  }
  if (index.score.measures[plan.first].repeatStart) {
    drawRepeatStart(builder, groupsForBarlines, staffTops, x);
  }

  // Bar number at the start of every line but the first.
  if (plan.first > 0 && index.score.measures[plan.first].number > 0)
    builder.text(String(index.score.measures[plan.first].number), indent + 0.2, staffTops.get(staves[0])! - 1.4, 'Academico', 1.4,
      { element: 'staff.bar-number', semantic: { staff: staves[0], measure: plan.first } });

  // Measures.
  let barlineX = plan.prefix - settings.spacing.afterBarline;
  let start = plan.prefix;
  for (let measure = plan.first; measure <= plan.last; measure++) {
    const spacing = spacings[measure];
    if (measure > plan.first) {
      const previousEnd = barlineX + barlineWidth(prepared, measure - 1);
      start = previousEnd + midPrefixWidth(prepared, measure);
      drawMidPrefix(builder, prepared, staffTops, measure, previousEnd + 0.6);
    }
    const positions = anchorPositions(spacing, plan.stretch);
    const end = start + positions.width;
    const columnX = positions.x.map(value => start + value);
    measures.set(measure, { measure, start, end, startBarline: measure === plan.first ? plan.prefix - settings.spacing.afterBarline : barlineX, spacing, columnX });
    spacing.columns.forEach((column, position) => {
      context.timeline.push({ measure, offset: column.offset, x: columnX[position], grace: column.grace });
    });
    for (const change of spacing.suffixClefs)
      drawClef(builder, change.clef, end - spacing.suffixWidth + 0.3, staffTops.get(change.staff)!, SIZE_SCALE.change, `clef.${change.clef}`, { staff: change.staff, measure });
    barlineX = end;
    drawBarline(builder, prepared, groupsForBarlines, staffTops, measure, end, measure < plan.last);
  }
  const lastBarline = barlineX + barlineWidth(prepared, plan.last);
  (context as { contentEnd: number }).contentEnd = barlineX;

  // Courtesy signatures after the last barline.
  let width = lastBarline;
  if (plan.courtesyKey || plan.courtesyTime) {
    let at = lastBarline + 0.8;
    if (plan.courtesyKey) {
      for (const staff of staves)
        drawKey(builder, plan.courtesyKey.key, plan.courtesyKey.previous, index.clefAt(staff, plan.last + 1, F.ZERO), at, staffTops.get(staff)!,
          settings.keyCancellation, 'key.courtesy', { staff, measure: plan.last });
      at += keyWidth(plan.courtesyKey.key, plan.courtesyKey.previous, settings.keyCancellation) + 0.5;
    }
    if (plan.courtesyTime) {
      for (const staff of staves) drawTime(builder, plan.courtesyTime, at, staffTops.get(staff)!, 'time.courtesy', { staff, measure: plan.last });
      at += timeWidth(plan.courtesyTime) + 0.5;
    }
    width = at;
  }
  context.width = width;

  // Staff lines, system line, braces and brackets.
  for (const staff of staves) {
    for (let line = 0; line < 5; line++) {
      const lineY = staffTops.get(staff)! + line;
      builder.line(0, lineY, width, lineY, ENGRAVING.staffLineThickness, { element: 'staff.lines', semantic: { staff } });
    }
  }
  if (staves.length > 1)
    builder.line(0, staffTops.get(staves[0])!, 0, bottomOf(staves.at(-1)!), ENGRAVING.thinBarlineThickness, { element: 'staff.system-line', semantic: {} });
  for (const group of index.score.groups) {
    const top = staffTops.get(group.staves[0])!, bottom = bottomOf(group.staves.at(-1)!);
    const height = bottom - top;
    if (group.kind === 'brace') {
      const scaleY = height / 4;
      const scaleX = Math.min(2.6, Math.max(1, scaleY * 0.55));
      const braceWidth = glyph('brace').advance * scaleX;
      builder.glyph('brace', -0.4 - braceWidth, bottom, { element: 'staff.brace', semantic: {} }, { scaleX, scaleY });
    } else {
      const bx = -0.9;
      builder.line(bx, top - 0.5, bx, bottom + 0.5, 0.5, { element: 'staff.bracket', semantic: {} });
      builder.line(bx - 0.25, top - 0.5, bx + 1.2, top - 1.1, 0.25, { element: 'staff.bracket', semantic: {} });
      builder.line(bx - 0.25, bottom + 0.5, bx + 1.2, bottom + 1.1, 0.25, { element: 'staff.bracket', semantic: {} });
    }
  }

  // Events.
  for (let measure = plan.first; measure <= plan.last; measure++) {
    const placement = measures.get(measure)!;
    placement.spacing.columns.forEach((column, position) => {
      const anchor = placement.columnX[position];
      for (const change of column.clefs)
        drawClef(builder, change.clef, anchor - column.left, staffTops.get(change.staff)!, SIZE_SCALE.change, `clef.${change.clef}`, { staff: change.staff, measure });
      for (const event of column.events) {
        const shape = prepared.shapes.get(event.id);
        if (!shape) continue;
        const drawn = shape.kind === 'rest'
          ? drawRest(context, event as RestShape['event'], shape as RestShape, anchor)
          : drawChord(context, event as ChordShape['event'], shape as ChordShape, anchor);
        context.drawn.set(event.id, drawn);
      }
    });
  }
  for (const beam of prepared.beams) {
    if (beam.events[0].measure >= plan.first && beam.events[0].measure <= plan.last) drawBeams(context, beam);
  }
  for (const spanner of index.spanners('orn.tremolo-between')) drawTremoloBetween(context, spanner);
  drawTies(context);
  const { gapShortfall } = placeMarks(context);

  const box = builder.items.map(item => item.box).reduce(union);
  return {
    system: {
      number, first: plan.first, last: plan.last, items: builder.items, box, width, staffTops,
      timeline: context.timeline,
      measures: [...measures.values()].map(({ measure, start, end }) => ({ measure, start, end }))
    },
    shortfall: gapShortfall
  };
}

/** Staves that barlines run through together: each brace group, and every other staff alone. */
function barlineGroups(prepared: PreparedScore): StaffId[][] {
  const { score } = prepared.index;
  const grouped = new Set(score.groups.filter(group => group.kind === 'brace').flatMap(group => group.staves));
  return [
    ...score.groups.filter(group => group.kind === 'brace').map(group => [...group.staves]),
    ...score.staves.filter(staff => !grouped.has(staff.id)).map(staff => [staff.id])
  ];
}

function drawBarline(builder: DisplayBuilder, prepared: PreparedScore, groups: StaffId[][], staffTops: ReadonlyMap<StaffId, number>,
  measure: number, x: number, lineContinues: boolean): void {
  const { index } = prepared;
  const kind = endBarline(prepared, measure);
  // A repeat that starts on the next line is drawn there, after the clef and key.
  const nextRepeats = lineContinues && !!index.score.measures[measure + 1]?.repeatStart;
  const thin = ENGRAVING.thinBarlineThickness, thick = ENGRAVING.thickBarlineThickness;
  for (const staves of groups) {
    const top = staffTops.get(staves[0])!, bottom = staffTops.get(staves.at(-1)!)! + 4;
    const semantic: Semantic = { measure };
    const line = (at: number, width: number, element: string) => builder.line(at + width / 2, top, at + width / 2, bottom, width, { element, semantic });
    if (kind === 'nav.repeat-end') {
      const element = nextRepeats ? 'nav.repeat-both' : 'nav.repeat-end';
      for (const staff of staves) builder.glyph('repeatDots', x - REPEAT_DOT_GAP - glyph('repeatDots').advance + 0.2, staffTops.get(staff)! + 4, { element, semantic: { staff, measure } });
      line(x, thin, element);
      line(x + thin + ENGRAVING.thinThickBarlineSeparation, thick, element);
      if (nextRepeats) {
        const after = x + thin + ENGRAVING.thinThickBarlineSeparation + thick + ENGRAVING.thinThickBarlineSeparation;
        line(after, thin, element);
        for (const staff of staves) builder.glyph('repeatDots', after + thin + REPEAT_DOT_GAP - 0.2, staffTops.get(staff)! + 4, { element, semantic: { staff, measure } });
      }
      continue;
    }
    if (nextRepeats) {
      // The barline before a repeated passage is the start-repeat sign itself.
      line(x, thick, 'nav.repeat-start');
      line(x + thick + ENGRAVING.thinThickBarlineSeparation, thin, 'nav.repeat-start');
      for (const staff of staves)
        builder.glyph('repeatDots', x + thick + ENGRAVING.thinThickBarlineSeparation + thin + REPEAT_DOT_GAP - 0.2, staffTops.get(staff)! + 4, { element: 'nav.repeat-start', semantic: { staff, measure } });
      continue;
    }
    switch (kind) {
      case 'barline.double':
        line(x, thin, kind);
        line(x + thin + ENGRAVING.barlineSeparation, thin, kind);
        break;
      case 'barline.final':
        line(x, thin, kind);
        line(x + thin + ENGRAVING.thinThickBarlineSeparation, thick, kind);
        break;
      case 'barline.dashed':
        for (const staff of staves) {
          const staffTopY = staffTops.get(staff)!;
          builder.line(x + thin / 2, staffTopY, x + thin / 2, staffTopY + 4, thin, { element: kind, semantic: { staff, measure } },
            { dash: [ENGRAVING.dashedBarlineDashLength, ENGRAVING.dashedBarlineGapLength] });
        }
        break;
      default:
        line(x, thin, 'barline.single');
    }
  }
}

/** A start-repeat sign after the line prefix. */
function drawRepeatStart(builder: DisplayBuilder, groups: StaffId[][], staffTops: ReadonlyMap<StaffId, number>, x: number): void {
  const thin = ENGRAVING.thinBarlineThickness, thick = ENGRAVING.thickBarlineThickness;
  for (const staves of groups) {
    const top = staffTops.get(staves[0])!, bottom = staffTops.get(staves.at(-1)!)! + 4;
    builder.line(x + thick / 2, top, x + thick / 2, bottom, thick, { element: 'nav.repeat-start', semantic: {} });
    const thinX = x + thick + ENGRAVING.thinThickBarlineSeparation + thin / 2;
    builder.line(thinX, top, thinX, bottom, thin, { element: 'nav.repeat-start', semantic: {} });
    for (const staff of staves)
      builder.glyph('repeatDots', thinX + REPEAT_DOT_GAP, staffTops.get(staff)! + 4, { element: 'nav.repeat-start', semantic: { staff } });
  }
}

/** Key and time changes after the barline, when a measure continues a line. */
function drawMidPrefix(builder: DisplayBuilder, prepared: PreparedScore, staffTops: ReadonlyMap<StaffId, number>, measure: number, x: number): void {
  const { index, settings } = prepared;
  const change = keyChange(prepared, measure);
  const time = timeChange(prepared, measure);
  let at = x;
  if (change) {
    for (const staff of index.score.staves)
      drawKey(builder, change.key, change.previous, index.clefAt(staff.id, measure, F.ZERO), at, staffTops.get(staff.id)!, settings.keyCancellation, 'key.change', { staff: staff.id, measure });
    at += keyWidth(change.key, change.previous, settings.keyCancellation) + 1;
  }
  if (time) for (const staff of index.score.staves) drawTime(builder, time, at, staffTops.get(staff.id)!, 'time.numeric', { staff: staff.id, measure });
}
