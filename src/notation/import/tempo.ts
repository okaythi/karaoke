/**
 * Tempo marks read from a performance, docs §5.17. The recording is the
 * authority: a mark is written only where the performed beat clock departs
 * from the prevailing tempo by more than the performer's habitual
 * phrase-end breath.
 *
 * - Holds: a stretch with no attacks lasting much longer than written gets a
 *   fermata on the notes held over it, and so does a long final note.
 * - Slowing that lasts several bars, or leads into a hold or the end, is a
 *   rit. (molto rit. where it later gets markedly deeper).
 * - A one-bar slowing is ordinary phrasing and stays unmarked unless it is
 *   an outlier among all such breaths (poco rit.).
 * - a tempo follows a marked change, where the tempo returns.
 */
import * as F from '../core/fraction';
import { ScoreIndex } from '../model/query';
import type { Attachment, ChordEvent, Score, Spanner } from '../model/types';
import { beatStructure } from '../rules/meter';
import type { BeatClock } from '../playback/clock';

export interface TempoSettings {
  /** A bar this much slower than the prevailing tempo is a dip. */
  readonly dip: number;
  /** A dip ends once the tempo is back within this ratio. */
  readonly recovered: number;
  readonly molto: number;
  /** A silent stretch held this much longer than written is a fermata. */
  readonly hold: number;
  /** Bars of history that define the prevailing tempo. */
  readonly historyBars: number;
}

export const DEFAULT_TEMPO_SETTINGS: TempoSettings = { dip: 0.93, recovered: 0.95, molto: 0.75, hold: 1.3, historyBars: 12 };

export interface PerformedNote {
  readonly start: number;
  readonly end: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * `notes` are the recording's attacks by note ID (tied continuations
 * excluded); `attackedBeats` the beat positions (whole notes) that carry one.
 */
