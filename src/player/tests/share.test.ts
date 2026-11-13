import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shareUrl } from '../share';

test('shareUrl includes https:// for the main origin', () => {
  assert.equal(
    shareUrl({ id: 'itsumo-nando-demo', shareCode: 'abc123' }, { origin: 'https://karaoke.nixlabs.tech', hostname: 'karaoke.nixlabs.tech', musicVisitor: false }),
    'https://karaoke.nixlabs.tech/abc123'
  );
});

test('shareUrl uses https://music.sudothy.me for music.sudothy.me visitors', () => {
  assert.equal(
    shareUrl({ id: 'itsumo-nando-demo', shareCode: 'abc123' }, { origin: 'https://music.sudothy.me', hostname: 'music.sudothy.me', musicVisitor: true }),
    'https://music.sudothy.me/abc123'
  );
  assert.equal(
    shareUrl({ id: 'itsumo-nando-demo', shareCode: 'abc123' }, { origin: 'https://karaoke.nixlabs.tech', hostname: 'karaoke.nixlabs.tech', musicVisitor: true }),
    'https://music.sudothy.me/abc123'
  );
});

test('shareUrl falls back to encoded song id when shareCode is absent and defaults origin safely', () => {
  assert.equal(
    shareUrl({ id: 'きゃりーぱみゅぱみゅ-もんだいガール' }, { origin: 'null', hostname: '', musicVisitor: false }),
    `https://karaoke.nixlabs.tech/${encodeURIComponent('きゃりーぱみゅぱみゅ-もんだいガール')}`
  );
});
