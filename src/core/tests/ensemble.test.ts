import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLyricImport } from '../lyricImport';
import { parseRawLyrics } from '../tokenizer';
import { autoHealTimings, validateSongContract } from '../contracts';
import { isTimed, partIds } from '../parts';
import { nextCursor, stampStart, stampEnd } from '../../studio/timing';
import { buildEnsembleSections, visibleSection, laneVerses } from '../../renderer/ensembleModel';
import type { Verse, SaveLyricsPayload } from '../../types/karaoke';

const cue = (speaker: string, start: number, end: number): Verse => ({ speaker, verseStart: start, verseEnd: end, words: [{ word: `Part ${speaker}`, start, end, timed: true, endLocked: true }] });
const payload = (lyricsData: Verse[]): SaveLyricsPayload => ({ id: 'test', videoFile: 'test.mp4', title: 'Test', artist: 'Test', globalOffset: 0, lyricsData });

test('headers, colours, shared parts and comments never enter sung text', () => {
  const parsed = parseLyricImport('// REVIEW: Check group voices\n@Pepa | #edd18e\nOne phrase\n@Félix\nA response\n@Pepa + Félix\nTogether\n@-\nUnassigned');
  assert.equal(parsed.verses.length, 4);
  assert.deepEqual(partIds(parsed.verses[2]), ['pepa', 'félix']);
  assert.equal(parsed.parts.length, 2);
  assert.equal(parsed.parts[0].color, '#edd18e');
  assert.equal(parsed.verses[0].words.map(w => w.word).join(''), 'One phrase');
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.verses.flatMap(v => v.words).some(isTimed), false);
  assert.deepEqual(partIds(parsed.verses[3]), []);
  assert.throws(() => parseLyricImport('@Pepa | red\nText'));
});

test('plain text, LRC and Japanese readings retain existing parsing', () => {
  assert.equal(parseRawLyrics('Hello world\nNext line').length, 2);
  assert.equal(parseRawLyrics('[01:02.500]Hello world')[0].verseStart, 62.5);
  assert.equal(parseRawLyrics('漢字[かんじ]')[0].words[0].furigana, 'かんじ');
});

test('selected-part traversal skips other singers and includes shared cues', () => {
  const verses = [cue('a', 0, 2), cue('b', 1, 3), { ...cue('a', 4, 6), speakers: ['a', 'b'] }, cue('b', 7, 9)];
  assert.deepEqual(nextCursor(verses, { v: 0, w: 0 }, 'a'), { v: 2, w: 0 });
  assert.equal(nextCursor(verses, { v: 2, w: 0 }, 'a'), null);
  assert.deepEqual(nextCursor(verses, { v: 2, w: 0 }, 'a', -1), { v: 0, w: 0 });
  assert.deepEqual(nextCursor(verses, { v: 4, w: 0 }, 'b', -1), { v: 3, w: 0 });
});

test('recording another voice and saving cannot trim a locked held note', () => {
  const a = cue('a', 10, 16);
  const b = parseLyricImport('@B\nOther voice').verses[0];
  stampStart(b, 0, 12);
  stampStart(b, 1, 12.4);
  stampEnd(b, 1, 13);
  autoHealTimings([a, b]);
  assert.equal(a.words[0].end, 16);
  assert.equal(a.verseEnd, 16);
  assert.equal(b.words[0].end, 12.4);
  assert.equal(b.words[1].end, 13);
  assert.equal(validateSongContract(payload([a, b])).valid, true);
});

test('untimed zero and a recorded start at zero are distinct', () => {
  const verse = parseLyricImport('@A\nFirst second').verses[0];
  autoHealTimings([verse]);
  assert.equal(verse.verseEnd, 0);
  stampStart(verse, 0, 0);
  stampEnd(verse, 0, .5);
  autoHealTimings([verse]);
  assert.equal(isTimed(verse.words[0]), true);
  assert.equal(isTimed(verse.words[1]), false);
  assert.equal(verse.verseStart, 0);
  assert.equal(verse.verseEnd, .5);
});

