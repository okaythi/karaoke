/**
 * Line breaking and justification, docs §8.2 (fit-width).
 *
 * Every way of filling lines with whole measures is scored by how far each
 * line's natural width falls short of the target, squared, and the cheapest
 * is chosen (the measures of a line never exceed the width unless a single
 * measure is wider on its own). Each line then stretches its springs by one
 * factor to fill the width; a last line much shorter than the width stays at
 * its natural spacing.
 */
import type { KeySignature } from '../core/pitch';
import type { TimeSignature } from '../model/types';
import { anchorPositions } from './columns';
import type { MeasureSpacing } from './columns';
import { ENGRAVING } from './settings';
import { clefAdvance, keyWidth, sameKey, sameTime, timeWidth } from './signatures';
import type { PreparedScore } from './shapes';

export interface LinePlan {
  readonly first: number;
  readonly last: number;
  readonly stretch: number;
  /** Width of the line's prefix (clefs, key, time) before the first measure. */
  readonly prefix: number;
  readonly showTime: boolean;
  /** Signatures announced at the end of the line for the next one. */
  readonly courtesyKey?: { readonly key: KeySignature; readonly previous: KeySignature };
  readonly courtesyTime?: TimeSignature;
  readonly naturalWidth: number;
}

const SYSTEM_PADDING = 1;
const REPEAT_WIDTH = ENGRAVING.thickBarlineThickness + ENGRAVING.thinThickBarlineSeparation + ENGRAVING.thinBarlineThickness + 0.4 + 0.5;

export function keyChange(prepared: PreparedScore, measure: number): { key: KeySignature; previous: KeySignature } | undefined {
  if (measure <= 0 || measure >= prepared.index.measureCount) return undefined;
  const key = prepared.index.keyAt(measure), previous = prepared.index.keyAt(measure - 1);
  return sameKey(key, previous) ? undefined : { key, previous };
}

export function timeChange(prepared: PreparedScore, measure: number): TimeSignature | undefined {
  if (measure <= 0 || measure >= prepared.index.measureCount) return undefined;
  const time = prepared.index.timeAt(measure);
  return sameTime(time, prepared.index.timeAt(measure - 1)) ? undefined : time;
}

/** The barline closing a measure: as written, or double before a key change (docs §5.1). */
export function endBarline(prepared: PreparedScore, measure: number): string {
  const written = prepared.index.score.measures[measure].end ?? 'barline.single';
  return written === 'barline.single' && keyChange(prepared, measure + 1) ? 'barline.double' : written;
}

export function barlineWidth(prepared: PreparedScore, measure: number): number {
  switch (endBarline(prepared, measure)) {
    case 'barline.double': return ENGRAVING.thinBarlineThickness * 2 + ENGRAVING.barlineSeparation;
    case 'barline.final': return ENGRAVING.thinBarlineThickness + ENGRAVING.thinThickBarlineSeparation + ENGRAVING.thickBarlineThickness;
    case 'nav.repeat-end': return REPEAT_WIDTH;
    default: return ENGRAVING.thinBarlineThickness;
  }
}

/** Clef, key and time at the start of a line beginning with `measure`. */
export function startPrefixWidth(prepared: PreparedScore, measure: number, indent: number): { width: number; showTime: boolean } {
  const { index, settings } = prepared;
  const clef = Math.max(...index.score.staves.map(staff => clefAdvance(index.clefAt(staff.id, measure, { n: 0, d: 1 }))));
  const key = index.keyAt(measure);
  const keySpace = key.fifths ? keyWidth(key, undefined, settings.keyCancellation) + 0.8 : 0;
  const showTime = measure === 0 || !!timeChange(prepared, measure);
  const timeSpace = showTime ? timeWidth(index.timeAt(measure)) + 0.6 : 0;
  const repeat = index.score.measures[measure].repeatStart ? REPEAT_WIDTH : 0;
  return { width: indent + SYSTEM_PADDING + clef + 0.8 + keySpace + timeSpace + repeat + settings.spacing.afterSignature - settings.spacing.afterBarline, showTime };
}

