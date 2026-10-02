/**
 * Import from an aligned performance, docs §7: notes that carry both their
 * recorded time and an approximate written position (from a transcription
 * aligned to a reference, or a score aligned to a recording). The written
 * positions may be noisy; the passes here turn them into clean notation.
 *
 * 1. Corrections from the song's import settings (staff, voice, position).
 * 2. Rolled chords: notes rising in pitch within a fraction of a second and
 *    a fraction of a beat become one chord with an arpeggio sign.
 * 3. Chords: near-simultaneous attacks close in written position merge.
 * 4. Grid: each beat of each staff is read in sixteenths, or in triplets
 *    when several onsets sit where only triplets can.
 * 5. Voices: a lone note the source marks as an inner voice is voice 2.
 * 6. Written values: a note lasts until the next onset in its voice; it is
 *    tied over a barline only while it still sounds, and silence becomes
 *    rests. Values follow the meter's beats.
 *
 * Every element gets a stable ID derived from its source note or position,
 * so edits survive re-imports.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { keyAlteration, midi as midiOf, parsePitch, spellings } from '../core/pitch';
import type { KeySignature, Pitch } from '../core/pitch';
import { valueFor } from '../model/time';
import type {
  Attachment, ChordEvent, Measure, Note, NoteValue, Score, ScoreEvent, Spanner, StaffDef, StaffId, TimeSignature, Tuplet
} from '../model/types';
import { beatStructure } from '../rules/meter';
import { buildBeatClock } from '../playback/clock';
import type { BeatClock } from '../playback/clock';

export interface AlignedNote {
  readonly id: string;
  readonly midi: number;
  /** Spelled pitch from the source ("F#5"), when it has one. */
  readonly spelling?: string;
  readonly audioStart: number;
  readonly audioEnd: number;
  readonly staff: StaffId;
  /** The source's voice number; 1 is the main voice. */
  readonly voice: number;
  /** Written position in source ticks from the start of the score. */
  readonly tick: number;
  /** How far the written position can be trusted, 0–1 (1: taken from a reference score). */
  readonly confidence?: number;
  /** Written length in the source, ticks, ties included. */
  readonly sourceLength?: number;
}

export interface AlignedSource {
  /** Ticks per quarter note. */
  readonly divisions: number;
  readonly notes: readonly AlignedNote[];
}

/** A reviewed fix to one source note, applied before any pass. */
export interface NoteCorrection {
  readonly staff?: StaffId;
  readonly voice?: number;
  /** Written position, in ticks from the start of its measure. */
  readonly offset?: number;
  /** Written length in ticks, instead of filling to the next onset. */
  readonly length?: number;
  /** Keep the note out of any rolled chord. */
  readonly roll?: false;
  readonly reason: string;
}

export interface AlignedImportSettings {
  readonly title: string;
  readonly composer?: string;
  readonly source?: string;
  readonly staves: readonly StaffDef[];
  readonly group: 'brace' | 'bracket' | 'none';
  readonly time: TimeSignature;
  readonly key: KeySignature;
  /** Attacks this close in ticks and seconds are one chord; across staves they share a position within `alignSeconds`. */
  readonly chord: { readonly ticks: number; readonly seconds: number; readonly alignSeconds: number };
  /** Rising attacks within these limits are one rolled chord. */
  readonly roll: { readonly minNotes: number; readonly minSeconds: number; readonly maxSeconds: number; readonly maxBeatFraction: number };
  /** A beat is read in triplets when at least this many onsets sit on triplet-only positions. */
  readonly tripletOnsets: number;
  /** A note is tied over a barline only if it sounds at least this long. */
  readonly tieSeconds: number;
  /** Allow a value from an off-beat that ends on a later beat (a dotted quarter on the "and" of one in 3/4). */
  readonly syncopation: boolean;
  readonly corrections?: Readonly<Record<string, NoteCorrection>>;
}

export interface NoteTimingRecord {
  readonly start: number;
  readonly glideEnd: number;
  readonly soundingEnd: number;
}