test('all seven simultaneous phrases survive and have independent timing', () => {
  const verses = Array.from({ length: 7 }, (_, i) => cue(String(i), 10 + i * .1, 14 + i * .1));
  const sections = buildEnsembleSections(verses);
  const section = visibleSection(sections, 11)!;
  assert.equal(section.voices.length, 7);
  assert.deepEqual(section.voices.flatMap(lane => laneVerses(lane, verses, 11)).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(visibleSection(sections, 1), undefined);
  assert.equal(visibleSection(sections, 11), section);
  // A backward seek recovers the same section and lane order.
  visibleSection(sections, 100);
  assert.deepEqual(visibleSection(sections, 11)?.voices, section.voices);
});

test('same-character overlaps are retained; sequential cues reuse their lane', () => {
  const verses = [cue('a', 1, 5), cue('a', 2, 3), cue('b', 2, 8), cue('a', 5, 7)];
  const sections = buildEnsembleSections(verses);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].voices.length, 2);
  const lane = sections[0].voices.find(lane => lane.partIds[0] === 'a')!;
  assert.deepEqual(lane.verses, [0, 1, 3]);
  assert.deepEqual(laneVerses(lane, verses, 2.5), [1, 0]);
  assert.deepEqual(laneVerses(lane, verses, 5.5), [3]);
});

test('saved JSON retains colours, shared assignments and explicit endings', () => {
  const parsed = parseLyricImport('@Pepa | #edd18e\nOne\n@Félix\nTwo\n@Pepa + Félix\nTogether');
  parsed.verses.forEach((v, i) => { stampStart(v, 0, 10 + i); stampEnd(v, 0, 13 + i); });
  const document = { ...payload(parsed.verses), parts: parsed.parts };
  const restored = JSON.parse(JSON.stringify(document));
  assert.equal(validateSongContract(restored).valid, true);
  autoHealTimings(restored.lyricsData);
  assert.deepEqual(restored, document);
  restored.parts[0].color = 'url(bad)';
  assert.equal(validateSongContract(restored).valid, false);
});

test('malformed parts, unknown references and infinite timings are rejected', () => {
  const document = { ...payload([cue('a', 1, 3)]), parts: [{ id: 'b', name: 'B', color: '#ffffff' }] };
  assert.equal(validateSongContract(document).valid, false);
  assert.equal(validateSongContract({ ...payload([cue('a', 1, Infinity)]) }).valid, false);
  assert.equal(validateSongContract({ ...document, lyricsData: [null] }).valid, false);
});

test('Swedish draft imports without character headers or review notes becoming words', () => {
  const parsed = parseLyricImport(readFileSync(new URL('../../data/lyric-drafts/vi-pratar-inte-om-bruno.sv.txt', import.meta.url), 'utf8'));
  assert.equal(parsed.parts.length, 11);
  assert.ok(parsed.verses.length > 80);
  assert.equal(parsed.verses.some(v => !partIds(v).length), false);
  assert.equal(parsed.verses.some(v => v.words.some(w => /@|REVIEW:/.test(w.word))), false);
});

test('corrected Swedish assignments separate the opening, announcement and complete reprise tracks', () => {
  const parsed = parseLyricImport(readFileSync(new URL('../../data/lyric-drafts/vi-pratar-inte-om-bruno.sv.txt', import.meta.url), 'utf8'));
  const text = (verse: Verse) => verse.words.map(word => word.word).join('').trim();
  assert.deepEqual(partIds(parsed.verses[0]), ['pepa']);
  assert.deepEqual(partIds(parsed.verses[1]), ['pepa']);
  const announcement = parsed.verses.find(verse => text(verse) === 'Isabela, din pojkvän är här!')!;
  assert.deepEqual(partIds(announcement), ['camilo']);
  const arrival = parsed.verses.find(verse => text(verse) === 'Han är här!')!;
  assert.deepEqual(partIds(arrival), ['kör']);
  assert.equal(parsed.verses.filter(verse => text(verse) === 'En gänglig gestalt' && partIds(verse).includes('camilo')).length, 3);
  assert.equal(parsed.verses.filter(verse => text(verse) === 'Jag mår bra' && partIds(verse).includes('dolores')).length, 3);
  assert.equal(parsed.verses.filter(verse => text(verse) === 'Den ger mer' && partIds(verse).includes('isabela')).length, 4);
});
