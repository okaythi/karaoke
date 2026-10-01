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
  return result;
}