export interface ImportedTiming {
  readonly notes: Readonly<Record<string, NoteTimingRecord>>;
  readonly beats: readonly { readonly position: number; readonly time: number }[];
}

export interface ImportReport {
  readonly rolledChords: number;
  readonly tripletBeats: number;
  readonly ties: number;
  readonly corrections: number;
}

export interface ImportResult {
  readonly score: Score;
  readonly timing: ImportedTiming;
  readonly clock: BeatClock;
  readonly report: ImportReport;
}

interface WorkNote extends AlignedNote {
  readonly length?: number;
  /** Position set by a correction: authoritative, never moved by clustering or alignment. */
  readonly fixedTick?: boolean;
  /** Voice set by a correction. */
  readonly fixedVoice?: number;
}

interface Cluster {
  readonly staff: StaffId;
  notes: WorkNote[];
  tick: number;
  time: number;
  roll: boolean;
  voice: number;
  /** Written end, once values are chosen. */
  end: number;
}

export function importAligned(source: AlignedSource, settings: AlignedImportSettings): ImportResult {
  const { divisions } = source;
  const wholeTicks = divisions * 4;
  const toFraction = (ticks: number): Fraction => F.frac(ticks, wholeTicks);
  const structure = beatStructure(settings.time);
  const measureTicks = F.toNumber(structure.measure) * wholeTicks;
  const beatStarts = structure.beats.map(beat => F.toNumber(beat) * wholeTicks);
  const beatLength = (index: number) => (index + 1 < beatStarts.length ? beatStarts[index + 1] : measureTicks) - beatStarts[index];
  const beatIndexAt = (offset: number) => {
    let index = 0;
    while (index + 1 < beatStarts.length && beatStarts[index + 1] <= offset) index++;
    return index;
  };
  const sixteenth = divisions / 4;
  let corrections = 0;
  /** How strong a position is in the bar: downbeat, beat, eighth, sixteenth, other. */
  const strength = (tick: number) => {
    const offset = tick % measureTicks;
    if (offset === 0) return 4;
    if (beatStarts.includes(offset)) return 3;
    if (offset % (divisions / 2) === 0) return 2;
    return offset % sixteenth === 0 ? 1 : 0;
  };
  /** The position a group of attacks takes: the most trusted, then the strongest, then the earliest. */
  const preferredTick = (members: readonly WorkNote[]) => [...members].sort((a, b) =>
    Number(!!b.fixedTick) - Number(!!a.fixedTick) || (b.confidence ?? 1) - (a.confidence ?? 1) ||
    strength(b.tick) - strength(a.tick) || a.tick - b.tick)[0].tick;
  /** Corrected notes keep apart from notes at other corrected positions or in other corrected voices. */
  const compatible = (a: readonly WorkNote[], b: readonly WorkNote[]) => a.every(x => b.every(y =>
    !((x.fixedTick || y.fixedTick) && x.tick !== y.tick) && !(x.fixedVoice && y.fixedVoice && x.fixedVoice !== y.fixedVoice) &&
    !((x.fixedVoice ?? 1) !== (y.fixedVoice ?? 1) && (x.fixedVoice || y.fixedVoice))));
  const measureOf = (tick: number) => Math.floor(tick / measureTicks);

  // 1. Corrections.
  const notes: WorkNote[] = source.notes.map(note => {
    const fix = settings.corrections?.[note.id];
    if (!fix) return note;
    corrections++;
    const measureStart = Math.floor(note.tick / measureTicks) * measureTicks;
    return {
      ...note, ...(fix.staff ? { staff: fix.staff } : {}), ...(fix.voice ? { voice: fix.voice } : {}),
      ...(fix.offset !== undefined ? { tick: measureStart + fix.offset, fixedTick: true } : {}), ...(fix.length ? { length: fix.length } : {}),
      ...(fix.voice ? { fixedVoice: fix.voice } : {})
    };
  });

  // 2 and 3. Rolled chords, then chords, per staff.
  const clusters: Cluster[] = [];
  let rolledChords = 0;
  for (const staff of settings.staves) {
    const own = notes.filter(note => note.staff === staff.id).sort((a, b) => a.audioStart - b.audioStart || a.midi - b.midi);
    const items: Cluster[] = [];
    for (let index = 0; index < own.length;) {
      const first = own[index];
      const run = [first];
      const maxTicks = beatLength(beatIndexAt(first.tick % measureTicks)) * settings.roll.maxBeatFraction;
      for (let next = index + 1; next < own.length; next++) {
        const candidate = own[next];
        if (candidate.audioStart - first.audioStart > settings.roll.maxSeconds) break;
        if (candidate.midi <= run.at(-1)!.midi || Math.abs(candidate.tick - first.tick) > maxTicks) break;
        if (measureOf(candidate.tick) !== measureOf(first.tick)) break;
        run.push(candidate);
      }
      const spread = run.at(-1)!.audioStart - first.audioStart;
      const allowed = run.every(note => settings.corrections?.[note.id]?.roll !== false);
      // A roll stands apart: the next attack comes clearly later than the roll's own steps.
      // Otherwise the rising notes are a figure (a chord continuing into a scale).
      const largestStep = Math.max(...run.slice(1).map((note, step) => note.audioStart - run[step].audioStart));
      const after = own[index + run.length];
      const separated = !after || after.audioStart - run.at(-1)!.audioStart >= 2 * largestStep;
      if (run.length >= settings.roll.minNotes && spread >= settings.roll.minSeconds && allowed && separated) {
        // A rolled chord is written where it falls most strongly in the bar.
        const tick = [...run].sort((a, b) => strength(b.tick) - strength(a.tick) || a.tick - b.tick)[0].tick;
        items.push({ staff: staff.id, notes: run, tick, time: first.audioStart, roll: true, voice: 1, end: 0 });
        rolledChords++;
        index += run.length;
      } else {
        items.push({ staff: staff.id, notes: [first], tick: first.tick, time: first.audioStart, roll: false, voice: 1, end: 0 });
        index++;
      }
    }
    // Chords: merge near-simultaneous items whose written positions agree.
    const parent = items.map((_, position) => position);
    const root = (position: number): number => (parent[position] === position ? position : (parent[position] = root(parent[position])));
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length && items[b].time - items[a].time <= settings.chord.seconds; b++) {
      if (Math.abs(items[a].tick - items[b].tick) > settings.chord.ticks) continue;
      if (measureOf(items[a].tick) !== measureOf(items[b].tick)) continue;
      if (!compatible(items[a].notes, items[b].notes)) continue;
      parent[root(b)] = root(a);
    }
    const merged = new Map<number, Cluster>();
    items.forEach((item, position) => {
      const key = root(position);
      const target = merged.get(key);
      if (!target) { merged.set(key, { ...item, notes: [...item.notes] }); return; }
      target.notes.push(...item.notes);
      target.time = Math.min(target.time, item.time);
      target.roll ||= item.roll;
    });
    for (const cluster of merged.values()) if (!cluster.roll) cluster.tick = preferredTick(cluster.notes);
    clusters.push(...merged.values());
  }
  // Both hands striking together share one written position.
  const byTime = [...clusters].sort((a, b) => a.time - b.time);
  for (let a = 0; a < byTime.length; a++) for (let b = a + 1; b < byTime.length && byTime[b].time - byTime[a].time <= settings.chord.alignSeconds; b++) {
    const first = byTime[a], second = byTime[b];
    if (first.staff === second.staff || first.tick === second.tick) continue;
    if (Math.abs(first.tick - second.tick) > settings.chord.ticks || measureOf(first.tick) !== measureOf(second.tick)) continue;
    if ([...first.notes, ...second.notes].some(note => note.fixedTick)) continue;
    const tick = preferredTick([...first.notes, ...second.notes].map(note => ({ ...note, tick: first.notes.includes(note) ? first.tick : second.tick })));
    first.tick = tick;
    second.tick = tick;
  }

  // 4. Grid per staff and beat: sixteenths, or triplets where onsets demand it.
  const tripletBeats = new Set<string>();
  const beatKey = (staff: StaffId, measure: number, beat: number) => `${staff}:${measure}:${beat}`;
  const byBeat = new Map<string, Cluster[]>();
  for (const cluster of clusters) {
    const measure = Math.floor(cluster.tick / measureTicks);
    const beat = beatIndexAt(cluster.tick - measure * measureTicks);
    const key = beatKey(cluster.staff, measure, beat);
    (byBeat.get(key) ?? byBeat.set(key, []).get(key)!).push(cluster);
  }
  for (const [key, members] of byBeat) {
    const [, measureText, beatText] = key.split(':');
    const measure = Number(measureText), beat = Number(beatText);
    const start = measure * measureTicks + beatStarts[beat];
    const length = beatLength(beat);
    const third = length / 3;
    const tripletOnly = members.filter(cluster => {
      const position = cluster.tick - start;
      return Number.isInteger(third) && position % third === 0 && position % sixteenth !== 0;
    }).length;
    const triplet = !structure.compound && tripletOnly >= settings.tripletOnsets;
    if (triplet) tripletBeats.add(key);
    const grid = triplet ? third : sixteenth;
    const measureEnd = (measure + 1) * measureTicks;
    for (const cluster of members) {
      const snapped = start + Math.round((cluster.tick - start) / grid) * grid;
      cluster.tick = Math.min(snapped, measureEnd - grid);
    }
  }
  // Clusters that now share a position in a staff are one chord.
  const positioned = new Map<string, Cluster>();
  for (const cluster of clusters.sort((a, b) => a.time - b.time)) {
    const key = `${cluster.staff}:${cluster.tick}:${cluster.notes.find(note => note.fixedVoice)?.fixedVoice ?? ''}`;
    const existing = positioned.get(key);
    if (existing) { existing.notes.push(...cluster.notes); existing.roll ||= cluster.roll; existing.time = Math.min(existing.time, cluster.time); }
    else positioned.set(key, cluster);
  }
  const chords = [...positioned.values()].sort((a, b) => a.tick - b.tick || a.staff.localeCompare(b.staff));

  // 5. Voices. An inner voice needs a main voice beside it: a staff's bar without one uses voice 1.
  for (const cluster of chords) {
    const forced = cluster.notes.map(note => note.fixedVoice).filter((voice): voice is number => voice !== undefined);
    if (forced.length === cluster.notes.length) cluster.voice = forced[0];
    else cluster.voice = cluster.notes.length === 1 && cluster.notes[0].voice > 1 ? 2 : 1;
  }
  for (const cluster of chords) {
    if (cluster.voice === 1 || cluster.notes.some(note => note.fixedVoice)) continue;
    const measure = measureOf(cluster.tick);
    if (!chords.some(other => other.staff === cluster.staff && other.voice === 1 && measureOf(other.tick) === measure)) cluster.voice = 1;
  }

  // The performed clock, from chords that start on a beat.
  const lastTick = Math.max(...chords.map(cluster => cluster.tick));
  const measureCount = Math.floor(lastTick / measureTicks) + 1;
  const scoreEnd = measureCount * measureTicks;
  const beatPositions: number[] = [];
  for (let measure = 0; measure < measureCount; measure++)
    for (const start of beatStarts) beatPositions.push((measure * measureTicks + start) / wholeTicks);
  beatPositions.push(scoreEnd / wholeTicks);
  const onBeat = (tick: number) => beatStarts.includes(tick % measureTicks);
  const clock = buildBeatClock(beatPositions, chords.filter(cluster => onBeat(cluster.tick))
    .flatMap(cluster => cluster.notes.map(note => ({ position: cluster.tick / wholeTicks, time: note.audioStart }))));
  const tickAt = (time: number) => clock.positionAt(time) * wholeTicks;

  const tickToMeasure = (tick: number) => Math.floor(tick / measureTicks);
  const offsetId = (ticks: number) => F.format(toFraction(ticks));

  /** Written pieces of [from, to) within one measure, as (offset, length, tuplet beat?) in ticks. */
  const pieces = (staff: StaffId, from: number, to: number, isRest: boolean): { start: number; length: number; triplet?: number }[] => {
    const measure = tickToMeasure(from);
    const base = measure * measureTicks;
    const result: { start: number; length: number; triplet?: number }[] = [];
    let at = from;
    while (at < to) {
      const offset = at - base;
      const beat = beatIndexAt(offset);
      const beatStart = base + beatStarts[beat], beatEnd = beatStart + beatLength(beat);
      if (tripletBeats.has(beatKey(staff, measure, beat))) {
        const end = Math.min(to, beatEnd);
        const third = beatLength(beat) / 3;
        // Inside a triplet: one value per piece, at most what the beat holds.
        let length = end - at;
        if (!valueFor(toFraction(length * 1.5))) length = third;
        result.push({ start: at, length, triplet: beat });
        at += length;
        continue;
      }
      // Never run into a later triplet beat.
      let limit = to;
      for (let later = beat + 1; later < beatStarts.length; later++)
        if (tripletBeats.has(beatKey(staff, measure, later))) { limit = Math.min(limit, base + beatStarts[later]); break; }
      const onBeat = at === beatStart;
      const endsOnABeat = (end: number) => beatStarts.some(start => base + start === end) || end === base + measureTicks;
      const candidates = [6, 4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125].map(quarters => quarters * divisions);
      const length = candidates.find(value => {
        if (value > limit - at || !Number.isInteger(value) || !valueFor(toFraction(value))) return false;
        const end = at + value;
        // Off the beat a value stays within its beat, or (syncopation) ends exactly on a later one.
        if (!onBeat) return end <= beatEnd || (settings.syncopation && !isRest && endsOnABeat(end));
        // From a beat: whole beats, or a dotted value reaching into the next beat (notes only).
        const endsOnBeat = beatPositions.includes(end / wholeTicks) || end === base + measureTicks;
        return value <= beatEnd - at || endsOnBeat || (!isRest && value === beatLength(beat) * 1.5);
      }) ?? Math.min(sixteenth, limit - at);
      result.push({ start: at, length });
      at += length;
    }
    return result;
  };

  // 6. Written ends: to the next onset in the voice, tied over barlines only while sounding.
  let ties = 0;
  const voiceKey = (cluster: Cluster) => `${cluster.staff}:${cluster.voice}`;
  const byVoice = new Map<string, Cluster[]>();
  for (const cluster of chords) (byVoice.get(voiceKey(cluster)) ?? byVoice.set(voiceKey(cluster), []).get(voiceKey(cluster))!).push(cluster);
  for (const list of byVoice.values()) {
    list.forEach((cluster, position) => {
      const next = list[position + 1]?.tick ?? scoreEnd;
      const measureEnd = (Math.floor(cluster.tick / measureTicks) + 1) * measureTicks;
      const fixed = cluster.notes.map(note => note.length).find(length => length !== undefined);
      if (fixed !== undefined) { cluster.end = Math.min(cluster.tick + fixed, next); return; }
      const sounding = Math.max(...cluster.notes.map(note => note.audioEnd - note.audioStart));
      const soundsUntil = Math.max(...cluster.notes.map(note => tickAt(note.audioEnd)));
      const writtenUntil = Math.max(...cluster.notes.map(note => cluster.tick + (note.sourceLength ?? 0)));
      // A note lasts to the next onset (or the barline), unless its sound clearly stopped where a
      // single written value would end; the rest of the gap is then silence.
      const target = Math.min(next, measureEnd);
      const first = pieces(cluster.staff, cluster.tick, target, false)[0];
      const firstEnd = first.start + first.length;
      const released = firstEnd < target && soundsUntil <= firstEnd && writtenUntil <= firstEnd && sounding < settings.tieSeconds;
      if (released) { cluster.end = firstEnd; return; }
      if (next <= measureEnd) { cluster.end = next; return; }
      const holds = sounding >= settings.tieSeconds && (soundsUntil > measureEnd || writtenUntil > measureEnd);
      if (holds) {
        // Hold on to the beat where the sound (or the written note) stops, but never past the next onset.
        const until = Math.max(soundsUntil, writtenUntil);
        const beatEnd = beatPositions.map(position => position * wholeTicks).find(tick => tick >= until - 1e-6) ?? scoreEnd;
        cluster.end = Math.min(next, Math.max(measureEnd, beatEnd));
      } else cluster.end = measureEnd;
    });
  }

  // Build events, voice by voice and measure by measure.
  const events: ScoreEvent[] = [];
  const tuplets = new Map<string, Tuplet>();
  const spanners: Spanner[] = [];
  const attachments: Attachment[] = [];
  const timing: Record<string, NoteTimingRecord> = {};
  const staffOrder = settings.staves.map(staff => staff.id);
  const tupletFor = (staff: StaffId, voice: number, measure: number, beat: number): string => {
    const id = `t.${staff}.${measure + 1}.${voice}.${beat}`;
    if (!tuplets.has(id)) tuplets.set(id, { id, actual: 3, normal: 2, provenance: { origin: 'inferred', rule: 'triplet-beat' } });
    return id;
  };

  const valueOf = (length: number, triplet: boolean): NoteValue => {
    const written = valueFor(toFraction(triplet ? length * 1.5 : length));
    if (!written) throw new Error(`No note value for ${length} ticks`);
    return written;
  };

  const spell = (note: WorkNote): Pitch => {
    if (note.spelling) {
      const pitch = parsePitch(note.spelling);
      if (midiOf(pitch) === note.midi) return pitch;
    }
    const options = spellings(note.midi);
    return options.find(option => option.alter === keyAlteration(settings.key, option.step)) ??
      options.find(option => (settings.key.fifths < 0 ? option.alter <= 0 : option.alter >= 0)) ?? options[0];
  };

  for (const staff of staffOrder) {
    const voices = [...new Set(chords.filter(cluster => cluster.staff === staff).map(cluster => cluster.voice))].sort();
    for (const voice of voices) {
      const list = byVoice.get(`${staff}:${voice}`) ?? [];
      let cursor = 0;
      const fill = (from: number, to: number) => {
        // Silence: rests in the main voice, invisible time in the others, measure by measure.
        for (let at = from; at < to;) {
          const measureEnd = (tickToMeasure(at) + 1) * measureTicks;
          const end = Math.min(to, measureEnd);
          // A voice other than the first that is silent for a whole measure leaves no trace there.
          const measureEmpty = voice > 1 && !list.some(cluster => tickToMeasure(cluster.tick) === tickToMeasure(at));
          const wholeMeasure = at % measureTicks === 0 && end - at === measureTicks;
          if (voice === 1 && wholeMeasure) {
            // A silent bar takes one whole-bar rest, whatever the meter.
            const measure = tickToMeasure(at);
            events.push({ id: `r.${staff}.${measure + 1}.${voice}.0`, kind: 'rest', measure, staff, voice, offset: F.ZERO,
              value: { base: 'whole', dots: 0 }, fullBar: true });
          } else if (!measureEmpty) {
            for (const piece of pieces(staff, at, end, true)) {
              const measure = tickToMeasure(piece.start);
              const offset = piece.start - measure * measureTicks;
              const id = `${voice === 1 ? 'r' : 's'}.${staff}.${measure + 1}.${voice}.${offsetId(offset)}`;
              const base = { id, measure, staff, voice, offset: toFraction(offset),
                ...(piece.triplet !== undefined ? { tuplet: tupletFor(staff, voice, measure, piece.triplet) } : {}) };
              if (voice === 1) events.push({ ...base, kind: 'rest', value: valueOf(piece.length, piece.triplet !== undefined) });
              else events.push({ ...base, kind: 'space', length: toFraction(piece.length) });
            }
          }
          at = end;
        }
      };
      for (const cluster of list) {
        if (cluster.tick > cursor) fill(cursor, cluster.tick);
        // One written chord per piece; pieces after the first continue the sound through ties.
        const segments: { start: number; length: number; triplet?: number }[] = [];
        for (let at = cluster.tick; at < cluster.end;) {
          const measureEnd = (tickToMeasure(at) + 1) * measureTicks;
          segments.push(...pieces(staff, at, Math.min(cluster.end, measureEnd), false));
          at = Math.min(cluster.end, measureEnd);
        }
        const sorted = [...cluster.notes].sort((a, b) => a.midi - b.midi);
        let previous: Note[] | undefined;
        segments.forEach((segment, index) => {
          const measure = tickToMeasure(segment.start);
          const offset = segment.start - measure * measureTicks;
          const eventId = `${staff}.${measure + 1}.${voice}.${offsetId(offset)}`;
          const notesHere: Note[] = sorted.map(note => ({
            id: index === 0 ? note.id : `${note.id}~${index + 1}`, pitch: spell(note),
            provenance: { origin: 'imported' as const }
          }));
          const event: ChordEvent = {
            id: eventId, kind: 'chord', measure, staff, voice, offset: toFraction(offset),
            value: valueOf(segment.length, segment.triplet !== undefined), notes: notesHere,
            ...(segment.triplet !== undefined ? { tuplet: tupletFor(staff, voice, measure, segment.triplet) } : {})
          };
          events.push(event);
          if (previous) {
            previous.forEach((note, position) => {
              spanners.push({ id: `tie@${note.id}`, kind: 'tie', start: { note: note.id }, end: { note: notesHere[position].id },
                provenance: { origin: 'inferred', rule: 'sounding-across' } });
            });
            ties += previous.length;
          }
          // Timing: the attack is the recording's; a continuation starts when its beat comes.
          const position = segment.start / wholeTicks;
          const glide = clock.timeAt(position + segment.length / wholeTicks) - clock.timeAt(position);
          sorted.forEach((note, position2) => {
            const start = index === 0 ? note.audioStart : clock.timeAt(position);
            timing[notesHere[position2].id] = { start, glideEnd: start + glide, soundingEnd: Math.max(note.audioEnd, start + glide) };
          });
          if (index === 0 && cluster.roll) {
            attachments.push({ id: `arp@${eventId}`, kind: 'arp.plain', anchor: { event: eventId },
              provenance: { origin: 'inferred', rule: 'rolled-chord', confidence: 0.8 } });
          }
          previous = notesHere;
        });
        cursor = cluster.end;
      }
      if (cursor < scoreEnd) fill(cursor, scoreEnd);
    }
  }

  const measures: Measure[] = Array.from({ length: measureCount }, (_, index) => ({
    number: index + 1, ...(index === 0 ? { time: settings.time, key: settings.key } : {}),
    ...(index === measureCount - 1 ? { end: 'barline.final' as const } : {})
  }));
  const score: Score = {
    schema: 1,
    meta: { title: settings.title, ...(settings.composer ? { composer: settings.composer } : {}), ...(settings.source ? { source: settings.source } : {}) },
    staves: settings.staves,
    groups: settings.group === 'none' ? [] : [{ kind: settings.group, staves: staffOrder }],
    measures,
    events: events.sort((a, b) => a.measure - b.measure || F.compare(a.offset, b.offset)),
    tuplets: [...tuplets.values()],
    clefs: [],
    attachments,
    spanners
  };
  return {
    score,
    timing: { notes: timing, beats: clock.beats },
    clock,
    report: { rolledChords, tripletBeats: tripletBeats.size, ties, corrections }
  };
}
