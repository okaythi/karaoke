import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SongCatalogItem } from '../../types/karaoke';
import { adjacentSong, buildSongHistoryUrl } from '../navigation';

const makeSong = (id: string, shareCode?: string): SongCatalogItem => ({
  id,
  shareCode,
  videoFile: `${id}.mp4`,
  title: id,
  artist: 'Artist',
  globalOffset: 0,
  hasTranslation: false,
  isDialect: false,
  isOnR2: true,
  hasLyrics: true,
  videoUrl: `https://example.test/${id}.mp4`
});

test('buildSongHistoryUrl updates ?song= using shareCode or id and clears one-off start timestamps', () => {
  assert.equal(
    buildSongHistoryUrl('?t=45', '/', makeSong('yame-becane', 'eVtAhb')),
    '/?song=eVtAhb'
  );
  assert.equal(
    buildSongHistoryUrl('?preview=fantaisie&time=12', '/', makeSong('itsumo-nando-demo')),
    '/?preview=fantaisie&song=itsumo-nando-demo'
  );
});

test('adjacentSong wraps cleanly forward and backward across the visible catalog', () => {
  const list = [makeSong('one'), makeSong('two'), makeSong('three')];
  assert.equal(adjacentSong(list, 'one', 1)?.id, 'two');
  assert.equal(adjacentSong(list, 'three', 1)?.id, 'one');
  assert.equal(adjacentSong(list, 'one', -1)?.id, 'three');
  assert.equal(adjacentSong([], 'one', 1), null);
});
