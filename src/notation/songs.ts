import { isProtectedSong } from '../security/protectedSong.js';
import { prepareProtectedPlayback } from '../security/playback';
/**
 * Loads a song's engraved score at runtime, docs §11. Each song's files are
 * separate chunks, fetched only when that song is chosen.
 */
import type { LayoutSettings } from './layout/settings';
import { decodeScore } from './model/codec';
import type { Score } from './model/types';
import { clockFrom } from './playback/clock';
import type { NoteTiming, TimingMap } from './playback/timing';
import type { StyleSheet } from './style/style';

export interface SongScore {
  readonly id: string;
  readonly score: Score;
  readonly timing: TimingMap;
  readonly style?: StyleSheet;
  readonly layout?: Partial<LayoutSettings>;
}

type Loader = () => Promise<unknown>;
const scores = import.meta.glob(['../data/score/*/score.json', '!../data/score/chopin-fantaisie-impromptu/score.json'], { import: 'default' }) as Record<string, Loader>;
const timings = import.meta.glob(['../data/score/*/timing.json', '!../data/score/chopin-fantaisie-impromptu/timing.json'], { import: 'default' }) as Record<string, Loader>;
const styles = import.meta.glob(['../data/score/*/style.json', '!../data/score/chopin-fantaisie-impromptu/style.json'], { import: 'default' }) as Record<string, Loader>;
const songs = import.meta.glob(['../data/score/*/song.json', '!../data/score/chopin-fantaisie-impromptu/song.json'], { import: 'default' }) as Record<string, Loader>;

const path = (id: string, file: string) => `../data/score/${id}/${file}`;

interface TimingFile {
  readonly notes: Readonly<Record<string, { start: number; glideEnd: number; soundingEnd: number }>>;
  readonly beats: readonly { position: number; time: number }[];
}

export function hasSongScore(id: string): boolean {
  return isProtectedSong(id) || path(id, 'score.json') in scores;
}

export async function loadSongScore(id: string): Promise<SongScore | undefined> {
  if (isProtectedSong(id)) {
    await prepareProtectedPlayback(id);
    const response = await fetch('/api/karaoke/protected/score', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('The protected arrangement is unavailable.');
    const data = await response.json() as { score: unknown; timing: unknown; style?: unknown; song?: unknown };
    return songBundle(id, data.score, data.timing, data.style, data.song);
  }
  const scoreLoader = scores[path(id, 'score.json')], timingLoader = timings[path(id, 'timing.json')];
  if (!scoreLoader || !timingLoader) return undefined;
  const [scoreJson, timingJson, style, song] = await Promise.all([
    scoreLoader(), timingLoader(), styles[path(id, 'style.json')]?.(), songs[path(id, 'song.json')]?.()
  ]);
  return songBundle(id, scoreJson, timingJson, style, song);
}

function songBundle(id: string, scoreJson: unknown, timingJson: unknown, style: unknown, song: unknown): SongScore {
  const timing = timingJson as TimingFile;
  const clock = clockFrom(timing.beats);
  const notes = new Map<string, NoteTiming>(Object.entries(timing.notes));
  return {
    id,
    score: decodeScore(scoreJson),
    timing: { notes, timeAt: position => clock.timeAt(position) },
    ...(style ? { style: style as StyleSheet } : {}),
    ...((song as { layout?: Partial<LayoutSettings> } | undefined)?.layout ? { layout: (song as { layout: Partial<LayoutSettings> }).layout } : {})
  };
}
