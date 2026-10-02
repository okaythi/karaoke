/**
 * Engraves a score into lines of music that fit a width, docs §8.
 *
 * score → shapes (stems, heads, accidentals) → columns and springs per
 * measure → line breaks → one laid-out system per line.
 */
import { ScoreIndex } from '../model/query';
import type { Score } from '../model/types';
import { planLines } from './breaking';
import { measureColumns, measureSpacing, shortestDuration } from './columns';
import { withSettings } from './settings';
import type { LayoutSettings } from './settings';
import { prepare } from './shapes';
import type { PreparedScore } from './shapes';
import { engraveSystem } from './system';
import type { EngravedSystem } from './system';

export interface EngraveOptions {
  /** Line width in staff spaces. */
  readonly width: number;
  readonly settings?: Partial<LayoutSettings>;
}

export interface Engraving {
  readonly prepared: PreparedScore;
  readonly systems: readonly EngravedSystem[];
}

export function engrave(score: Score, options: EngraveOptions): Engraving {
  const prepared = prepare(new ScoreIndex(score), withSettings(options.settings));
  const columns = Array.from({ length: prepared.index.measureCount }, (_, measure) => measureColumns(prepared, measure));
  const shortest = shortestDuration(columns);
  const spacings = columns.map((list, measure) => measureSpacing(prepared, measure, list, shortest));
  const plans = planLines(prepared, spacings, options.width);
  return { prepared, systems: plans.map((plan, number) => engraveSystem(prepared, spacings, plan, number)) };
}
