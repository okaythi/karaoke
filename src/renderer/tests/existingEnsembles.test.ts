import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEnsembleSections, laneVerses, visibleSection } from '../ensembleModel';
import { isVerseTimed, partIds } from '../../core/parts';
import { autoHealTimings } from '../../core/contracts';
import { stampEnd, stampStart } from '../../studio/timing';
import { wordProgress } from '../renderEngine';
import type { Verse } from '../../types/karaoke';

type TimingSnapshot = {
  phrases: { singers: string[]; start: number; end: number; words: [number, number, boolean | null, boolean | null][] }[];
};

for (const id of ['disney-en-helt-ny-varld', 'encanto-vi-pratar-inte-om-bruno']) {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url), 'utf8')) as TimingSnapshot;
  const verses: Verse[] = fixture.phrases.map(phrase => ({
    speaker: phrase.singers[0],
    speakers: phrase.singers.length > 1 ? phrase.singers : undefined,
    verseStart: phrase.start,
    verseEnd: phrase.end,
    words: phrase.words.map(([start, end, timed, endLocked], i) => ({ word: `word-${i}`, start, end, timed: timed ?? undefined, endLocked: endLocked ?? undefined }))
  }));

  test(`${id}: existing saved timings work without a migration or resync`, () => {
    const before = structuredClone(verses);
    const sections = buildEnsembleSections(verses);
    assert.deepEqual(verses, before, 'The layout must never change saved timings');
    // Sample every interval between entrances/releases, including the overlap finale.
    const edges = [...new Set(verses.filter(isVerseTimed).flatMap(v => [v.verseStart, v.verseEnd]))].sort((a, b) => a - b);
    for (let e = 1; e < edges.length; e++) {
      const time = (edges[e - 1] + edges[e]) / 2;
      const active = verses.flatMap((v, i) => isVerseTimed(v) && time >= v.verseStart && time < v.verseEnd ? [i] : []);
      if (!active.length) continue;
      const section = visibleSection(sections, time)!;
      assert.equal(new Set(section.voices.map(lane => lane.key)).size, section.voices.length, 'One lane per singer');
      const shown = [...section.voices, ...section.shared].flatMap(lane => laneVerses(lane, verses, time));
      for (const index of active) assert.ok(shown.includes(index), `Phrase ${index} dropped at ${time}s`);
      assert.equal(new Set(shown).size, shown.length, 'Shared lyrics must not be duplicated');
    }
  });

  test(`${id}: each timed final word stays visible and wipes until its own endpoint`, () => {
    const sections = buildEnsembleSections(verses);
    for (const [index, verse] of verses.entries()) {
      const last = verse.words.at(-1)!;
      if (!last.timed || last.end <= last.start) continue;
      const time = last.end - Math.min(.01, (last.end - last.start) / 2);
      const section = visibleSection(sections, time)!;
      const shown = [...section.voices, ...section.shared].flatMap(lane => laneVerses(lane, verses, time));
      assert.ok(shown.includes(index), `Final word cut early in phrase ${index}`);
      assert.ok(wordProgress(last.start, last.end, time) < 100);
      assert.equal(wordProgress(last.start, last.end, last.end), 100);
    }
  });

  test(`${id}: recorded final releases survive timing another singer and save healing`, () => {
    const locked = structuredClone(verses);
    let checked = 0;
    for (const [index, verse] of locked.entries()) {
      const lastIndex = verse.words.length - 1;
      if (!verse.words[lastIndex].timed || partIds(verse).length > 1) continue;
      // Synthetic explicit release for regression purposes, not an audio correction.
      const release = Number((verse.words[lastIndex].end + .25).toFixed(3));
      stampEnd(verse, lastIndex, release);
      const ids = partIds(verse);
      const other = locked.find((v, i) => i !== index && isVerseTimed(v) && !partIds(v).some(id => ids.includes(id)));
      assert.ok(other, 'Expected another independent voice');
      stampStart(other, 0, other.words[0].start);
      autoHealTimings(locked);
      assert.equal(verse.words[lastIndex].end, release, `Locked release changed in phrase ${index}`);
      assert.equal(verse.words[lastIndex].endLocked, true);
      checked++;
    }
    assert.ok(checked > 30, 'Cover recorded releases across the actual arrangement');
  });
}
