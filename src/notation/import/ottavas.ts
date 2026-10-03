/**
 * Octave-line inference, docs §7.8. Measures whose notes climb far above a
 * staff get an 8va line, measure by measure:
 *
 * - a measure is marked when its highest note needs `peakLedgers` ledger
 *   lines and at least `supportNotes` of its notes need `supportLedgers`;
 * - neighbouring marked measures join into one line, and a line of several
 *   measures takes in further neighbours that reach the peak;
 * - a lone marked measure keeps its line only when `loneMeasureNotes` of its
 *   notes are high (zero: always).
 *
 * The thresholds belong to the song's import settings, per clef.
 */
import { ScoreIndex } from '../model/query';
import type { ChordEvent, ClefKind, Score, Spanner, StaffId } from '../model/types';
import { stepOf } from '../rules/staffPosition';

export interface OttavaRule {
  readonly peakLedgers: number;
  readonly supportLedgers: number;
  readonly supportNotes: number;
  readonly loneMeasureNotes: number;
}

const ledgersAbove = (step: number) => (step >= 10 ? Math.floor((step - 8) / 2) : 0);

export function inferOttavas(score: Score, rules: Partial<Record<ClefKind, OttavaRule>>): Spanner[] {
  const index = new ScoreIndex(score);
  const spanners: Spanner[] = [];
  for (const staff of score.staves) {
    const rule = rules[staff.clef];
    if (!rule) continue;
    const stats = (measure: number) => {
      const steps = index.eventsIn(measure, staff.id)
        .filter((event): event is ChordEvent => event.kind === 'chord')
        .flatMap(event => event.notes.filter(note => !note.staff || note.staff === staff.id)
          .map(note => stepOf(note.pitch, index.clefAt(staff.id, measure, event.offset))));
      const ledgers = steps.map(ledgersAbove);
      return { peak: Math.max(0, ...ledgers), support: ledgers.filter(count => count >= rule.supportLedgers).length };
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
    // Spans that grew into each other become one.
    const merged: { first: number; last: number }[] = [];
    for (const span of kept) {
      const last = merged.at(-1);
      if (last && span.first <= last.last + 1) last.last = Math.max(last.last, span.last); else merged.push({ ...span });
    }
    for (const span of merged) {
      const ends = chordEnds(index, staff.id, span.first, span.last, staff.clef, rule);
      if (!ends) continue;
      spanners.push({
        id: `ottava@${staff.id}.${span.first + 1}`, kind: 'ottava.8va', start: { event: ends.first }, end: { event: ends.last },
        provenance: { origin: 'inferred', rule: 'ottava-ledgers' }
      });
    }
  }
  return spanners;
}

/**
 * The first and last chords of a line. Chords at either end whose highest
 * note does not itself need the line (fewer than `supportLedgers` ledger
 * lines) are left out, so the line starts and stops where the music is high.
 */
function chordEnds(index: ScoreIndex, staff: StaffId, first: number, last: number, clef: ClefKind, rule: OttavaRule): { first: string; last: string } | undefined {
  const chords: ChordEvent[] = [];
  for (let measure = first; measure <= last; measure++)
    chords.push(...index.eventsIn(measure, staff).filter((event): event is ChordEvent => event.kind === 'chord'));
  const high = (chord: ChordEvent) => Math.max(...chord.notes.filter(note => !note.staff || note.staff === staff)
    .map(note => ledgersAbove(stepOf(note.pitch, clef)))) >= Math.max(1, rule.supportLedgers);
  const from = chords.findIndex(high), to = chords.findLastIndex(high);
  if (from < 0) return undefined;
  return { first: chords[from].id, last: chords[to].id };
}
