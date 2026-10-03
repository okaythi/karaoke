/**
 * Octave-line inference, docs §7.8.
 *
 * Where. Measures whose notes climb far above a staff form passages:
 *
 * - a measure is marked when its highest note needs `peakLedgers` ledger
 *   lines and at least `supportNotes` of its notes need `supportLedgers`;
 * - neighbouring marked measures join into one passage, and a passage of
 *   several measures takes in further neighbours that reach the peak;
 * - a lone marked measure keeps its line only when `loneMeasureNotes` of its
 *   notes are high (zero: always);
 * - passages no more than `bridgeMeasures` apart join when the line can run
 *   on between them: carrying it over a short lower stretch reads better
 *   than stopping and restarting it.
 *
 * How far. Inside a passage a line follows figures: stretches of music with
 * no silence and no leap of `figureLeap` staff steps between successive top
 * notes. A line that starts or stops inside a figure misrepresents its shape
 * (a step down reads as a leap up), so a line covers whole figures:
 *
 * - it starts with the first figure that reaches `peakLedgers` and ends with
 *   the last, and lower figures between them stay under it;
 * - it governs every note on the staff, so it never covers a chord that
 *   would need more ledger lines under it than at pitch. That chord's figure
 *   is left out, which splits the line; when the figure itself reaches the
 *   peak, only the chord is left out.
 *
 * The thresholds belong to the song's import settings, per clef.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { entry } from '../catalogue/registry';
import type { SpannerEntry } from '../catalogue/types';
import { ScoreIndex } from '../model/query';
import type { ChordEvent, ClefKind, Score, Spanner, StaffId } from '../model/types';
import { TOP_LINE, ledgerSteps, stepOf } from '../rules/staffPosition';

export interface OttavaRule {
  readonly peakLedgers: number;
  readonly supportLedgers: number;
  readonly supportNotes: number;
  readonly loneMeasureNotes: number;
  /** Passages with at most this many measures between them share one line, if nothing between them forbids it. */
  readonly bridgeMeasures: number;
  /** Successive top notes this many staff steps apart belong to different figures (6: a seventh). */
  readonly figureLeap: number;
}

const KIND = 'ottava.8va';
/** Staff steps a note moves when written under the line. */
const WRITTEN_STEPS = 7 * ((entry(KIND) as SpannerEntry).writtenOctaves ?? 0);

const ledgersAbove = (step: number) => ledgerSteps(step).filter(line => line > TOP_LINE).length;
const ledgersBelow = (step: number) => ledgerSteps(step).filter(line => line < 0).length;
/** Ledger lines a chord needs: those of its highest note above the staff and of its lowest below. */
const ledgers = (steps: readonly number[], shift = 0) =>
  ledgersAbove(Math.max(...steps) + shift) + ledgersBelow(Math.min(...steps) + shift);

/** Everything drawn on a staff at one position. */
interface Moment {
  /** The chord a line is anchored to when it starts or ends here. */
  readonly chord: ChordEvent;
  readonly start: Fraction;
  readonly end: Fraction;
  /** Staff step of the highest note. */
  readonly top: number;
  /** Ledger lines the highest note needs at pitch. */
  readonly peak: number;
  /** Needs more ledger lines under the line than at pitch. */
  readonly harmed: boolean;
}

type Figure = readonly Moment[];

export function inferOttavas(score: Score, rules: Partial<Record<ClefKind, OttavaRule>>): Spanner[] {
  const index = new ScoreIndex(score);
  const spanners: Spanner[] = [];
  for (const staff of score.staves) {
    const rule = rules[staff.clef];
    if (!rule) continue;
    const stats = (measure: number) => {
      const peaks = index.eventsIn(measure)
        .filter((event): event is ChordEvent => event.kind === 'chord')
        .flatMap(event => stepsOn(index, staff.id, event).map(ledgersAbove));
      return { peak: Math.max(0, ...peaks), support: peaks.filter(count => count >= rule.supportLedgers).length };
    };
    const all = Array.from({ length: index.measureCount }, (_, measure) => stats(measure));
    const marked = all.map(item => item.peak >= rule.peakLedgers && item.support >= rule.supportNotes);
    const spans: { first: number; last: number }[] = [];
    marked.forEach((isMarked, measure) => {
      if (!isMarked) return;
      const last = spans.at(-1);
      if (last && last.last === measure - 1) last.last = measure; else spans.push({ first: measure, last: measure });
    });
    for (const span of spans) {
      if (span.last === span.first) continue;
      while (span.first > 0 && all[span.first - 1].peak >= rule.peakLedgers) span.first--;
      while (span.last < all.length - 1 && all[span.last + 1].peak >= rule.peakLedgers) span.last++;
    }
    const kept = spans.filter(span => span.last > span.first || all[span.first].support >= rule.loneMeasureNotes);
    // Passages that grew into each other become one, and so do close ones with nothing between them a line would harm.
    const bridgeable = (from: number, to: number) => to - from - 1 <= rule.bridgeMeasures &&
      (to - from <= 1 || !momentsIn(index, staff.id, from + 1, to - 1).some(moment => moment.harmed));
    const passages: { first: number; last: number }[] = [];
    for (const span of kept) {
      const last = passages.at(-1);
      if (last && bridgeable(last.last, span.first)) last.last = Math.max(last.last, span.last); else passages.push({ ...span });
    }
    const used = new Map<string, number>();
    for (const passage of passages) {
      const figures = figuresOf(momentsIn(index, staff.id, passage.first, passage.last), rule.figureLeap);
      for (const line of linesOver(figures, rule.peakLedgers)) {
        const first = line[0].chord, last = line.at(-1)!.chord;
        // A line is named after the measure it starts in; later lines of the same measure are numbered.
        const name = `ottava@${staff.id}.${first.measure + 1}`;
        const count = (used.get(name) ?? 0) + 1;
        used.set(name, count);
        spanners.push({
          id: count === 1 ? name : `${name}.${count}`, kind: KIND, start: { event: first.id }, end: { event: last.id },
          ...(first.staff === staff.id ? {} : { staff: staff.id }),
          provenance: { origin: 'inferred', rule: 'ottava-ledgers' }
        });
      }
    }
  }
  return spanners;
}

