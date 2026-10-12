import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnsembleSections, ensembleLayout, visiblePhrases, reservedLaneHeight, visibleSection } from '../ensembleModel';
import type { Verse } from '../../types/karaoke';

const cue = (speaker: string, start: number, end: number): Verse => ({ speaker, verseStart: start, verseEnd: end, words: [{ word: speaker, start, end, timed: true }] });
const shown = (section: ReturnType<typeof buildEnsembleSections>[number], verses: Verse[], time: number, key: string) => {
  const phrase = visiblePhrases(section, verses, time).get(key);
  return phrase ? [phrase.index] : [];
};
const cast = (section: ReturnType<typeof buildEnsembleSections>[number]) => section.voices.map(lane => lane.partIds[0]);

test('sequential, touching and overlapping lines of one singer use one area', () => {
  const verses = [cue('A', 0, 3), cue('a', 2, 4), cue('a', 4, 5), cue('A', 6, 8)];
  const sections = buildEnsembleSections(verses);
  assert.equal(sections.length, 1);
  const lane = sections[0].voices[0];
  assert.deepEqual(cast(sections[0]), ['a']);
  assert.deepEqual(lane.verses, [0, 1, 2, 3]);
  assert.deepEqual(shown(sections[0], verses, 2.5, lane.key), [1]);
  assert.deepEqual(shown(sections[0], verses, 4, lane.key), [2]);
  assert.deepEqual(shown(sections[0], verses, 5.5, lane.key), [3]);
});

test('duet sides stay the same when entrance order and local prominence reverse', () => {
  const verses = [cue('a', 0, 8), cue('b', 1, 3), cue('b', 20, 25), cue('a', 21, 22)];
  const sections = buildEnsembleSections(verses);
  assert.equal(sections.length, 2);
  assert.deepEqual(cast(sections[0]), ['a', 'b']);
  assert.deepEqual(cast(sections[1]), ['a', 'b']);
});

test('local lead is inferred from sung words, not long empty phrase bounds', () => {
  const backing = cue('backing', 0, 12);
  backing.words[0].end = 1;
  const verses = [backing, cue('lead', 1, 10), cue('echo', 3, 4)];
  const section = buildEnsembleSections(verses)[0];
  assert.equal(cast(section)[0], 'lead');
  assert.equal(ensembleLayout(section.voices.length, 1000).places[0].column, 2);
});

test('duplicated same-singer phrases do not inflate lead prominence', () => {
  const verses = [...Array.from({ length: 12 }, () => cue('echo', 2, 3)), cue('lead', 0, 8), cue('other', 4, 5)];
  const section = buildEnsembleSections(verses)[0];
  assert.equal(cast(section)[0], 'lead');
  assert.equal(section.voices.length, 3);
  const displayed = [...visiblePhrases(section, verses, 2.5).values()].filter(phrase => phrase.partIds.includes('echo'));
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].index, 11);
});

test('solo prominence counts exposed entrances and allows a different passage lead', () => {
  const verses = [cue('a', 0, 6), cue('b', 5, 9), cue('c', 5, 9), cue('b', 20, 29), cue('a', 24, 26), cue('c', 24, 26)];
  const sections = buildEnsembleSections(verses);
  assert.equal(cast(sections[0])[0], 'a');
  assert.equal(cast(sections[1])[0], 'b');
});

test('a shared chorus renders once without creating a third duet singer', () => {
  const shared = { ...cue('A', 3, 9), speakers: ['B', 'A'] };
  const verses = [cue('a', 0, 4), cue('b', 1, 4), shared, { ...cue('b', 8, 10), speakers: ['a', 'b'] }];
  const section = buildEnsembleSections(verses)[0];
  assert.equal(section.voices.length, 2);
  assert.equal(section.shared.length, 1);
  assert.deepEqual(section.shared[0].partIds, ['a', 'b']);
  assert.deepEqual(shown(section, verses, 8.5, section.shared[0].key), [3]);
});

test('shared-only passages are centered without empty solo lanes', () => {
  const sections = buildEnsembleSections([{ ...cue('a', 5, 8), speakers: ['a', 'b', 'c'] }]);
  assert.equal(sections[0].voices.length, 0);
  assert.equal(sections[0].shared.length, 1);
});

test('seeking, unsorted import order and untimed verses produce deterministic choreography', () => {
  const verses = [cue('b', 4, 7), cue('a', 0, 8), { ...cue('c', 3, 5), words: [{ word: 'untimed', start: 0, end: 0, timed: false }] }];
  const sections = buildEnsembleSections(verses);
  const snapshot = JSON.stringify(sections);
  assert.deepEqual(cast(sections[0]), ['a', 'b']);
  visibleSection(sections, 100);
  assert.equal(visibleSection(sections, 4.5), sections[0]);
  assert.equal(JSON.stringify(sections), snapshot);
  assert.deepEqual(buildEnsembleSections(verses), sections);
  assert.equal(visibleSection(sections, 11), undefined);
});

