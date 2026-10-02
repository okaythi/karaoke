/**
 * The beat structure of a meter: how long a beat is, which beats group
 * together, and where secondary beams break. Beaming, rhythm spelling and
 * the performed beat clock all read it. Docs §5.4, §6.4.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { meterLength } from '../model/time';
import type { TimeSignature } from '../model/types';

export interface BeatStructure {
  readonly measure: Fraction;
  /** Start of every beat within the measure. */
  readonly beats: readonly Fraction[];
  readonly beatLength: Fraction;
  /** Beat groups (in whole notes) in order; they sum to the measure. */
  readonly groups: readonly Fraction[];
  /** Whether a beat divides into three (6/8, 9/8, 12/8). */
  readonly compound: boolean;
  /** Positions where eighths may join across beats (half bars in 4/4, the whole bar in 3/4). */
  readonly eighthWindows: readonly Fraction[];
}

export function isCompound(time: TimeSignature): boolean {
  return time.beatType >= 8 && time.beats % 3 === 0 && time.beats > 3;
}

export function beatStructure(time: TimeSignature): BeatStructure {
  const measure = meterLength(time);
  const unit = F.frac(1, time.beatType);
  const compound = isCompound(time);
  let groups: Fraction[];
  if (time.grouping?.length) groups = time.grouping.map(count => F.scale(unit, count));
  else if (compound) groups = Array.from({ length: time.beats / 3 }, () => F.scale(unit, 3));
  else if (time.beatType === 8 && time.beats <= 3) groups = [measure];
  else groups = Array.from({ length: time.beats }, () => unit);
  const beats: Fraction[] = [];
  let at = F.ZERO;
  for (const group of groups) { beats.push(at); at = F.add(at, group); }
  const beatLength = groups[0];

  // Eighths may beam across beats where convention allows it.
  let eighthWindows: Fraction[] = [...groups];
  if (!compound && !time.grouping) {
    if (time.beats === 4 && time.beatType === 4) eighthWindows = [F.frac(1, 2), F.frac(1, 2)];
    else if ((time.beats === 2 || time.beats === 3) && time.beatType === 4) eighthWindows = [measure];
  }
  return { measure, beats, beatLength, groups, compound, eighthWindows };
}

/** Start of the window containing `offset`, from a list of window lengths. */
export function windowAt(windows: readonly Fraction[], offset: Fraction): { start: Fraction; end: Fraction } {
  let start = F.ZERO;
  for (const length of windows) {
    const end = F.add(start, length);
    if (F.lt(offset, end)) return { start, end };
    start = end;
  }
  return { start, end: start };
}