/** Key or time changes drawn after the barline when a measure continues a line. */
export function midPrefixWidth(prepared: PreparedScore, measure: number): number {
  const change = keyChange(prepared, measure);
  const time = timeChange(prepared, measure);
  const repeat = prepared.index.score.measures[measure].repeatStart ? REPEAT_WIDTH : 0;
  return (change ? keyWidth(change.key, change.previous, prepared.settings.keyCancellation) + 1 : 0) +
    (time ? timeWidth(time) + 1 : 0) + repeat;
}

/** Courtesy signatures at the end of a line whose next measure changes key or time. */
export function courtesyWidth(prepared: PreparedScore, lastMeasure: number): number {
  const change = keyChange(prepared, lastMeasure + 1);
  const time = timeChange(prepared, lastMeasure + 1);
  if (!change && !time) return 0;
  return 0.8 + (change ? keyWidth(change.key, change.previous, prepared.settings.keyCancellation) + 0.5 : 0) + (time ? timeWidth(time) + 0.5 : 0);
}

function lineWidth(prepared: PreparedScore, spacings: readonly MeasureSpacing[], first: number, last: number, stretch: number, indent: number): number {
  let width = startPrefixWidth(prepared, first, indent).width;
  for (let measure = first; measure <= last; measure++) {
    width += anchorPositions(spacings[measure], stretch).width + barlineWidth(prepared, measure);
    if (measure > first) width += midPrefixWidth(prepared, measure);
  }
  return width + courtesyWidth(prepared, last);
}

export function planLines(prepared: PreparedScore, spacings: readonly MeasureSpacing[], width: number): LinePlan[] {
  const count = spacings.length;
  const indentFor = (first: number) => (first === 0 ? prepared.settings.firstIndent : 0);
  const best: { cost: number; from: number }[] = [{ cost: 0, from: -1 }];
  for (let end = 1; end <= count; end++) {
    best[end] = { cost: Infinity, from: end - 1 };
    for (let start = end - 1; start >= 0; start--) {
      const natural = lineWidth(prepared, spacings, start, end - 1, 1, indentFor(start));
      // A line may tighten to take another measure, down to the compression limit.
      const tightest = natural > width ? lineWidth(prepared, spacings, start, end - 1, prepared.settings.spacing.compression, indentFor(start)) : natural;
      if (tightest > width && end - start > 1) break;
      const shortfall = Math.max(0, width - natural) / width;
      // Tightening costs more than loosening by the same amount; a lone measure too wide even when tight overflows.
      const squeeze = Math.max(0, natural - width) / width;
      const overflow = Math.max(0, tightest - width) / width;
      const isLast = end === count;
      const cost = best[start].cost + (isLast && shortfall < 1 - 1e-9 ? shortfall * shortfall * 0.1 : shortfall * shortfall) * 100 +
        squeeze * squeeze * 250 + overflow * 1000 + 1;
      if (cost < best[end].cost) best[end] = { cost, from: start };
    }
  }
  const ranges: [number, number][] = [];
  for (let end = count; end > 0; end = best[end].from) ranges.unshift([best[end].from, end - 1]);

  return ranges.map(([first, last], lineNumber) => {
    const indent = indentFor(first);
    const natural = lineWidth(prepared, spacings, first, last, 1, indent);
    const isLast = lineNumber === ranges.length - 1;
    let stretch = 1;
    if (!(isLast && natural < width * prepared.settings.raggedLastLine)) {
      // The line width grows with the stretch; find the stretch that fills it.
      let low = 0, high = 1;
      while (lineWidth(prepared, spacings, first, last, high, indent) < width && high < 64) high *= 2;
      for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (low + high) / 2;
        if (lineWidth(prepared, spacings, first, last, middle, indent) < width) low = middle; else high = middle;
      }
      stretch = (low + high) / 2;
    }
    const { width: prefix, showTime } = startPrefixWidth(prepared, first, indent);
    const change = keyChange(prepared, last + 1);
    const time = timeChange(prepared, last + 1);
    return {
      first, last, stretch, prefix, showTime, naturalWidth: natural,
      ...(change ? { courtesyKey: change } : {}), ...(time ? { courtesyTime: time } : {})
    };
  });
}
