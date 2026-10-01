import type { ClassifiedNote, MidiNote, SemanticVoice, VoiceOverrides } from './model';

interface Decision { voice: SemanticVoice; confidence: number; reason: string }

function classifyOne(note: MidiNote, highNeighbors: MidiNote[]): Decision {
  if (note.pitch < 60) return { voice: 'leftHand', confidence: .96, reason: 'Bass register' };
  if (note.pitch < 72) {
    return note.velocity <= 58
      ? { voice: 'leftHand', confidence: .83, reason: 'Middle-register accompaniment with lower velocity' }
      : { voice: 'main', confidence: .55, reason: 'Ambiguous middle-register accent' };
  }
  const withHighPhrase = highNeighbors.some(other =>
    other.id !== note.id && other.pitch >= 85 && other.velocity >= 60 &&
    Math.abs(other.startTime - note.startTime) <= .34
  );
  if (note.pitch >= 86) return { voice: 'response', confidence: note.velocity >= 60 ? .74 : .62, reason: 'Likely high-register answering line; review phrase role' };
  if (note.pitch >= 80 && withHighPhrase) return { voice: 'response', confidence: .76, reason: 'Part of simultaneous high-register answering figure' };
  if (note.pitch >= 83) return { voice: 'response', confidence: .62, reason: 'High-register note; phrase role uncertain' };
  if (note.pitch >= 76) return { voice: 'main', confidence: note.velocity >= 54 ? .82 : .67, reason: 'Primary melodic register' };
  return { voice: 'main', confidence: .58, reason: 'Ambiguous upper-middle register' };
}

export function classifyMidiNotes(raw: MidiNote[], overrides: VoiceOverrides, mediaOffsetSeconds: number): ClassifiedNote[] {
  const high = raw.filter(note => note.pitch >= 85 && note.velocity >= 60);
  return raw.map(note => {
    const decision = classifyOne(note, high.filter(candidate => Math.abs(candidate.startTime - note.startTime) <= .34));
    const manual = Object.prototype.hasOwnProperty.call(overrides, note.id);
    const voice = manual ? overrides[note.id] : decision.voice;
    return {
      ...note,
      semanticVoice: voice,
      confidence: manual ? 1 : decision.confidence,
      reason: manual ? 'Manual voice correction' : decision.reason,
      provenance: manual ? 'manual' : 'automatic',
      mediaStartTime: note.startTime + mediaOffsetSeconds,
      mediaEndTime: note.endTime + mediaOffsetSeconds,
      mediaSoundingEndTime: note.soundingEndTime + mediaOffsetSeconds
    };
  });
}
