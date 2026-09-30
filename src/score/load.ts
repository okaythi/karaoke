import midi from '../data/score/itsumo-midi.json';
import overrides from '../data/score/itsumo-voice-overrides.json';
import config from '../data/score/itsumo-midi-config.json';
import { classifyMidiNotes } from './classify';
import { linkNotation, NOTATION_KEY, NOTATION_METER, engravingBeatGrid } from './notation';
import type { MidiNote, VoiceOverrides } from './model';

export const PIANO_SONG_ID = 'itsumo-nando-demo';
const OVERRIDE_STORAGE_KEY = 'itsumo-transkun-voice-overrides';

export function loadPianoScore() {
  let localOverrides: VoiceOverrides = {};
  if (import.meta.env.DEV) {
    try { localOverrides = JSON.parse(localStorage.getItem(OVERRIDE_STORAGE_KEY) || '{}'); } catch (_) { localOverrides = {}; }
  }
  const mergedOverrides = { ...(overrides as VoiceOverrides), ...localOverrides };
  const notes = classifyMidiNotes(midi.notes as MidiNote[], mergedOverrides, config.mediaOffsetSeconds);
  return {
    notes,
    pedals: midi.pedals,
    ticksPerQuarter: midi.ticksPerQuarter,
    notation: linkNotation(notes),
    engravingBeatGrid,
    engravingKeySignature: NOTATION_KEY,
    timeSignature: NOTATION_METER,
    duration: midi.duration,
    mediaOffsetSeconds: config.mediaOffsetSeconds,
    overrides: mergedOverrides
  };
}

export function saveDevelopmentOverrides(overrides: VoiceOverrides): void {
  if (import.meta.env.DEV) localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
}
