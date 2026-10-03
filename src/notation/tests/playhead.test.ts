import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engrave } from '../layout/engrave';
import { ScoreIndex } from '../model/query';
import { clockFrom } from '../playback/clock';
import { playheadAnchors, playheadX } from '../playback/playhead';
import { nominalTiming } from '../playback/timing';
import { parseShorthand } from '../shorthand/parse';

test('A late attack in the other hand cannot pull the bar backward', () => {
  const score = parseShorthand('upper: C5/8 D5 E5 F5 G5 A5 B5 C6 |\nlower: C3/4 D3 E3 F3 |', 'two hands');
  const index = new ScoreIndex(score);
  const system = engrave(score, { width: 90 }).systems[0];
  const timing = nominalTiming(index, 4);
  const late = score.events.find(event => event.staff === 'lower' && event.kind === 'chord')!;
  assert.equal(late.kind, 'chord');
  if (late.kind !== 'chord') return;
  const notes = new Map(timing.notes);
  notes.set(late.notes[0].id, { start: 0.7, glideEnd: 1.7, soundingEnd: 1.7 });
  const anchors = playheadAnchors(system, index, { ...timing, notes });
  let previous = -Infinity;
  for (let frame = 0; frame <= 4 * 59; frame++) {
    const x = playheadX(anchors, frame / 59);
    assert.ok(x > previous, `bar must move right on frame ${frame}`);
    previous = x;
  }
});

test('Grace notes, rests and tuplets share a continuous performed beat path', () => {
  const score = parseShorthand('upper: acc{ B4/16 C5 } C5/4 r/4 3:2{ D5/8 E5 F5 } G5/4 |', 'rhythm');
  const index = new ScoreIndex(score);
  const system = engrave(score, { width: 90 }).systems[0];
  const clock = clockFrom([{ position: 0, time: 2 }, { position: 0.5, time: 3 }, { position: 1, time: 5 }]);
  const anchors = playheadAnchors(system, index, { notes: new Map(), timeAt: clock.timeAt });
  assert.equal(anchors.length, system.timeline.filter(column => !column.grace).length + 1);
  let previous = -Infinity;
  for (let frame = 0; frame <= 3 * 59; frame++) {
    const x = playheadX(anchors, 2 + frame / 59);
    assert.ok(x > previous, `bar must move through rests and tuplets on frame ${frame}`);
    previous = x;
  }
  assert.equal(playheadX(anchors, 100), system.measures.at(-1)!.end);
});

test('Pauses hold position and backward seeks recompute it immediately', () => {
  const anchors = [{ time: 2, x: 10 }, { time: 4, x: 30 }, { time: 6, x: 50 }];
  assert.equal(playheadX(anchors, 3), 20);
  assert.equal(playheadX(anchors, 3), 20);
  assert.equal(playheadX(anchors, 5), 40);
  assert.equal(playheadX(anchors, 2.5), 15);
  assert.equal(playheadX(anchors, 0), 10);
});
