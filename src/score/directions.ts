import type { EngravingNote, EngravingScore } from './engravingModel';

/**
 * Tempo directions read from the performance. The MP4 is the authority: a
 * mark is written only where the performed beat grid departs from the
 * prevailing tempo by more than the performer's habitual phrase-end breath.
 *
 * - Holds: a span with no attacks that lasts much longer than its written
 *   value at the prevailing tempo gets a fermata on its final (tied) note.
 * - Slowing that lasts two bars or more, or that leads into a hold, is rit.
 *   It becomes molto rit. once it is markedly deeper later in the run.
 * - A one-bar slowing is the arrangement's normal phrasing and stays
 *   unmarked unless it is an outlier against all such breaths (poco rit.).
 * - a tempo follows a marked change only, at the bar where the tempo returns.
 */
export interface TempoDirection {
  kind: 'text' | 'fermata';
  text?: 'poco rit.' | 'rit.' | 'molto rit.' | 'a tempo';
  measure: number;
  offsetTicks: number;
  staff: number;
  /** Why the mark exists, for calibration. */
  reason: string;
}

const BEAT_TICKS = 480;
const BAR_BEATS = 3;
/** A bar this much slower than the prevailing tempo is a dip. */
const DIP = 0.93;
/** A dip ends once the tempo is back within this ratio. */
const RECOVERED = 0.95;
const MOLTO = 0.75;
/** A silent span held this much longer than written is a fermata. */
const HOLD = 1.3;
const HISTORY_BARS = 12;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function noteTick(note: EngravingNote): number {
  return (note.measure - 1) * BAR_BEATS * BEAT_TICKS + note.offsetTicks;
}

/** The note on each staff that is still sounding just before `tick`. */
function heldNotes(score: EngravingScore, tick: number): EngravingNote[] {
  const held: EngravingNote[] = [];
  for (const staff of [1, 2]) {
    const before = score.notes.filter(note => note.staff === staff && noteTick(note) < tick);
    const last = before.reduce<EngravingNote | undefined>((latest, note) =>
      !latest || noteTick(note) > noteTick(latest) ? note : latest, undefined);
    if (last) held.push(last);
  }
  return held;
}

