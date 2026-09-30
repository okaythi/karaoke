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
export const notationEvents: NotationEvent[] = (score.events as NotationEvent[]).map(event => {
  const override = (corrections as Record<string, Partial<NotationEvent>>)[event.performanceId] || {};
  const corrected = { ...event, ...override, performanceId: event.performanceId, pitch: event.pitch };
  return { ...corrected, measure: Math.floor(corrected.scoreStart / 3), beat: corrected.scoreStart % 3 };
});
export const engravingBeatGrid = score.beatGridSeconds as number[];

export function linkNotation(notes: ClassifiedNote[]): EngravedEvent[] {
  const byId = new Map(notes.map(note => [note.id, note]));
  return notationEvents.map(event => {
    const performance = byId.get(event.performanceId);
    if (!performance) throw new Error(`Notation event ${event.performanceId} has no MIDI performance event`);
    return { ...event, performance, semanticVoice: performance.semanticVoice };
  });
}
