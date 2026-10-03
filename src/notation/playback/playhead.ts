/** A line's playback path follows shared rhythmic columns, not individual attacks. */
import * as F from '../core/fraction';
import type { EngravedSystem } from '../layout/system';
import type { ScoreIndex } from '../model/query';
import type { TimingMap } from './timing';

export interface PlayheadAnchor { readonly time: number; readonly x: number }

export function playheadAnchors(system: EngravedSystem, index: ScoreIndex, timing: TimingMap): readonly PlayheadAnchor[] {
  const anchors = system.timeline.filter(column => !column.grace).map(column => ({
    time: timing.timeAt(F.toNumber(index.absolute(column.measure, column.offset))),
    x: column.x
  }));
  anchors.push({
    time: timing.timeAt(F.toNumber(index.measureStarts[system.last + 1])),
    x: system.measures.at(-1)!.end
  });
  return anchors;
}

/** Stateless interpolation also permits an intentional backward seek. */
export function playheadX(points: readonly PlayheadAnchor[], time: number): number {
  if (!points.length) return 0;
  if (time <= points[0].time) return points[0].x;
  let low = 1, high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].time < time) low = middle + 1; else high = middle;
  }
  if (low === points.length) return points.at(-1)!.x;
  const before = points[low - 1], after = points[low];
  const span = after.time - before.time;
  return span > 0 ? before.x + (after.x - before.x) * (time - before.time) / span : after.x;
}