export function deriveTempoDirections(score: EngravingScore): TempoDirection[] {
  const { clock, beats, measures } = score;
  const onsets = [...score.sources.values()].map(source => source.audioStart).sort((a, b) => a - b);
  const barTime = (measure: number) => clock.timeAt((measure - 1) * BAR_BEATS * BEAT_TICKS);
  const beatTempo = (beat: number) => 60 / (clock.timeAt((beat + 1) * BEAT_TICKS) - clock.timeAt(beat * BEAT_TICKS));
  const barTempo = (measure: number) => 60 * BAR_BEATS / (barTime(measure + 1) - barTime(measure));
  const directions: TempoDirection[] = [];

  // Silent spans between attacked beats. Their bars carry an interpolated,
  // not a performed, tempo and are left out of the dip analysis.
  const holds: { startBeat: number; endBeat: number; seconds: number }[] = [];
  for (let index = 1; index < beats.length; index++) {
    const before = beats[index - 1], after = beats[index];
    if (after.beat - before.beat < BAR_BEATS) continue;
    const silent = !onsets.some(time => time > before.time + 0.05 && time < after.time - 0.05);
    if (silent) holds.push({ startBeat: before.beat, endBeat: after.beat, seconds: after.time - before.time });
  }
  const inHold = (measure: number) => holds.some(hold =>
    hold.startBeat < measure * BAR_BEATS && hold.endBeat > (measure - 1) * BAR_BEATS + 1);
  // A bar's tempo is measured only when at least three of the four beats
  // that bound its three beat spans were attacked. Elsewhere the grid is
  // interpolated, and misbarred passages would read as false slowing.
  const attacked = new Set(beats.map(item => item.beat));
  const measured = (measure: number) => [0, 1, 2, 3]
    .filter(index => attacked.has((measure - 1) * BAR_BEATS + index)).length >= 3;

  // The prevailing tempo before each bar: the median of recent bars that
  // were neither dips nor holds.
  const history: number[] = [];
  const reference: number[] = [];
  const ratio: number[] = [];
  for (let measure = 1; measure <= measures; measure++) {
    const tempo = barTempo(measure);
    const prevailing = history.length >= 4 ? median(history.slice(-HISTORY_BARS)) :
      median(Array.from({ length: 8 }, (_, index) => barTempo(index + 1)));
    reference[measure] = prevailing;
    ratio[measure] = inHold(measure) || !measured(measure) ? NaN : tempo / prevailing;
    if (ratio[measure] >= DIP) history.push(tempo);
  }

  for (const hold of holds) {
    const startBar = Math.floor(hold.startBeat / BAR_BEATS) + 1;
    const written = (hold.endBeat - hold.startBeat) * 60 / reference[startBar];
    if (hold.seconds < written * HOLD) continue;
    for (const note of heldNotes(score, hold.endBeat * BEAT_TICKS))
      directions.push({ kind: 'fermata', measure: note.measure, offsetTicks: note.offsetTicks, staff: note.staff,
        reason: `held ${hold.seconds.toFixed(2)} s for ${written.toFixed(2)} s written` });
  }
  const lastSource = [...score.sources.values()].reduce((latest, source) => source.audioEnd > latest.audioEnd ? source : latest);
  const lastNote = score.notes.find(note => note.pitches.some(pitch => pitch.sourceId === lastSource.id));
  if (lastNote) {
    const written = clock.timeAt(noteTick(lastNote) + BAR_BEATS * BEAT_TICKS - lastNote.offsetTicks) - lastSource.audioStart;
    // The fermata belongs over the held note, not a shorter flourish
    // written after it in another voice.
    if (lastSource.audioEnd - lastSource.audioStart >= written * HOLD)
      for (const note of heldNotes(score, measures * BAR_BEATS * BEAT_TICKS)) {
        const anchor = note.staff === lastNote.staff ? lastNote : note;
        directions.push({ kind: 'fermata', measure: anchor.measure, offsetTicks: anchor.offsetTicks, staff: anchor.staff,
          reason: `final note held ${(lastSource.audioEnd - lastSource.audioStart).toFixed(2)} s` });
      }
  }

  // Runs of slow bars, with hysteresis so a bar that has not quite
  // recovered keeps the run going.
  const runs: { first: number; last: number; deepest: number; deepestBar: number; mean: number; intoHold: boolean }[] = [];
  for (let measure = 1; measure <= measures; measure++) {
    if (!(ratio[measure] < DIP)) continue;
    // Unmeasured bars neither end a run nor count towards it.
    let last = measure, probe = measure + 1;
    while (probe <= measures && !(ratio[probe] >= RECOVERED)) {
      if (!Number.isNaN(ratio[probe])) last = probe;
      else if (inHold(probe)) break;
      probe++;
    }
    if (probe > measures) last = measures;
    const bars = Array.from({ length: last - measure + 1 }, (_, index) => ratio[measure + index]).filter(value => !Number.isNaN(value));
    const deepest = Math.min(...bars);
    runs.push({ first: measure, last, deepest, deepestBar: measure + bars.indexOf(deepest),
      mean: bars.reduce((sum, value) => sum + value, 0) / bars.length, intoHold: last < measures && inHold(last + 1) });
    measure = last;
  }
  const breaths = runs.filter(run => run.first === run.last && !run.intoHold).map(run => run.deepest);
  const typical = breaths.length ? median(breaths) : DIP;
  const spread = Math.max(0.015, breaths.length ? median(breaths.map(depth => Math.abs(depth - typical))) : 0);
  const outlier = typical - 3 * spread;

  for (const run of runs) {
    const toEnd = run.last >= measures - 1;
    // Slowing over several bars counts only when it is deeper than a breath
    // on average; a bar or two just under the reference is a new phrase
    // settling, not a ritardando.
    const sustained = run.intoHold || toEnd || (run.last > run.first && run.mean < typical + spread);
    if (!sustained && run.deepest >= outlier) continue;
    const at = sustained ? run.first : run.deepestBar;
    const firstBeat = (at - 1) * BAR_BEATS;
    const beat = [0, 1, 2].find(index => beatTempo(firstBeat + index) / reference[at] < DIP) ?? 0;
    directions.push({ kind: 'text', text: sustained ? 'rit.' : 'poco rit.', measure: at,
      offsetTicks: beat * BEAT_TICKS, staff: 1,
      reason: `bars ${run.first}–${run.last} down to ${Math.round(run.deepest * 100)}% of ♩=${Math.round(reference[at])}` +
        `; breaths reach ${Math.round(typical * 100)}% ±${Math.round(spread * 100)}` });
    const molto = Array.from({ length: Math.max(0, run.last - run.first - 1) }, (_, index) => run.first + 2 + index)
      .find(measure => ratio[measure] < MOLTO);
    if (sustained && molto) directions.push({ kind: 'text', text: 'molto rit.', measure: molto, offsetTicks: 0, staff: 1,
      reason: `bar ${molto} at ${Math.round(ratio[molto] * 100)}%` });
    if (toEnd) continue;
    let resume = (sustained ? run.last : run.deepestBar) + 1;
    while (resume <= measures && inHold(resume)) resume++;
    if (resume <= measures) directions.push({ kind: 'text', text: 'a tempo', measure: resume, offsetTicks: 0, staff: 1,
      reason: `bar ${resume} back to ♩=${Math.round(barTempo(resume))}` });
  }
  return directions.sort((a, b) => a.measure - b.measure || a.offsetTicks - b.offsetTicks || a.staff - b.staff);
}