/** Staff steps of the notes a chord has drawn on a staff: its own, or one its notes cross to. */
function stepsOn(index: ScoreIndex, staff: StaffId, chord: ChordEvent): number[] {
  const clef = index.clefAt(staff, chord.measure, chord.offset);
  return chord.notes.filter(note => (note.staff ?? chord.staff) === staff).map(note => stepOf(note.pitch, clef));
}

/** What is drawn on a staff across the measures `first` to `last`, position by position. */
function momentsIn(index: ScoreIndex, staff: StaffId, first: number, last: number): Moment[] {
  const struck: { chord: ChordEvent; start: Fraction; end: Fraction; steps: number[] }[] = [];
  for (let measure = first; measure <= last; measure++) {
    for (const event of index.eventsIn(measure)) {
      if (event.kind !== 'chord') continue;
      const steps = stepsOn(index, staff, event);
      if (!steps.length) continue;
      const start = index.absolute(measure, event.offset);
      const end = F.add(start, index.length(event));
      const same = struck.at(-1);
      if (same && F.eq(same.start, start)) {
        same.steps.push(...steps);
        same.end = F.max(same.end, end);
        // The line hangs on the staff's own chord where there is one, and on its first voice.
        const own = (chord: ChordEvent) => Number(chord.staff === staff);
        if (own(event) > own(same.chord) || (own(event) === own(same.chord) && event.voice < same.chord.voice)) same.chord = event;
      } else struck.push({ chord: event, start, end, steps });
    }
  }
  return struck.map(({ chord, start, end, steps }) => ({
    chord, start, end, top: Math.max(...steps), peak: ledgersAbove(Math.max(...steps)),
    harmed: ledgers(steps, WRITTEN_STEPS) > ledgers(steps)
  }));
}

/** Splits moments where the staff falls silent or its top line leaps. */
function figuresOf(moments: readonly Moment[], leap: number): Figure[] {
  const figures: Moment[][] = [];
  let sounding: Fraction | undefined;
  for (const moment of moments) {
    const previous = figures.at(-1)?.at(-1);
    const connected = previous && sounding && F.le(moment.start, sounding) && Math.abs(moment.top - previous.top) < leap;
    if (connected) figures.at(-1)!.push(moment); else figures.push([moment]);
    sounding = sounding ? F.max(sounding, moment.end) : moment.end;
  }
  return figures;
}

/** The moments each line of a passage covers. */
function linesOver(figures: readonly Figure[], peakLedgers: number): Moment[][] {
  const reaches = (figure: Figure) => figure.some(moment => moment.peak >= peakLedgers);
  // Stretches a line may cover, with `undefined` where it must break.
  const stretches: (Figure | undefined)[] = [];
  for (const figure of figures) {
    if (!figure.some(moment => moment.harmed)) stretches.push(figure);
    else if (!reaches(figure)) stretches.push(undefined);
    else {
      let run: Moment[] = [];
      for (const moment of figure) {
        if (!moment.harmed) { run.push(moment); continue; }
        if (run.length) stretches.push(run);
        stretches.push(undefined);
        run = [];
      }
      if (run.length) stretches.push(run);
    }
  }
  const lines: Moment[][] = [];
  let run: Figure[] = [];
  const close = () => {
    const from = run.findIndex(reaches), to = run.findLastIndex(reaches);
    if (from >= 0) lines.push(run.slice(from, to + 1).flat());
    run = [];
  };
  for (const stretch of stretches) if (stretch) run.push(stretch); else close();
  close();
  return lines;
}
