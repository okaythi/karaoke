import timingMap from '../data/score/itsumo-karaoke-map.json';

export interface SourceSegment {
  measure: number;
  offsetTicks: number;
  durationTicks: number;
  voice: number;
  staff: number;
  tie: string | null;
}

export interface SourceNote {
  id: string;
  soundingMidi: number;
  audioStart: number;
  audioEnd: number;
  staff: number;
  scoreStartTick: number;
  segments: readonly SourceSegment[];
}

export interface EngravingPitch {
  sourceId: string;
  soundingMidi: number;
  writtenMidi: number;
  key: string;
  displayStaff: number;
}

export interface EngravingNote {
  measure: number;
  staff: number;
  displayVoice: number;
  offsetTicks: number;
  writtenDuration: string;
  dotCount: number;
  chordId: string;
  beamGroup?: string;
  tupletGroup?: string;
  ottavaSpan?: string;
  arpeggio?: boolean;
  crossStaffBassCount?: number;
  pitches: EngravingPitch[];
}

export interface OttavaSpan {
  id: string;
  staff: number;
  firstMeasure: number;
  lastMeasure: number;
  octaveShift: number;
}

export interface BeatClock {
  /** Media time at an absolute score tick; the tempo is constant within each beat. */
  timeAt(tick: number): number;
}

export interface EngravingScore {
  readonly sources: ReadonlyMap<string, SourceNote>;
  readonly notes: readonly EngravingNote[];
  readonly ottavas: readonly OttavaSpan[];
  readonly clefs: ReadonlyMap<string, 'treble' | 'bass'>;
  readonly measures: number;
  readonly clock: BeatClock;
  /** Beats that carry a performed attack; see attackedBeats. */
  readonly beats: readonly { beat: number; time: number }[];
}

interface RawMapNote {
  id: string; midi: number; audioStart: number; audioEnd: number;
  staff: number; scoreStartTick: number; segments: SourceSegment[];
}

const BAR_TICKS = timingMap.score.measureTicks;
const BEAT_TICKS = timingMap.score.divisionsPerQuarter;
const QUANTUM = 120; // A sixteenth note in the source's 480 divisions per quarter.
const DURATION_TICKS: Record<string, number> = { h: 960, q: 480, '8': 240, '16': 120 };
const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const VALUES: { ticks: number; duration: string; dots: number }[] = [
  { ticks: 1440, duration: 'h', dots: 1 },
  { ticks: 960, duration: 'h', dots: 0 },
  { ticks: 720, duration: 'q', dots: 1 },
  { ticks: 480, duration: 'q', dots: 0 },
  { ticks: 360, duration: '8', dots: 1 },
  { ticks: 240, duration: '8', dots: 0 },
  { ticks: 120, duration: '16', dots: 0 }
];

/** The engraved value of a note in score ticks, including dots and triplets. */
export function noteValueTicks(note: EngravingNote): number {
  if (note.tupletGroup) return 160;
  const ticks = DURATION_TICKS[note.writtenDuration] ?? QUANTUM;
  return note.dotCount ? ticks * 1.5 : ticks;
}

function noteTick(note: EngravingNote): number {
  return (note.measure - 1) * BAR_TICKS + note.offsetTicks;
}

/**
 * The window in which a notehead glides. It starts when the performance
 * reaches the note: the source attack, or the barline for a tied
 * continuation. It lasts the note's written value at the local tempo.
 */
