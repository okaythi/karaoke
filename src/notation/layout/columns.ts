/**
 * Horizontal layout of a measure, docs §8.1. Events that start together in
 * any staff share a column, so simultaneous notes line up. Each gap between
 * columns is a spring: its ideal length grows with the logarithm of the time
 * it spans, and it never shrinks below the ink of its neighbours. Justifying
 * a line stretches every spring by one factor.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { glyph } from '../fonts/glyphs';
import type { ClefChange, ScoreEvent } from '../model/types';
import { clefInfo } from '../rules/staffPosition';
import { SIZE_SCALE } from './settings';
import type { PreparedScore } from './shapes';

export interface Column {
  readonly measure: number;
  readonly offset: Fraction;
  /** Order among columns at one offset: before-graces < main < after-graces. */
  readonly rank: number;
  readonly events: readonly ScoreEvent[];
  /** Clef changes drawn just before this column. */
  readonly clefs: readonly ClefChange[];
  readonly grace: boolean;
  /** Ink left and right of the anchor. */
  readonly left: number;
  readonly right: number;
  /** Time to the next main column (zero for grace columns). */
  readonly duration: Fraction;
}

export interface Spring {
  /** Shortest the gap may be. */
  readonly min: number;
  /** Length at a stretch of 1. */
  readonly ideal: number;
}

export interface MeasureSpacing {
  readonly measure: number;
  readonly columns: readonly Column[];
  /** Fixed distance from the measure's start to the first anchor (after any prefix). */
  readonly lead: number;
  /** springs[i] separates column i from column i + 1; the last one runs to the barline. */
  readonly springs: readonly Spring[];
  /** Clef changes drawn before this measure's closing barline (they take effect in the next one). */
  readonly suffixClefs: readonly ClefChange[];
  readonly suffixWidth: number;
}

const rankOf = (event: ScoreEvent): number => {
  if (event.kind !== 'chord' || !event.grace) return 0;
  return event.grace.placement === 'before' ? -100 + (event.graceOrder ?? 0) : 100 + (event.graceOrder ?? 0);
};

export function clefWidth(clef: ClefChange['clef'], scale: number): number {
  return glyph(clefInfo(clef).glyph).advance * scale;
}

/** The shortest gap between main columns anywhere in the score; spacing is relative to it. */
export function shortestDuration(measures: readonly (readonly Column[])[]): Fraction {
  let shortest = F.frac(1, 4);
  for (const columns of measures)
    for (const column of columns)
      if (!column.grace && F.gt(column.duration, F.ZERO)) shortest = F.min(shortest, column.duration);
  return F.max(shortest, F.frac(1, 32));
}

export function measureColumns(prepared: PreparedScore, measure: number): Column[] {
  const { index, shapes } = prepared;
  const groups = new Map<string, { offset: Fraction; rank: number; events: ScoreEvent[] }>();
  for (const event of index.eventsIn(measure)) {
    const rank = rankOf(event);
    const key = `${F.key(event.offset)}|${rank}`;
    const group = groups.get(key) ?? groups.set(key, { offset: event.offset, rank, events: [] }).get(key)!;
    group.events.push(event);
  }
  const ordered = [...groups.values()].sort((a, b) => F.compare(a.offset, b.offset) || a.rank - b.rank);
  const mainOffsets = [...new Set(ordered.filter(group => group.rank === 0).map(group => F.key(group.offset)))]
    .map(F.parse).sort(F.byValue);
  const length = index.measureLength(measure);
  // A clef change within the measure is drawn before the first column at or after it.
  const clefsAt = new Map<number, ClefChange[]>();
  for (const change of index.score.clefs) {
    if (change.measure !== measure || F.isZero(change.offset)) continue;
    const target = ordered.findIndex(group => F.ge(group.offset, change.offset));
    if (target >= 0) (clefsAt.get(target) ?? clefsAt.set(target, []).get(target)!).push(change);
  }

  return ordered.map((group, position) => {
    let left = 0, right = 0;
    for (const event of group.events) {
      const shape = shapes.get(event.id);
      if (!shape) continue;
      left = Math.min(left, shape.left + shape.shift);
      right = Math.max(right, shape.right + shape.shift);
    }
    // Arpeggios stand left of the chord's accidentals.
    for (const event of group.events) {
      const arpeggio = index.attachmentsOn(event.id).some(item => item.kind.startsWith('arp.')) ||
        index.score.spanners.some(item => item.kind === 'arp.cross-staff' && 'event' in item.start && (item.start.event === event.id || ('event' in item.end && item.end.event === event.id)));
      if (arpeggio) left = Math.min(left, (shapes.get(event.id)?.left ?? 0) - 1.1);
    }
    const columnClefs = clefsAt.get(position) ?? [];
    if (columnClefs.length)
      left -= Math.max(...columnClefs.map(change => clefWidth(change.clef, SIZE_SCALE.change))) + 0.6;
    const next = mainOffsets.find(offset => F.gt(offset, group.offset)) ?? length;
    return {
      measure, offset: group.offset, rank: group.rank, events: group.events, clefs: columnClefs,
      grace: group.rank !== 0, left: -left, right,
      duration: group.rank === 0 ? F.sub(next, group.offset) : F.ZERO
    };
  });
}

export function measureSpacing(prepared: PreparedScore, measure: number, columns: readonly Column[], shortest: Fraction): MeasureSpacing {
  const { spacing } = prepared.settings;
  const ideal = (duration: Fraction) =>
    spacing.shortestSpace * (1 + spacing.doublingIncrement * Math.log2(Math.max(1, F.toNumber(F.div(duration, shortest)))));
  const springs: Spring[] = columns.map((column, position) => {
    const next = columns[position + 1];
    if (!next) {
      const min = column.right + spacing.beforeBarline;
      return { min, ideal: Math.max(min, column.grace ? min : ideal(column.duration)) };
    }
    const min = column.right + next.left + (column.grace || next.grace ? spacing.graceGap : spacing.minimumGap);
    return { min, ideal: column.grace ? min : Math.max(min, ideal(column.duration)) };
  });
  const suffixClefs = prepared.index.score.clefs.filter(change => change.measure === measure + 1 && F.isZero(change.offset));
  const suffixWidth = suffixClefs.length ? Math.max(...suffixClefs.map(change => clefWidth(change.clef, SIZE_SCALE.change))) + 0.8 : 0;
  return {
    measure, columns, springs, suffixClefs, suffixWidth,
    lead: spacing.afterBarline + (columns[0]?.left ?? 0)
  };
}

/** Anchor positions from the measure's content start at a stretch factor, and the content width. */
export function anchorPositions(spacing: MeasureSpacing, stretch: number): { x: number[]; width: number } {
  const x: number[] = [];
  let at = spacing.lead;
  for (const spring of spacing.springs) {
    x.push(at);
    at += Math.max(spring.min, spring.ideal * stretch);
  }
  return { x, width: at + spacing.suffixWidth };
}