test('short same-cast breaths merge; instrumentals and cast changes remain separate', () => {
  const verses = [cue('a', 0, 2), cue('a', 3, 4), cue('b', 4, 5), cue('a', 20, 21)];
  const sections = buildEnsembleSections(verses);
  assert.equal(sections.length, 3);
  assert.deepEqual(sections[0].voices[0].verses, [0, 1]);
  assert.equal(visibleSection(sections, 12), undefined);
});

test('lead-in and release respect exact boundaries without dropping an active singer', () => {
  const verses = [cue('a', 5, 8), cue('b', 6, 7)];
  const section = buildEnsembleSections(verses)[0];
  const lane = section.voices.find(lane => lane.partIds[0] === 'b')!;
  assert.deepEqual(shown(section, verses, 3.99, lane.key), []);
  assert.deepEqual(shown(section, verses, 4, lane.key), [1]);
  assert.deepEqual(shown(section, verses, 6.5, lane.key), [1]);
  assert.deepEqual(shown(section, verses, 7.5, lane.key), [1]);
  assert.deepEqual(shown(section, verses, 7.61, lane.key), []);
});

test('responsive formations are centered and no singer cells overlap', () => {
  for (const width of [320, 400, 700, 1000, 1600]) {
    for (let count = 0; count <= 12; count++) {
      const { columns, places } = ensembleLayout(count, width);
      const occupied = new Set<string>();
      assert.equal(places.length, count);
      for (const place of places) {
        assert.ok(place.column >= 1 && place.column + place.span - 1 <= columns);
        for (let col = place.column; col < place.column + place.span; col++) {
          const cell = `${place.row}:${col}`;
          assert.equal(occupied.has(cell), false, `collision at ${count} singers, width ${width}`);
          occupied.add(cell);
        }
      }
      if (count > 2 && columns > 1) assert.equal(places[0].column + (places[0].span - 1) / 2, (columns + 1) / 2);
    }
  }
  assert.deepEqual(ensembleLayout(2, 400).places, [{ column: 1, span: 1, row: 1 }, { column: 2, span: 1, row: 1 }]);
});

test('overlapping timestamps reserve only the tallest single wrapped phrase', () => {
  const verses = [cue('a', 0, 4), cue('a', 3, 6), cue('a', 6, 8)];
  const lane = buildEnsembleSections(verses)[0].voices[0];
  const heights = new Map([[0, 50], [1, 60], [2, 30]]);
  assert.equal(reservedLaneHeight(lane, heights), 60);
  const touching = [cue('a', 0, 3), cue('a', 3, 5)];
  const touchingLane = buildEnsembleSections(touching)[0].voices[0];
  heights.set(99, 999);
  assert.equal(reservedLaneHeight(touchingLane, heights), 60);
});

test('a superseded phrase never reappears even when its locked end outlasts the next line', () => {
  const verses = [cue('a', 0, 10), cue('a', 2, 3), cue('b', 1, 12)];
  verses[0].words[0].endLocked = true;
  const section = buildEnsembleSections(verses)[0];
  const a = section.voices.find(lane => lane.partIds[0] === 'a')!;
  assert.deepEqual(shown(section, verses, 2, a.key), [1]);
  assert.deepEqual(shown(section, verses, 4, a.key), []);
  assert.deepEqual(shown(section, verses, 1, a.key), [0], 'Backward seeks recover the earlier phrase');
  assert.equal(verses[0].words[0].end, 10, 'Rendering never rewrites recorded durations');
});

test('solo and shared phrases compete for each singer, without silencing the other partner', () => {
  const verses = [cue('a', 0, 8), cue('b', 0, 8), { ...cue('a', 3, 9), speakers: ['a', 'b'] }, cue('a', 5, 7)];
  const section = buildEnsembleSections(verses)[0];
  assert.deepEqual([...visiblePhrases(section, verses, 3.5).values()], [{ index: 2, partIds: ['a', 'b'] }]);
  const displayed = [...visiblePhrases(section, verses, 5.5).values()];
  assert.deepEqual(displayed.find(phrase => phrase.index === 3)?.partIds, ['a']);
  assert.deepEqual(displayed.find(phrase => phrase.index === 2)?.partIds, ['b']);
  const singers = displayed.flatMap(phrase => phrase.partIds);
  assert.equal(new Set(singers).size, singers.length);
});
