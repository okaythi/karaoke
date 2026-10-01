import score from '../data/score/itsumo-notation.json';
import corrections from '../data/score/itsumo-notation-overrides.json';
import type { ClassifiedNote, SemanticVoice } from './model';

export interface NotationEvent {
  performanceId: string;
  pitch: number;
  scoreStart: number;
  scoreDuration: number;
  duration: string;
  dotted: boolean;
  measure: number;
  beat: number;
  onsetErrorMs: number;
  spelling?: string;
}

export interface EngravedEvent extends NotationEvent {
  performance: ClassifiedNote;
  semanticVoice: SemanticVoice;
}

export const NOTATION_METER = { numerator: 3, denominator: 4 } as const;
export const NOTATION_KEY = 'E';
const ATTACK_WINDOW_SECONDS = .03;
export const notationEvents: NotationEvent[] = (score.events as NotationEvent[]).map(event => {
  const override = (corrections as Record<string, Partial<NotationEvent>>)[event.performanceId] || {};
  const corrected = { ...event, ...override, performanceId: event.performanceId, pitch: event.pitch };
  return { ...corrected, measure: Math.floor(corrected.scoreStart / 3), beat: corrected.scoreStart % 3 };
});
export const engravingBeatGrid = score.beatGridSeconds as number[];

// Written durations follow the next attack in the same musical line. MIDI
// releases and pedal tails remain exclusively in the performance model.
function inferWrittenDurations(events: EngravedEvent[]): void {
  const byVoice = new Map<SemanticVoice, Map<number, EngravedEvent[]>>();
  for (const event of events) {
    if (event.semanticVoice === 'ignore') continue;
    let attacks = byVoice.get(event.semanticVoice);
    if (!attacks) { attacks = new Map(); byVoice.set(event.semanticVoice, attacks); }
    const chord = attacks.get(event.scoreStart) || [];
    chord.push(event); attacks.set(event.scoreStart, chord);
  }
  for (const attacks of byVoice.values()) {
    const starts = [...attacks.keys()].sort((a, b) => a - b);
    starts.forEach((start, index) => {
      const next = starts[index + 1];
      const untilBarline = 3 - start % 3;
      const span = next === undefined || next - start > 3 ? untilBarline : next - start;
      const written = Math.max(.25, Math.min(3, span));
      for (const event of attacks.get(start)!) {
        const correction = (corrections as Record<string, Partial<NotationEvent>>)[event.performanceId];
        event.scoreDuration = correction?.scoreDuration ?? written;
        const single = [[3, 'h', true], [2, 'h', false], [1.5, 'q', true], [1, 'q', false], [.75, '8', true], [.5, '8', false], [.25, '16', false]] as const;
        const glyph = single.find(([length]) => length === event.scoreDuration);
        event.duration = glyph?.[1] || 'tied';
        event.dotted = glyph?.[2] || false;
      }
    });
  }
}

export function linkNotation(notes: ClassifiedNote[]): EngravedEvent[] {
  const byId = new Map(notes.map(note => [note.id, note]));
  if (byId.size !== notes.length) throw new Error('Duplicate MIDI source IDs');
  const linked = new Set<string>();
  const onsetPositions = new Map<number, number>();
  const result = notationEvents.map(event => {
    const performance = byId.get(event.performanceId);
    if (!performance) throw new Error(`Notation event ${event.performanceId} has no MIDI performance event`);
    if (linked.has(event.performanceId)) throw new Error(`Duplicate notation event for ${event.performanceId}`);
    if (event.pitch !== performance.pitch) throw new Error(`Pitch mismatch for ${event.performanceId}`);
    const sharedStart = onsetPositions.get(performance.startTick);
    if (sharedStart !== undefined && sharedStart !== event.scoreStart) {
      throw new Error(`Simultaneous MIDI onset split in notation: ${event.performanceId}`);
    }
    onsetPositions.set(performance.startTick, event.scoreStart);
    linked.add(event.performanceId);
    return { ...event, performance, semanticVoice: performance.semanticVoice };
  });
  if (linked.size !== byId.size) throw new Error('MIDI source events missing from notation');
  const scoreById = new Map(result.map(event => [event.performanceId, event.scoreStart]));
  let attackStart = -Infinity;
  let attackScore = -Infinity;
  let attackPitches = new Set<string>();
  for (const note of [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)) {
    const pitchKey = `${note.channel}:${note.pitch}`;
    const scoreStart = scoreById.get(note.id)!;
    if (note.startTime - attackStart > ATTACK_WINDOW_SECONDS || attackPitches.has(pitchKey)) {
      attackStart = note.startTime;
      attackScore = scoreStart;
      attackPitches = new Set();
    } else if (scoreStart !== attackScore) {
      throw new Error(`MIDI attack split in notation: ${note.id}`);
    }
    attackPitches.add(pitchKey);
  }
  inferWrittenDurations(result);
  return result;
}
