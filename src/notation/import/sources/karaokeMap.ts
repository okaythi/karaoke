/**
 * Adapter for the "karaoke map" format (schema 1): a transcription of the
 * recording aligned to a reference score, one entry per performed note with
 * its audio times, written position in ticks, staff (1 = upper) and voice.
 */
import type { AlignedSource } from '../aligned';

interface KaraokeMapNote {
  readonly id: string;
  readonly midi: number;
  readonly pitch?: string;
  readonly audioStart: number;
  readonly audioEnd: number;
  readonly staff: number;
  readonly voice: number;
  readonly scoreStartTick: number;
  readonly source?: 'reference-guided' | 'authority-only';
  readonly segments?: readonly { readonly durationTicks: number }[];
}

interface KaraokeMap {
  readonly schemaVersion: 1;
  readonly score: { readonly divisionsPerQuarter: number };
  readonly notes: readonly KaraokeMapNote[];
}

export function fromKaraokeMap(json: unknown, staves: readonly string[]): AlignedSource {
  const map = json as KaraokeMap;
  if (map.schemaVersion !== 1 || !Array.isArray(map.notes)) throw new Error('Not a schema-1 karaoke map');
  return {
    divisions: map.score.divisionsPerQuarter,
    notes: map.notes.map(note => ({
      id: note.id, midi: note.midi, spelling: note.pitch, audioStart: note.audioStart, audioEnd: note.audioEnd,
      staff: staves[note.staff - 1], voice: note.voice, tick: note.scoreStartTick,
      // Positions taken from the reference score are trusted more than the transcription's own.
      confidence: note.source === 'authority-only' ? 0.5 : 1,
      sourceLength: note.segments?.reduce((sum: number, segment: { readonly durationTicks: number }) => sum + segment.durationTicks, 0)
    }))
  };
}
