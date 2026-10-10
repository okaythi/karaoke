import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSortKey, kanaToRomaji, sortSongs } from '../../catalog/sorter';
import { fuzzyFilterSongs } from '../fuzzySearch';
import type { SongCatalogItem } from '../../types/karaoke';

const song = (id: string, title: string, artist = 'Artist'): SongCatalogItem => ({
  id, title, artist, videoFile: `${id}.mp4`, globalOffset: 0, hasTranslation: false, isDialect: false,
  isOnR2: true, hasLyrics: true, videoUrl: `https://example.test/${id}.mp4`
});

test('every voiced d-row kana is romanized', () => {
  assert.equal(kanaToRomaji('だぢづでど'), 'dajizudedo');
  assert.equal(kanaToRomaji('いつもなんどでも'), 'itsumonandodemo');
});

test('katakana, digraphs, doubled consonants and long vowels romanize like hiragana', () => {
  assert.equal(kanaToRomaji('キャリー'), 'kyari');
  assert.equal(kanaToRomaji('きっと'), 'kitto');
});

test('sort keys ignore accents, case and leading punctuation', () => {
  assert.equal(getSortKey('“Élan”'), 'elan”');
  assert.deepEqual(sortSongs([song('b', 'Zebra'), song('a', '¡Árbol!'), song('c', 'でんしゃ')]).map(s => s.id), ['a', 'c', 'b']);
});

test('a romaji query finds a kana title', () => {
  const songs = [song('one', 'でも'), song('two', 'Other')];
  assert.deepEqual(fuzzyFilterSongs(songs, 'demo').map(s => s.id), ['one']);
});

test('closer matches rank first, and an empty query keeps the list as given', () => {
  const songs = [song('sub', 'Let It Go'), song('prefix', 'Go To Hell'), song('exact', 'Go')];
  assert.deepEqual(fuzzyFilterSongs(songs, 'go').map(s => s.id), ['exact', 'prefix', 'sub']);
  assert.equal(fuzzyFilterSongs(songs, '  '), songs);
});
