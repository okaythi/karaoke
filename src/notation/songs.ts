/**
 * Loads a song's engraved score at runtime, docs §11. Each song's files are
 * separate chunks, fetched only when that song is chosen.
 */
import { isProtectedSong } from '../security/protectedSong.js';
import { prepareProtectedPlayback } from '../security/playback';
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

// The protected piece (PROTECTED_SONG_ID) is served from private storage and must never be bundled.
// Vite needs the patterns as literals, so its folder is named here rather than taken from the constant.
const files = import.meta.glob<unknown>(
  ['../data/score/*/{score,timing,style,song}.json', '!../data/score/chopin-fantaisie-impromptu/**'],
  { import: 'default' }
);

const loaderFor = (id: string, file: string) => files[`../data/score/${id}/${file}`];

interface TimingFile {
  readonly notes: Readonly<Record<string, { start: number; glideEnd: number; soundingEnd: number }>>;
  readonly beats: readonly { position: number; time: number }[];
}

export function hasSongScore(id: string): boolean {
  return isProtectedSong(id) || loaderFor(id, 'score.json') !== undefined;
}

export async function loadSongScore(id: string): Promise<SongScore | undefined> {
  if (isProtectedSong(id)) {
    await prepareProtectedPlayback(id);
    const response = await fetch('/api/karaoke/protected/score', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('The protected arrangement is unavailable.');
    const data = await response.json() as { score: unknown; timing: unknown; style?: unknown; song?: unknown };
    return songBundle(id, data.score, data.timing, data.style, data.song);
  }
  const scoreLoader = loaderFor(id, 'score.json'), timingLoader = loaderFor(id, 'timing.json');
  if (!scoreLoader || !timingLoader) return undefined;
  const [scoreJson, timingJson, style, song] = await Promise.all([
    scoreLoader(), timingLoader(), loaderFor(id, 'style.json')?.(), loaderFor(id, 'song.json')?.()
  ]);
  return songBundle(id, scoreJson, timingJson, style, song);
}

function songBundle(id: string, scoreJson: unknown, timingJson: unknown, style: unknown, song: unknown): SongScore {
  const timing = timingJson as TimingFile;
  const clock = clockFrom(timing.beats);
  const notes = new Map<string, NoteTiming>(Object.entries(timing.notes));
  const layout = (song as { layout?: Partial<LayoutSettings> } | undefined)?.layout;
  return {
    id,
    score: decodeScore(scoreJson),
    timing: { notes, timeAt: position => clock.timeAt(position) },
    ...(style ? { style: style as StyleSheet } : {}),
    ...(layout ? { layout } : {})
  };
}
