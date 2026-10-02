import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeScore } from '../model/codec';
import { validateScore } from '../model/validate';
import { engrave } from '../layout/engrave';

test('いつも何度でも score validates and engraves', () => {
  const score = decodeScore(JSON.parse(readFileSync('src/data/score/itsumo-nando-demo/score.json', 'utf8')));
  assert.deepEqual(validateScore(score).filter(issue => issue.level === 'error'), []);
  const result = engrave(score, { width: 100 });
  assert.ok(result.systems.length > 20);
  const timing = JSON.parse(readFileSync('src/data/score/itsumo-nando-demo/timing.json', 'utf8'));
  for (const event of score.events) if (event.kind === 'chord') for (const note of event.notes) assert.ok(timing.notes[note.id], `no timing for ${note.id}`);
});
