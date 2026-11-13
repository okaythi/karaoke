import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStemSync } from '../audioMix';

test('resolveStemSync keeps exact base rate within 15ms tolerance', () => {
  assert.deepEqual(resolveStemSync(10.0, 10.008, 1), { kind: 'in-sync', rate: 1 });
  assert.deepEqual(resolveStemSync(10.0, 9.99, 1.25), { kind: 'in-sync', rate: 1.25 });
});

test('resolveStemSync gently nudges playbackRate for moderate drift without hard seeking', () => {
  const behind = resolveStemSync(10.06, 10.0, 1);
  assert.equal(behind.kind, 'nudge');
  assert.ok(behind.rate > 1 && behind.rate <= 1.025);

  const ahead = resolveStemSync(10.0, 10.06, 1);
  assert.equal(ahead.kind, 'nudge');
  assert.ok(ahead.rate < 1 && ahead.rate >= 0.975);
});

test('resolveStemSync falls back to a hard seek when drift is 160ms or more', () => {
  assert.deepEqual(resolveStemSync(24.5, 24.1, 1), {
    kind: 'seek',
    time: 24.5,
    rate: 1
  });
});
