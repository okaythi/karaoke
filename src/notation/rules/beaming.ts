/**
 * Beam groups, docs §6.4. Short notes beam within the meter's beat groups;
 * eighths may join across beats where convention allows (half bars in 4/4,
 * the whole bar in 2/4 and 3/4). Rests and longer notes break a group. In
 * compound meters, secondary beams break at every eighth to show the beat's
 * three parts. A tuplet stays one group and breaks secondary beams at its
 * edges.
 */
import * as F from '../core/fraction';
import type { ScoreIndex } from '../model/query';
import { flagCount } from '../model/time';
import type { ChordEvent, ScoreEvent, StaffId } from '../model/types';
import { beatStructure, windowAt } from './meter';

export interface BeamGroup {
  readonly events: readonly ChordEvent[];
  /** Indexes `i` where beams below the primary break between event i − 1 and i. */
  readonly breaks: ReadonlySet<number>;
}

export interface BeamSettings {
  readonly beamOverRests: boolean;
}

const beamable = (event: ScoreEvent): event is ChordEvent => event.kind === 'chord' && flagCount(event.value.base) > 0;

export function beamGroups(index: ScoreIndex, measure: number, staff: StaffId, voice: number,
  settings: BeamSettings = { beamOverRests: false }): BeamGroup[] {
  const structure = beatStructure(index.timeAt(measure));
  const events = index.eventsIn(measure, staff, voice).filter(event => !(event.kind === 'chord' && event.grace));
  const groups: BeamGroup[] = [];

  // Eighth windows apply only where every sounding event in them is a plain eighth.
  const eighthOnly = (start: F.Fraction, end: F.Fraction) => events
    .filter(event => F.ge(event.offset, start) && F.lt(event.offset, end) && event.kind !== 'space')
    .every(event => event.kind === 'chord' && event.value.base === 'eighth' && event.value.dots === 0 && !event.tuplet);
  const windowOf = (event: ScoreEvent) => {
    const wide = windowAt(structure.eighthWindows, event.offset);
    if (eighthOnly(wide.start, wide.end)) return wide;
    return windowAt(structure.groups, event.offset);
  };
  // A tuplet spans its whole extent, even across beat windows.
  const tupletOf = (event: ScoreEvent) => (event.tuplet ? index.tupletChain(event)[0].id : undefined);

  let current: ChordEvent[] = [];
  let currentWindow: { start: F.Fraction; end: F.Fraction } | undefined;
  let currentTuplet: string | undefined;
  const flush = () => {
    if (current.length > 1) groups.push({ events: current, breaks: secondaryBreaks(current) });
    current = [];
    currentWindow = undefined;
    currentTuplet = undefined;
  };
  const secondaryBreaks = (members: ChordEvent[]): Set<number> => {
    const breaks = new Set<number>();
    for (let position = 1; position < members.length; position++) {
      const event = members[position];
      if (tupletOf(event) !== tupletOf(members[position - 1]) || event.tuplet !== members[position - 1].tuplet) breaks.add(position);
      else if (structure.compound && !event.tuplet) {
        const sub = F.div(structure.beatLength, F.frac(3));
        if (F.isMultipleOf(event.offset, sub)) breaks.add(position);
      }
    }
    return breaks;
  };

  for (const event of events) {
    if (event.kind === 'space') { flush(); continue; }
    if (event.kind === 'rest') {
      if (!settings.beamOverRests) flush();
      continue;
    }
    if (!beamable(event)) { flush(); continue; }
    const window = windowOf(event);
    const tuplet = tupletOf(event);
    const sameWindow = currentWindow && F.eq(window.start, currentWindow.start);
    const sameTuplet = tuplet !== undefined && tuplet === currentTuplet;
    if (current.length && !sameWindow && !sameTuplet) flush();
    current.push(event);
    currentWindow ??= window;
    currentTuplet = tuplet;
  }
  flush();
  return groups;
}

/** Grace notes before one main event beam together when there are several. */
export function graceBeamGroups(index: ScoreIndex, measure: number, staff: StaffId, voice: number): BeamGroup[] {
  const runs = new Map<string, ChordEvent[]>();
  for (const event of index.eventsIn(measure, staff, voice)) {
    if (event.kind !== 'chord' || !event.grace || !beamable(event)) continue;
    const key = `${event.grace.placement}:${F.key(event.offset)}`;
    (runs.get(key) ?? runs.set(key, []).get(key)!).push(event);
  }
  return [...runs.values()].filter(run => run.length > 1).map(events => ({ events, breaks: new Set<number>() }));
}
