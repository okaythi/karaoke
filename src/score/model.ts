export type SemanticVoice = 'main' | 'response' | 'leftHand' | 'ignore';

export interface PedalInterval {
  channel: number;
  startTick: number;
  endTick: number;
  startTime: number;
  endTime: number;
}

export interface MidiNote {
  id: string;
  pitch: number;
  channel: number;
  velocity: number;
  startTick: number;
  endTick: number;
  startTime: number;
  endTime: number;
  soundingEndTime: number;
  soundingEndTick: number;
  source: 'transkun';
}

export interface ClassifiedNote extends MidiNote {
  semanticVoice: SemanticVoice;
  confidence: number;
  reason: string;
  provenance: 'automatic' | 'manual';
  mediaStartTime: number;
  mediaEndTime: number;
  mediaSoundingEndTime: number;
}

export type VoiceOverrides = Record<string, SemanticVoice>;

export const clampProgress = (time: number, start: number, end: number): number =>
  end <= start ? (time >= start ? 1 : 0) : Math.max(0, Math.min(1, (time - start) / (end - start)));