export function glideWindow(score: EngravingScore, note: EngravingNote, source: SourceNote): { start: number; end: number } {
  const tick = noteTick(note);
  const duration = score.clock.timeAt(tick + noteValueTicks(note)) - score.clock.timeAt(tick);
  const start = source.segments[0].measure === note.measure ? source.audioStart : score.clock.timeAt(tick);
  return { start, end: start + duration };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The performed beats: attacks that fall on a beat, as {beat, media time}.
 * Beats without an attack (sustains, rests) are absent.
 */
export function attackedBeats(notes: readonly EngravingNote[], sources: ReadonlyMap<string, SourceNote>): { beat: number; time: number }[] {
  const attacks = new Map<number, number[]>();
  for (const note of notes) {
    const tick = noteTick(note);
    if (tick % BEAT_TICKS) continue;
    for (const pitch of note.pitches) {
      const source = sources.get(pitch.sourceId)!;
      if (source.segments[0].measure !== note.measure) continue;
      const times = attacks.get(tick / BEAT_TICKS) || [];
      times.push(source.audioStart); attacks.set(tick / BEAT_TICKS, times);
    }
  }
  // Transcription noise can place a beat at or before its predecessor;
  // such beats are dropped and filled by interpolation instead.
  const known: { beat: number; time: number }[] = [];
  for (const beat of [...attacks.keys()].sort((a, b) => a - b)) {
    const time = median(attacks.get(beat)!);
    if (!known.length || time > known.at(-1)!.time) known.push({ beat, time });
  }
  return known;
}

/**
 * Derives the performed beat grid from attacks that fall on a beat. Beats
 * without an attack are interpolated between their neighbours, and the
 * ends are extrapolated from the nearest known tempo.
 */
function buildBeatClock(known: readonly { beat: number; time: number }[], measures: number): BeatClock {
  const beatCount = measures * (BAR_TICKS / BEAT_TICKS) + 1;
  const times = new Float64Array(beatCount);
  if (known.length < 2) {
    const start = known[0]?.time ?? 0;
    times.forEach((_, beat) => { times[beat] = start + beat * 0.5; });
  } else {
    const first = known[0], second = known[1];
    const leading = (second.time - first.time) / (second.beat - first.beat);
    const tail = known.slice(-4);
    const trailing = (tail.at(-1)!.time - tail[0].time) / (tail.at(-1)!.beat - tail[0].beat);
    let segment = 0;
    for (let beat = 0; beat < beatCount; beat++) {
      while (segment < known.length - 2 && known[segment + 1].beat <= beat) segment++;
      const before = known[segment], after = known[segment + 1];
      if (beat < first.beat) times[beat] = first.time - (first.beat - beat) * leading;
      else if (beat > known.at(-1)!.beat) times[beat] = known.at(-1)!.time + (beat - known.at(-1)!.beat) * trailing;
      else times[beat] = before.time + (after.time - before.time) * (beat - before.beat) / (after.beat - before.beat);
    }
  }
  const last = beatCount - 1;
  const finalBeat = times[last] - times[last - 1];
  return {
    timeAt(tick: number): number {
      const position = Math.max(0, tick / BEAT_TICKS);
      const beat = Math.floor(position);
      if (beat >= last) return times[last] + (position - last) * finalBeat;
      return times[beat] + (times[beat + 1] - times[beat]) * (position - beat);
    }
  };
}

function pitchKey(midi: number): string {
  return `${PITCH_NAMES[midi % 12]}/${Math.floor(midi / 12) - 1}`;
}

function chooseValue(available: number): { ticks: number; duration: string; dots: number } {
  return VALUES.find(value => value.ticks <= available) || VALUES.at(-1)!;
}

function sourceNotes(): Map<string, SourceNote> {
  return new Map((timingMap.notes as RawMapNote[]).map(item => [item.id, Object.freeze({
    id: item.id,
    soundingMidi: item.midi,
    audioStart: item.audioStart,
    audioEnd: item.audioEnd,
    staff: item.staff,
    scoreStartTick: item.scoreStartTick,
    segments: item.segments.map(segment => Object.freeze({ ...segment }))
  })]));
}

function generatedOttavas(sources: ReadonlyMap<string, SourceNote>): OttavaSpan[] {
  const highByMeasure = new Map<string, { high: number; total: number; max: number }>();
  for (const source of sources.values()) {
    const measure = source.segments[0].measure;
    const key = `${source.staff}:${measure}`;
    const count = highByMeasure.get(key) || { high: 0, total: 0, max: 0 };
    count.total++;
    if (source.soundingMidi >= (source.staff === 1 ? 83 : 72)) count.high++;
    count.max = Math.max(count.max, source.soundingMidi);
    highByMeasure.set(key, count);
  }
  const spans: OttavaSpan[] = [];
  for (const staff of [1, 2]) {
    const marked = [...highByMeasure.entries()]
      .filter(([key, data]) => key.startsWith(`${staff}:`) &&
        (staff === 1 ? data.high >= 2 && data.max >= 88 : data.max >= 75))
      .map(([key]) => Number(key.split(':')[1])).sort((a, b) => a - b);
    for (const measure of marked) {
      const last = spans.at(-1);
      if (last?.staff === staff && measure === last.lastMeasure + 1) last.lastMeasure = measure;
      else spans.push({ id: `ottava-${staff}-${measure}`, staff, firstMeasure: measure, lastMeasure: measure, octaveShift: -12 });
    }
    for (const span of spans.filter(item => item.staff === staff && item.lastMeasure > item.firstMeasure)) {
      const threshold = staff === 1 ? 88 : 75;
      while ((highByMeasure.get(`${staff}:${span.firstMeasure - 1}`)?.max || 0) >= threshold) span.firstMeasure--;
      while ((highByMeasure.get(`${staff}:${span.lastMeasure + 1}`)?.max || 0) >= threshold) span.lastMeasure++;
    }
  }
  // A complete triplet run inside one bar is a passage, even if it is only
  // one measure long. The lower staff remains in bass clef throughout.
  const requestedSpans: OttavaSpan[] = [
    { id: 'ottava-bass-61-64', staff: 2, firstMeasure: 61, lastMeasure: 64, octaveShift: -12 },
    { id: 'ottava-bass-77-81', staff: 2, firstMeasure: 77, lastMeasure: 81, octaveShift: -12 },
    { id: 'ottava-treble-ending', staff: 1, firstMeasure: 177, lastMeasure: 177, octaveShift: -12 }
  ];
  return [...spans.filter(span =>
    (span.staff === 2 || span.lastMeasure > span.firstMeasure ||
      (highByMeasure.get(`1:${span.firstMeasure}`)?.high || 0) >= 3) &&
    !requestedSpans.some(requested => requested.staff === span.staff &&
      span.firstMeasure <= requested.lastMeasure && span.lastMeasure >= requested.firstMeasure)),
  ...requestedSpans];
}

function displayStaff(source: SourceNote, measure: number): number {
  // The ending's low notes belong visually on the bass staff even though the
  // transcription assigned them to the upper staff.
  return source.staff === 1 && measure >= 171 && measure <= 175 && source.soundingMidi <= 64 ? 2 : source.staff;
}

function visibleSegment(source: SourceNote, segment: SourceSegment): boolean {
  // Very short transcription notes sometimes carry synthetic ties into later
  // measures. Those fragments outlive the sound and create phantom notation.
  return segment.measure === source.segments[0].measure ||
    source.audioEnd - source.audioStart >= 0.75;
}

function normalizedOffsets(sources: ReadonlyMap<string, SourceNote>): Map<string, number> {
  const byMeasure = new Map<number, { source: SourceNote; segment: SourceSegment }[]>();
  for (const source of sources.values()) {
    const seen = new Set<number>();
    for (const segment of source.segments) {
      if (seen.has(segment.measure)) continue;
      seen.add(segment.measure);
      const entries = byMeasure.get(segment.measure) || [];
      entries.push({ source, segment }); byMeasure.set(segment.measure, entries);
    }
  }
  const offsets = new Map<string, number>();
  for (const [measure, entries] of byMeasure) {
    const parent = entries.map((_, index) => index);
    const minOffset = entries.map(entry => entry.segment.offsetTicks);
    const maxOffset = [...minOffset];
    const minTime = entries.map(entry => entry.source.audioStart);
    const maxTime = [...minTime];
    const root = (index: number): number => {
      while (parent[index] !== index) index = parent[index] = parent[parent[index]];
      return index;
    };
    for (let left = 0; left < entries.length; left++) for (let right = left + 1; right < entries.length; right++) {
      const a = entries[left], b = entries[right];
      if (Math.abs(a.segment.offsetTicks - b.segment.offsetTicks) > 160) continue;
      if (Math.abs(a.source.audioStart - b.source.audioStart) > 0.12) continue;
      if (a.segment.voice === b.segment.voice && a.segment.staff === b.segment.staff) continue;
      const leftRoot = root(left), rightRoot = root(right);
      if (leftRoot === rightRoot) continue;
      const startOffset = Math.min(minOffset[leftRoot], minOffset[rightRoot]);
      const endOffset = Math.max(maxOffset[leftRoot], maxOffset[rightRoot]);
      const startTime = Math.min(minTime[leftRoot], minTime[rightRoot]);
      const endTime = Math.max(maxTime[leftRoot], maxTime[rightRoot]);
      if (endOffset - startOffset > 160 || endTime - startTime > 0.12) continue;
      parent[rightRoot] = leftRoot;
      minOffset[leftRoot] = startOffset; maxOffset[leftRoot] = endOffset;
      minTime[leftRoot] = startTime; maxTime[leftRoot] = endTime;
    }
    const earliest = new Map<number, number>();
    entries.forEach((entry, index) => {
      const group = root(index);
      earliest.set(group, Math.min(earliest.get(group) ?? Infinity, entry.segment.offsetTicks));
    });
    entries.forEach((entry, index) => {
      const raw = earliest.get(root(index))!;
      const tripletPassage = entry.segment.staff === 1 && measure >= 82 && measure <= 85;
      const rolledChord = (measure === 167 && ['n1628', 'n1629', 'n1630', 'n1631'].includes(entry.source.id)) ||
        (measure === 170 && ['n1659', 'n1660', 'n1661', 'n1662', 'n1663'].includes(entry.source.id));
      const endingFlourish = measure === 177 && entry.source.id === 'n1710' ? 120 :
        measure === 177 && entry.source.id === 'n1711' ? 240 : undefined;
      offsets.set(`${entry.source.id}:${measure}`, endingFlourish ?? (rolledChord ? 0 : tripletPassage ? entry.segment.offsetTicks :
        Math.max(0, Math.min(BAR_TICKS - QUANTUM, Math.round(raw / QUANTUM) * QUANTUM))));
    });
  }
  return offsets;
}

export function buildEngravingScore(): EngravingScore {
  const sources = sourceNotes();
  const ottavas = generatedOttavas(sources);
  const clefs = new Map<string, 'treble' | 'bass'>();
  const offsets = normalizedOffsets(sources);
  const bins = new Map<string, Map<number, SourceNote[]>>();
  for (const source of sources.values()) {
    const seen = new Set<number>();
    for (const segment of source.segments) {
      if (!visibleSegment(source, segment)) continue;
      // A source note may be fragmented for transcription ties. One visible
      // note per measure is enough; its original source identity remains linked.
      if (seen.has(segment.measure)) continue;
      seen.add(segment.measure);
      const key = `${segment.measure}:${displayStaff(source, segment.measure)}`;
      const staffOffsets = bins.get(key) || new Map<number, SourceNote[]>();
      const quantized = offsets.get(`${source.id}:${segment.measure}`)!;
      const group = staffOffsets.get(quantized) || [];
      group.push(source); staffOffsets.set(quantized, group); bins.set(key, staffOffsets);
    }
  }
  const notes: EngravingNote[] = [];
  for (const [key, offsets] of bins) {
    const [measure, staff] = key.split(':').map(Number);
    const ordered = [...offsets.keys()].sort((a, b) => a - b);
    const ottava = ottavas.find(span => span.staff === staff && measure >= span.firstMeasure && measure <= span.lastMeasure);
    for (let index = 0; index < ordered.length; index++) {
      const offsetTicks = ordered[index];
      const until = ordered[index + 1] ?? BAR_TICKS;
      const triplet = staff === 1 && measure >= 82 && measure <= 85 && offsetTicks % 160 === 0;
      const value = triplet ? { duration: '8', dots: 0 } : chooseValue(until - offsetTicks);
      const pitches = offsets.get(offsetTicks)!
        .sort((a, b) => a.soundingMidi - b.soundingMidi || a.id.localeCompare(b.id))
        .map(source => {
          const writtenMidi = source.soundingMidi + (ottava?.octaveShift || 0);
          const crossStaffBass = measure === 170 && staff === 1 && offsetTicks === 0 &&
            [68, 71, 75].includes(source.soundingMidi);
          return { sourceId: source.id, soundingMidi: source.soundingMidi, writtenMidi,
            key: pitchKey(writtenMidi), displayStaff: crossStaffBass ? 2 : staff };
        });
      const auxiliary = pitches.length === 1 && offsets.get(offsetTicks)![0].segments
        .some(segment => segment.measure === measure && segment.offsetTicks === offsetTicks && segment.voice > 1);
      const engravingNote: EngravingNote = { measure, staff, displayVoice: auxiliary ? 2 : 1, offsetTicks,
        writtenDuration: value.duration, dotCount: value.dots,
        chordId: `chord-${measure}-${staff}-${offsetTicks}`,
        tupletGroup: triplet ? `triplet-${measure}-${staff}-${Math.floor(offsetTicks / 480)}` : undefined,
        arpeggio: staff === 1 && offsetTicks === 0 && [
          { measure: 19, midis: [69, 76, 81] },
          { measure: 54, midis: [69, 76, 81] },
          { measure: 167, midis: [76, 80, 83, 88] },
          { measure: 168, midis: [71, 75, 78, 83, 87] },
          { measure: 170, midis: [68, 71, 75, 80, 92] }
        ].some(pattern => pattern.measure === measure && pattern.midis.every(midi =>
          pitches.some(pitch => pitch.soundingMidi === midi))),
        crossStaffBassCount: measure === 170 && staff === 1 && offsetTicks === 0 ? 3 : undefined,
        ottavaSpan: ottava?.id, pitches };
      if (measure === 177 && staff === 1) {
        // The ending's sustained B and two short upper notes are separate
        // voices; the 8va belongs to the flourish alone.
        const sustain = pitches[0].sourceId === 'n1709';
        engravingNote.displayVoice = sustain ? 2 : 1;
        engravingNote.writtenDuration = sustain ? 'h' : '16';
        engravingNote.dotCount = sustain ? 1 : 0;
        if (sustain) {
          pitches[0] = { ...pitches[0], writtenMidi: pitches[0].soundingMidi,
            key: pitchKey(pitches[0].soundingMidi) };
          engravingNote.ottavaSpan = undefined;
        }
      }
      notes.push(engravingNote);
    }
  }
  notes.sort((a, b) => a.measure - b.measure || a.offsetTicks - b.offsetTicks || a.staff - b.staff);
  // Beams are display decisions made after rhythms and voices are settled.
  for (const key of bins.keys()) {
    const [measure, staff] = key.split(':').map(Number);
    for (const displayVoice of [1, 2]) {
      const line = notes.filter(note => note.measure === measure && note.staff === staff && note.displayVoice === displayVoice)
        .sort((a, b) => a.offsetTicks - b.offsetTicks);
      for (let index = 0; index < line.length; index++) {
        const note = line[index];
        if (!['8', '16'].includes(note.writtenDuration)) continue;
        const beat = Math.floor(note.offsetTicks / 480);
        const sameBeat = (other: EngravingNote | undefined) => other &&
          Math.floor(other.offsetTicks / 480) === beat &&
          ['8', '16'].includes(other.writtenDuration);
        if (sameBeat(line[index - 1]) || sameBeat(line[index + 1]))
          note.beamGroup = `beam-${measure}-${staff}-${displayVoice}-${beat}`;
      }
    }
  }
  // A final transcription-only tail can contain no visible notes after
  // removing short source fragments. Do not engrave an empty closing bar.
  const measures = Math.max(...notes.map(note => note.measure));
  const beats = attackedBeats(notes, sources);
  return { sources, notes, ottavas, clefs, measures, beats, clock: buildBeatClock(beats, measures) };
}

export const engravingScore = buildEngravingScore();
