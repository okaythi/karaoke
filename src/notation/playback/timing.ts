/**
 * When each note lights up, docs §10. Real songs take their times from the
 * alignment of the score to the recording; previews and tests use a nominal
 * clock derived from the score itself.
 */
import * as F from '../core/fraction';
import type { ScoreIndex } from '../model/query';
import { durationOf } from '../model/time';

export interface NoteTiming {
  /** Media time the note starts sounding. */
  readonly start: number;
  /** End of the glide: the note's written value at the local tempo. */
  readonly glideEnd: number;
  /** When the sound stops, including pedal; the note stays lit until then. */
  readonly soundingEnd: number;
}

export interface TimingMap {
  readonly notes: ReadonlyMap<string, NoteTiming>;
  /** Media time at a score position (whole notes from the start), for playheads. */
  timeAt(position: number): number;
}

/**
 * Times from the written rhythm at a fixed tempo. Ties merge into their first
 * note; pedal spans keep notes sounding until the pedal comes up.
 */
export function nominalTiming(index: ScoreIndex, secondsPerWhole: number, offset = 0): TimingMap {
  const seconds = (position: F.Fraction) => offset + F.toNumber(position) * secondsPerWhole;
  const tiedOn = new Map<string, string>();
  for (const tie of index.spanners('tie')) if ('note' in tie.start && 'note' in tie.end) tiedOn.set(tie.end.note, tie.start.note);
  const pedals = index.score.spanners.filter(spanner => spanner.kind.startsWith('pedal.') && 'event' in spanner.start && 'event' in spanner.end)
    .map(spanner => {
      const start = index.event((spanner.start as { event: string }).event), end = index.event((spanner.end as { event: string }).event);
      return { from: seconds(index.absolute(start.measure, start.offset)), to: seconds(index.absolute(end.measure, end.offset)) };
    });
  const notes = new Map<string, NoteTiming>();
  for (const event of index.score.events) {
    if (event.kind !== 'chord') continue;
    const at = index.absolute(event.measure, event.offset);
    const start = seconds(at);
    // Grace notes take a short moment before their main note.
    const graceShift = event.grace ? -(secondsPerWhole / 32) * (1 + (event.graceOrder ?? 0)) : 0;
    const length = event.grace ? secondsPerWhole / 32 : F.toNumber(index.length(event)) * secondsPerWhole;
    const written = event.grace ? length : F.toNumber(F.mul(durationOf(event.value), index.timeFactor(event))) * secondsPerWhole;
    for (const note of event.notes) {
      const end = start + graceShift + length;
      const held = pedals.find(span => span.from <= end && end < span.to);
      notes.set(note.id, { start: start + graceShift, glideEnd: start + graceShift + written, soundingEnd: held ? held.to : end });
    }
  }
  // A tied note continues its first note: it glides on from where that one ends.
  for (const [later, earlier] of tiedOn) {
    const first = notes.get(earlier), second = notes.get(later);
    if (first && second) notes.set(earlier, { ...first, soundingEnd: Math.max(first.soundingEnd, second.soundingEnd) });
  }
  return { notes, timeAt: position => offset + position * secondsPerWhole };
}
