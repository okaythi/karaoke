import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeScore } from '../model/codec';
import { validateScore } from '../model/validate';
import { engrave } from '../layout/engrave';
import { ScoreIndex } from '../model/query';
import * as F from '../core/fraction';
import { overlaps } from '../layout/display';

test('いつも何度でも score validates and engraves', () => {
  const score = decodeScore(JSON.parse(readFileSync('src/data/score/itsumo-nando-demo/score.json', 'utf8')));
  assert.deepEqual(validateScore(score).filter(issue => issue.level === 'error'), []);
  const result = engrave(score, { width: 100 });
  assert.ok(result.systems.length > 20);
  const timing = JSON.parse(readFileSync('src/data/score/itsumo-nando-demo/timing.json', 'utf8'));
  for (const event of score.events) if (event.kind === 'chord') for (const note of event.notes) assert.ok(timing.notes[note.id], `no timing for ${note.id}`);
});

test('Fantaisie bass slurs and notes clear the crescendo between staves', () => {
  const score = decodeScore(JSON.parse(readFileSync('src/data/score/chopin-fantaisie-impromptu/score.json', 'utf8')));
  for (const width of [48, 80, 160]) {
    const system = engrave(score, { width }).systems.find(system => system.first <= 66 && system.last >= 66)!;
    const crescendo = system.items.filter(item => item.element === 'dyn.text-cresc');
    assert.ok(crescendo.length >= 2);
    const bass = system.items.filter(item => item.semantic.staff === 'lower' && item.element !== 'staff.lines');
    for (const mark of crescendo) {
      assert.ok(mark.box.y1 < system.staffTops.get('lower')!, 'Crescendo must remain between the staves');
      for (const item of bass) assert.ok(!overlaps(mark.box, item.box, 0.2), `Crescendo overlaps ${item.element} at width ${width}`);
    }
  }
});

test('Fantaisie bar 22 keeps slurs near their staves on narrow screens', () => {
  const score = decodeScore(JSON.parse(readFileSync('src/data/score/chopin-fantaisie-impromptu/score.json', 'utf8')));
  for (const width of [24, 36, 48, 80]) {
    const engraving = engrave(score, { width });
    const system = engraving.systems.find(system => system.first <= 21 && system.last >= 21)!;
    const bassTop = system.staffTops.get('lower')!;
    assert.ok(bassTop < 18, `Bar 22 has an excessive staff gap at width ${width}`);
    const bassSlurs = system.items.filter(item => item.element === 'slur' && item.semantic.staff === 'lower');
    assert.equal(bassSlurs.length, 2);
    for (const slur of bassSlurs) assert.ok(slur.box.y0 > bassTop - 7, 'Bass slur floats far above its notes');
    assert.ok(system.box.y0 > -8, 'Treble slurs must remain near their notes');
  }
});

test('Fantaisie-Impromptu preserves polyrhythm, key changes, ornaments and recording timing', () => {
  const folder = 'src/data/score/chopin-fantaisie-impromptu';
  const score = decodeScore(JSON.parse(readFileSync(`${folder}/score.json`, 'utf8')));
  const index = new ScoreIndex(score);
  assert.deepEqual(validateScore(score), []);
  assert.equal(score.measures.length, 138);
  assert.deepEqual([index.keyAt(0).fifths, index.keyAt(40).fifths, index.keyAt(82).fifths], [4, -5, 4]);
  const upper = index.eventsIn(4, 'upper').filter(event => event.kind === 'chord');
  const lower = index.eventsIn(4, 'lower').filter(event => event.kind === 'chord');
  assert.equal(upper.length, 15);
  assert.equal(lower.length, 12);
  assert.ok(upper.every(event => F.eq(index.length(event), F.frac(1, 16))));
  assert.ok(lower.every(event => F.eq(index.length(event), F.frac(1, 12))));
  assert.ok(score.tuplets.some(tuplet => tuplet.actual === 7 && tuplet.normal === 4));
  assert.ok(score.events.some(event => event.kind === 'chord' && event.grace));
  assert.ok(score.events.some(event => event.kind === 'chord' && event.notes.some(note => note.staff === 'upper')));
  const timing = JSON.parse(readFileSync(`${folder}/timing.json`, 'utf8'));
  for (const event of score.events) if (event.kind === 'chord') for (const note of event.notes) {
    const value = timing.notes[note.id];
    assert.ok(value, `No timing for ${note.id}`);
    assert.ok(value.start >= 0 && value.start < value.glideEnd && value.glideEnd <= value.soundingEnd);
  }
  assert.ok(timing.notes['lower.1.1.0:G#2'].start > 5, 'Leading silence must remain in the media timeline');
  assert.ok(timing.notes['upper.138.1.0:C#4'].start < 335, 'Outro must not capture the final chord');
  for (let i = 1; i < timing.beats.length; i++) assert.ok(timing.beats[i].time > timing.beats[i - 1].time);
  for (const width of [48, 160]) {
    const result = engrave(score, { width });
    assert.equal(result.systems.at(-1)?.last, 137);
    for (const system of result.systems) for (const value of Object.values(system.box)) assert.ok(Number.isFinite(value));
  }
});
