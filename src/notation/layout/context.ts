/**
 * Shared state while one system is laid out: where staves, measures and
 * columns are, and what has been drawn for each event so later stages
 * (beams, curves, marks) can attach to it.
 */
import type { Fraction } from '../core/fraction';
import type { Box } from '../fonts/glyphs';
import type { StaffId } from '../model/types';
import type { DisplayBuilder } from './builder';
import type { LinePlan } from './breaking';
import type { MeasureSpacing } from './columns';
import type { DisplayItem } from './display';
import type { PreparedScore } from './shapes';

export interface DrawnEvent {
  readonly eventId: string;
  readonly staff: StaffId;
  readonly voice: number;
  readonly measure: number;
  /** Column anchor plus the voice shift. */
  readonly x: number;
  /** Ink of the noteheads (or the rest). */
  readonly heads: Box;
  /** Head box per note. */
  readonly noteBoxes: ReadonlyMap<string, Box>;
  readonly stem?: {
    readonly direction: 'up' | 'down';
    readonly x: number;
    /** Where the stem meets the far notehead. */
    readonly baseY: number;
    /** Free end (at the beam for beamed notes). */
    tipY: number;
    item?: DisplayItem;
  };
  readonly scale: number;
  readonly items: DisplayItem[];
}

export interface MeasurePlacement {
  readonly measure: number;
  /** Where the measure's content starts (after its barline and any prefix). */
  readonly start: number;
  /** The closing barline. */
  readonly end: number;
  /** Where the barline before the measure (or the line prefix) is. */
  readonly startBarline: number;
  readonly spacing: MeasureSpacing;
  readonly columnX: readonly number[];
}

export interface SystemContext {
  readonly prepared: PreparedScore;
  readonly plan: LinePlan;
  readonly builder: DisplayBuilder;
  readonly staffTops: ReadonlyMap<StaffId, number>;
  readonly measures: ReadonlyMap<number, MeasurePlacement>;
  readonly drawn: Map<string, DrawnEvent>;
  /** First x after the line's prefix, where continued spanners begin. */
  readonly contentStart: number;
  /** x of the final barline of the line. */
  readonly contentEnd: number;
  /** Right edge of everything on the line, courtesy signatures included. */
  width: number;
  /** x of each column by measure and time, for playheads and positions between events. */
  readonly timeline: { measure: number; offset: Fraction; x: number; grace: boolean }[];
}

export function staffTop(context: SystemContext, staff: StaffId): number {
  const top = context.staffTops.get(staff);
  if (top === undefined) throw new Error(`Staff ${staff} is not on this line`);
  return top;
}

export function inSystem(context: SystemContext, measure: number): boolean {
  return measure >= context.plan.first && measure <= context.plan.last;
}
