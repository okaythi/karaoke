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
  pitches: EngravingPitch[];
}

export interface OttavaSpan {
  id: string;
  staff: number;
  firstMeasure: number;
  lastMeasure: number;
  octaveShift: number;
}

export interface EngravingScore {
  readonly sources: ReadonlyMap<string, SourceNote>;
  readonly notes: readonly EngravingNote[];
  readonly ottavas: readonly OttavaSpan[];
  readonly clefs: ReadonlyMap<string, 'treble' | 'bass'>;
  readonly measures: number;
}

interface RawMapNote {
  id: string; midi: number; audioStart: number; audioEnd: number;
  staff: number; scoreStartTick: number; segments: SourceSegment[];
}

const BAR_TICKS = timingMap.score.measureTicks;
const QUANTUM = 120; // A sixteenth note in the source's 480 divisions per quarter.
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
  return spans.filter(span => span.staff === 2 || span.lastMeasure > span.firstMeasure ||
    (highByMeasure.get(`1:${span.firstMeasure}`)?.high || 0) >= 3);
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
      offsets.set(`${entry.source.id}:${measure}`, tripletPassage ? entry.segment.offsetTicks :
        Math.max(0, Math.min(BAR_TICKS - QUANTUM, Math.round(raw / QUANTUM) * QUANTUM)));
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
      // A source note may be fragmented for transcription ties. One visible
      // note per measure is enough; its original source identity remains linked.
      if (seen.has(segment.measure)) continue;
      seen.add(segment.measure);
      const key = `${segment.measure}:${segment.staff}`;
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
          return { sourceId: source.id, soundingMidi: source.soundingMidi, writtenMidi, key: pitchKey(writtenMidi) };
        });
      const auxiliary = pitches.length === 1 && offsets.get(offsetTicks)![0].segments
        .some(segment => segment.measure === measure && segment.offsetTicks === offsetTicks && segment.voice > 1);
      notes.push({ measure, staff, displayVoice: auxiliary ? 2 : 1, offsetTicks,
        writtenDuration: value.duration, dotCount: value.dots,
        chordId: `chord-${measure}-${staff}-${offsetTicks}`,
        tupletGroup: triplet ? `triplet-${measure}-${staff}-${Math.floor(offsetTicks / 480)}` : undefined,
        ottavaSpan: ottava?.id, pitches });
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
  return { sources, notes, ottavas, clefs, measures: timingMap.score.measures };
}

export const engravingScore = buildEngravingScore();
