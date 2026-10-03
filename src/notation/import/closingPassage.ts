/** Append recorded music that the engraved reference does not contain.
 * Original attacks stay on their media timestamps. Written rhythm is inferred
 * by the ordinary aligned importer, and kept distinct from the reference.
 */
import * as F from '../core/fraction';
import { decodeScore, encodeScore } from '../model/codec';
import type { Score, ScoreEvent } from '../model/types';
import { importAligned } from './aligned';
import type { AlignedSource, ImportedTiming } from './aligned';
import type { KeySignature } from '../core/pitch';
import { ScoreIndex } from '../model/query';
import { valueFor } from '../model/time';

export interface ClosingPassageSource extends AlignedSource {
  readonly mediaEnd: number;
  readonly key?: KeySignature;
  /** Empty quarter beats preceding the pickup in the imported full first bar. */
  readonly pickupQuarters?: number;
}

export function appendClosingPassage(score: Score, timing: ImportedTiming, source: ClosingPassageSource): {
  score: Score; timing: ImportedTiming;
} {
  const start = Math.min(...source.notes.map(note => note.audioStart));
  const lastAttack = Math.max(...source.notes.map(note => note.audioStart));
  const referenceEnd = timing.beats.at(-1)!;
  if (!source.notes.length || start <= referenceEnd.time || source.mediaEnd <= lastAttack)
    throw new Error('Closing passage must follow the reference and end before mediaEnd');
  const imported = importAligned(source, {
    title: score.meta.title, staves: score.staves, group: 'brace',
    time: { beats: 4, beatType: 4, symbol: 'numeric' },
    key: source.key ?? { fifths: 0, mode: 'major' },
    chord: { ticks: 120, seconds: 0.04, alignSeconds: 0.04 },
    roll: { minNotes: 3, minSeconds: 0.05, maxSeconds: 0.35, maxBeatFraction: 0.34 },
    tripletOnsets: 2, tieSeconds: 0.75, syncopation: true
  });
  const pickup = F.frac(source.pickupQuarters ?? 0, 4);
  const pickupPosition = F.toNumber(pickup);
  if (pickupPosition < 0 || pickupPosition >= 1) throw new Error('Invalid closing pickup');
  let passageScore = imported.score;
  if (pickupPosition) {
    const index = new ScoreIndex(imported.score);
    const events = imported.score.events.flatMap((event): ScoreEvent[] => {
      if (event.measure !== 0) return [event];
      if (F.compare(event.offset, pickup) >= 0) return [{ ...event, offset: F.sub(event.offset, pickup) }];
      const end = F.add(event.offset, index.length(event));
      if (!F.gt(end, pickup)) return [];
      const length = F.sub(end, pickup);
      if (event.kind === 'space') return [{ ...event, offset: F.ZERO, length }];
      if (event.kind !== 'rest') throw new Error('Pickup would cut a recorded note');
      const value = valueFor(length);
      if (!value) throw new Error('Unsupported pickup rest');
      return [{ ...event, offset: F.ZERO, value }];
    });
    passageScore = { ...imported.score,
      measures: imported.score.measures.map((measure, i) => i === 0 ? { ...measure, length: F.sub(F.ONE, pickup) } : measure),
      events
    };
  }
  // A bar of rests represents the gap after the reference's held chord.
  const gapMeasure = score.measures.length;
  const shift = gapMeasure + 1;
  const prefix = 'closing.';
  const arrays = ['events', 'tuplets', 'clefs', 'attachments', 'spanners'] as const;
  const json = encodeScore(passageScore) as Record<string, unknown>;
  const ids = new Set<string>();
  function collect(value: unknown): void {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string') ids.add(record.id);
      Object.values(record).forEach(collect);
    }
  }
  arrays.forEach(field => collect(json[field]));
  function relocate(value: unknown, key?: string): unknown {
    if (typeof value === 'string' && ids.has(value)) return prefix + value;
    if (key === 'measure' && typeof value === 'number') return value + shift;
    if (Array.isArray(value)) return value.map(item => relocate(item));
    if (value && typeof value === 'object') {
      const record = Object.fromEntries(Object.entries(value).map(([name, item]) => [name, relocate(item, name)]));
      if (record.id) record.provenance = { origin: 'inferred', rule: 'recorded-closing-passage', confidence: 0.5 };
      return record;
    }
    return value;
  }
  arrays.forEach(field => { json[field] = relocate(json[field]); });
  const relocated = decodeScore(json);
  const gapEvents: ScoreEvent[] = score.staves.map(staff => ({
    id: `closing.gap.${staff.id}`, kind: 'rest', measure: gapMeasure, staff: staff.id,
    voice: 1, offset: F.ZERO, value: { base: 'whole', dots: 0 }, fullBar: true
  }));
  const combined: Score = {
    ...score,
    meta: { ...score.meta, source: `${score.meta.source ?? ''}; closing passage transcribed from the recording, rhythm inferred` },
    measures: [
      ...score.measures.map((measure, index) => index === gapMeasure - 1 ? { ...measure, end: 'barline.double' as const } : measure),
      { number: gapMeasure + 1 },
      ...passageScore.measures.map((measure, index) => ({ ...measure, number: shift + index + 1,
        ...(index === 0 ? { section: 'Recorded closing passage' } : {}) }))
    ],
    events: [...score.events, ...gapEvents, ...relocated.events],
    tuplets: [...score.tuplets, ...relocated.tuplets],
    clefs: [...score.clefs, ...relocated.clefs],
    attachments: [...score.attachments, ...relocated.attachments],
    // Reference-end position anchors used to coincide with the system end.
    // Once more bars follow, close them at the actual reference barline.
    spanners: [...score.spanners.map(spanner => {
      const end = spanner.end;
      if ('position' in end && end.position.measure === gapMeasure - 1 && F.eq(end.position.offset, F.ONE))
        return { ...spanner, staff: spanner.staff ?? end.position.staff,
          end: { barline: { measure: gapMeasure - 1, side: 'end' as const } } };
      return spanner;
    }), ...relocated.spanners]
  };
  // Anchor the last bar to the recording end, rather than extrapolating tempo
  // beyond the media. Adjust only beat endpoints after the last actual attack.
  const tailBeats = imported.timing.beats.filter(beat => beat.position >= pickupPosition)
    .map(beat => ({ ...beat, position: beat.position - pickupPosition }));
  const boundary = tailBeats.findLastIndex(beat => beat.time <= lastAttack);
  const anchor = tailBeats[boundary];
  if (!anchor || boundary === tailBeats.length - 1) throw new Error('Closing clock has no trailing endpoint');
  for (let i = boundary + 1; i < tailBeats.length; i++)
    tailBeats[i].time = anchor.time + (source.mediaEnd - anchor.time) *
      (tailBeats[i].position - anchor.position) / (tailBeats.at(-1)!.position - anchor.position);
  const notes = { ...timing.notes };
  for (const [id, value] of Object.entries(imported.timing.notes)) {
    if (value.start >= source.mediaEnd) throw new Error(`Closing note ${id} starts after the recording`);
    const glideEnd = Math.min(source.mediaEnd, Math.max(value.start + 0.01, value.glideEnd));
    notes[prefix + id] = { start: value.start, glideEnd,
      soundingEnd: Math.min(source.mediaEnd, Math.max(glideEnd, value.soundingEnd,
        value.start >= lastAttack - 0.04 ? source.mediaEnd : 0)) };
  }
  const gapBeats = [1, 2, 3].map(beat => ({ position: gapMeasure + beat / 4,
    time: referenceEnd.time + (start - referenceEnd.time) * beat / 4 }));
  return { score: combined, timing: { notes, beats: [...timing.beats, ...gapBeats,
    ...tailBeats.map(beat => ({ position: shift + beat.position, time: beat.time }))] } };
}
