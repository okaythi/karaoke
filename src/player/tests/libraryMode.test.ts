import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SongCatalogItem } from '../../types/karaoke';
import { groupSongsByMode, resolveInitialMode } from '../libraryMode';

const song = (id: string, hasLyrics: boolean): SongCatalogItem => ({
  id,
  videoFile: `${id}.mp4`,
  title: id,
  artist: 'artist',
  globalOffset: 0,
  hasTranslation: false,
  isDialect: false,
  isOnR2: true,
  hasLyrics,
  videoUrl: `https://example.test/${id}.mp4`
});

const sung = song('sung', true);
const both = song('both', true);
const played = song('played', false);
const scored = new Set([both, played]);
const grouped = groupSongsByMode([sung, both, played], s => scored.has(s));

test('score tracks belong exclusively to Piano, even when they also have lyrics', () => {
  assert.deepEqual(grouped.lyrics, [sung]);
  assert.deepEqual(grouped.piano, [both, played]);
});

test('opens on lyrics until the listener chooses otherwise', () => {
  assert.equal(resolveInitialMode(grouped, null), 'lyrics');
  assert.equal(resolveInitialMode(grouped, 'piano'), 'piano');
});

test('a shared link opens the mode that lists its song', () => {
  assert.equal(resolveInitialMode(grouped, null, played), 'piano');
  assert.equal(resolveInitialMode(grouped, 'piano', sung), 'lyrics');
});

test('a shared score track opens Piano regardless of the stored lyrics choice', () => {
  assert.equal(resolveInitialMode(grouped, 'piano', both), 'piano');
  assert.equal(resolveInitialMode(grouped, null, both), 'piano');
});

test('a score-only track cannot leak into Lyrics through a live lyric overlay', () => {
  const track = { ...played, scoreOnly: true, hasLyrics: true };
  assert.deepEqual(groupSongsByMode([track], () => true), { lyrics: [], piano: [track] });
});

test('never opens on an empty mode while the other has songs', () => {
  const lyricsOnly = groupSongsByMode([sung], () => false);
  assert.equal(resolveInitialMode(lyricsOnly, 'piano'), 'lyrics');
  const pianoOnly = groupSongsByMode([played], () => true);
  assert.equal(resolveInitialMode(pianoOnly, null), 'piano');
});