export function inferTempoMarks(score: Score, clock: BeatClock, notes: ReadonlyMap<string, PerformedNote>,
  attackedBeats: ReadonlySet<number>, settings: TempoSettings = DEFAULT_TEMPO_SETTINGS): { attachments: Attachment[]; spanners: Spanner[] } {
  const index = new ScoreIndex(score);
  const time = index.timeAt(0);
  const structure = beatStructure(time);
  const barBeats = structure.beats.length;
  const beatLength = F.toNumber(structure.beatLength);
  const measures = index.measureCount;
  const barStart = (measure: number) => F.toNumber(index.measureStarts[measure]);
  const barTempo = (measure: number) => 60 * barBeats / (clock.timeAt(barStart(measure + 1)) - clock.timeAt(barStart(measure)));
  const beatTempo = (position: number) => 60 / (clock.timeAt(position + beatLength) - clock.timeAt(position));
  const onsets = [...notes.values()].map(note => note.start).sort((a, b) => a - b);
  const beatList = [...attackedBeats].sort((a, b) => a - b);

  // Silent stretches between attacked beats at least a bar long.
  const holds: { from: number; to: number; seconds: number }[] = [];
  for (let position = 1; position < beatList.length; position++) {
    const before = beatList[position - 1], after = beatList[position];
    if (after - before < barBeats * beatLength - 1e-9) continue;
    const t0 = clock.timeAt(before), t1 = clock.timeAt(after);
    if (!onsets.some(onset => onset > t0 + 0.05 && onset < t1 - 0.05)) holds.push({ from: before, to: after, seconds: t1 - t0 });
  }
  const inHold = (measure: number) => holds.some(hold => hold.from < barStart(measure + 1) && hold.to > barStart(measure) + beatLength);
  // A bar's tempo counts only when most of its beat boundaries were played.
  const measured = (measure: number) => Array.from({ length: barBeats + 1 }, (_, beat) => barStart(measure) + beat * beatLength)
    .filter(position => attackedBeats.has(Number(position.toFixed(9)))).length >= barBeats;

  const history: number[] = [];
  const reference: number[] = [];
  const ratio: number[] = [];
  for (let measure = 0; measure < measures; measure++) {
    const tempo = barTempo(measure);
    const prevailing = history.length >= 4 ? median(history.slice(-settings.historyBars))
      : median(Array.from({ length: Math.min(8, measures) }, (_, bar) => barTempo(bar)));
    reference[measure] = prevailing;
    ratio[measure] = inHold(measure) || !measured(measure) ? NaN : tempo / prevailing;
    if (ratio[measure] >= settings.dip) history.push(tempo);
  }

  const attachments: Attachment[] = [];
  const spanners: Spanner[] = [];
  const inferred = (rule: string) => ({ origin: 'inferred' as const, rule });

  // The chords still sounding just before a position, one per staff.
  const heldAt = (position: number): ChordEvent[] => score.staves.flatMap(staff => {
    const before = score.events.filter((event): event is ChordEvent => event.kind === 'chord' && !event.grace && event.staff === staff.id &&
      F.toNumber(index.absolute(event.measure, event.offset)) < position - 1e-9);
    const last = before.reduce<ChordEvent | undefined>((latest, event) =>
      !latest || F.gt(index.absolute(event.measure, event.offset), index.absolute(latest.measure, latest.offset)) ? event : latest, undefined);
    return last ? [last] : [];
  });
  // A held chord's fermata goes on the chord the sound began with (the first of its ties).
  const tiedFrom = new Map(index.spanners('tie').map(tie => [(tie.end as { note: string }).note, (tie.start as { note: string }).note]));
  const attackOf = (event: ChordEvent): ChordEvent => {
    let note = event.notes[0].id;
    while (tiedFrom.has(note)) note = tiedFrom.get(note)!;
    return index.note(note).event;
  };
  const fermata = (event: ChordEvent, reason: string) => {
    const id = `fermata@${event.id}`;
    if (!attachments.some(item => item.id === id)) attachments.push({ id, kind: 'artic.fermata', anchor: { event: event.id }, provenance: inferred(reason) });
  };

  for (const hold of holds) {
    const startBar = index.measureStarts.findIndex(start => F.toNumber(start) > hold.from + 1e-9) - 1;
    const written = (hold.to - hold.from) / beatLength * 60 / reference[Math.max(0, startBar)];
    if (hold.seconds < written * settings.hold) continue;
    for (const event of heldAt(hold.to)) fermata(event, `held ${hold.seconds.toFixed(2)} s for ${written.toFixed(2)} s written`);
  }
  // A long final note.
  const finalChords = heldAt(barStart(measures));
  const lastNote = [...notes.entries()].reduce((latest, entry) => (entry[1].end > latest[1].end ? entry : latest));
  const lastEvent = index.note(lastNote[0]).event;
  const lastStart = F.toNumber(index.absolute(lastEvent.measure, lastEvent.offset));
  const writtenToEnd = clock.timeAt(barStart(measures)) - clock.timeAt(lastStart);
  if (lastNote[1].end - lastNote[1].start >= writtenToEnd * settings.hold)
    for (const event of finalChords) {
      // The fermata belongs over the held note, not a shorter figure after it in another voice.
      const anchor = event.staff === lastEvent.staff ? lastEvent : attackOf(event);
      fermata(anchor, `final note held ${(lastNote[1].end - lastNote[1].start).toFixed(2)} s`);
    }

  // Runs of slow bars, with hysteresis.
  const runs: { first: number; last: number; deepest: number; deepestBar: number; mean: number; intoHold: boolean }[] = [];
  for (let measure = 0; measure < measures; measure++) {
    if (!(ratio[measure] < settings.dip)) continue;
    let last = measure, probe = measure + 1;
    while (probe < measures && !(ratio[probe] >= settings.recovered)) {
      if (!Number.isNaN(ratio[probe])) last = probe;
      else if (inHold(probe)) break;
      probe++;
    }
    if (probe >= measures) last = measures - 1;
    const bars = Array.from({ length: last - measure + 1 }, (_, offset) => ratio[measure + offset]).filter(value => !Number.isNaN(value));
    const deepest = Math.min(...bars);
    runs.push({ first: measure, last, deepest, deepestBar: measure + bars.indexOf(deepest),
      mean: bars.reduce((sum, value) => sum + value, 0) / bars.length, intoHold: last < measures - 1 && inHold(last + 1) });
    measure = last;
  }
  const breaths = runs.filter(run => run.first === run.last && !run.intoHold).map(run => run.deepest);
  const typical = breaths.length ? median(breaths) : settings.dip;
  const spread = Math.max(0.015, breaths.length ? median(breaths.map(depth => Math.abs(depth - typical))) : 0);
  const outlier = typical - 3 * spread;
  // The first chord in any staff, the upper one first when they start together.
  const staffOrder = (staff: string) => score.staves.findIndex(item => item.id === staff);
  const firstChordFrom = (position: number): ChordEvent | undefined => score.events
    .filter((event): event is ChordEvent => event.kind === 'chord' && !event.grace &&
      F.toNumber(index.absolute(event.measure, event.offset)) >= position - 1e-9)
    .sort((a, b) => F.compare(index.absolute(a.measure, a.offset), index.absolute(b.measure, b.offset)) || staffOrder(a.staff) - staffOrder(b.staff))[0];
  /** The last chord, in any staff, that starts before a position. */
  const lastChordBefore = (position: number): ChordEvent | undefined => score.events
    .filter((event): event is ChordEvent => event.kind === 'chord' && !event.grace &&
      F.toNumber(index.absolute(event.measure, event.offset)) < position - 1e-9)
    .sort((a, b) => F.compare(index.absolute(b.measure, b.offset), index.absolute(a.measure, a.offset)) || staffOrder(a.staff) - staffOrder(b.staff))[0];

  for (const run of runs) {
    const toEnd = run.last >= measures - 2;
    const sustained = run.intoHold || toEnd || (run.last > run.first && run.mean < typical + spread);
    if (!sustained && run.deepest >= outlier) continue;
    const at = sustained ? run.first : run.deepestBar;
    const beat = Array.from({ length: barBeats }, (_, offset) => offset)
      .find(offset => beatTempo(barStart(at) + offset * beatLength) / reference[at] < settings.dip) ?? 0;
    const start = firstChordFrom(barStart(at) + beat * beatLength);
    const lastBar = sustained ? run.last : run.deepestBar;
    const reason = `bars ${run.first + 1}–${run.last + 1} down to ${Math.round(run.deepest * 100)}% of ♩=${Math.round(reference[at])}`;
    // Where the slowing later becomes markedly deeper, "molto rit." takes over with its own line.
    const molto = sustained ? Array.from({ length: Math.max(0, run.last - run.first - 1) }, (_, offset) => run.first + 2 + offset)
      .find(measure => ratio[measure] < settings.molto) : undefined;
    const change = (from: ChordEvent | undefined, to: ChordEvent | undefined, text: string, why: string) => {
      if (from && to && F.le(index.absolute(from.measure, from.offset), index.absolute(to.measure, to.offset)))
        spanners.push({ id: `tempo@${from.id}`, kind: 'tempo.change', start: { event: from.id }, end: { event: to.id }, text, provenance: inferred(why) });
    };
    if (molto !== undefined) {
      change(start, lastChordBefore(barStart(molto)), 'rit.', reason);
      change(firstChordFrom(barStart(molto)), lastChordBefore(barStart(lastBar + 1)), 'molto rit.', `bar ${molto + 1} at ${Math.round(ratio[molto] * 100)}%`);
    } else change(start, lastChordBefore(barStart(lastBar + 1)), sustained ? 'rit.' : 'poco rit.', reason);
    if (toEnd) continue;
    let resume = (sustained ? run.last : run.deepestBar) + 1;
    while (resume < measures && inHold(resume)) resume++;
    const chord = resume < measures ? firstChordFrom(barStart(resume)) : undefined;
    if (chord) attachments.push({ id: `a-tempo@${chord.id}`, kind: 'tempo.return', anchor: { event: chord.id }, text: 'a tempo',
      provenance: inferred(`bar ${resume + 1} back to ♩=${Math.round(barTempo(resume))}`) });
  }
  return { attachments, spanners };
}
