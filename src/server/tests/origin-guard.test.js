import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { isLegacyProtectedPath } from '../../../workers/fantaisie-origin-guard/index.js';
import { PROTECTED_VIDEO_KEY } from '../../security/protectedSong.js';
test('legacy video variants are blocked before fetching cached or origin bytes', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('must not read CDN cache or public origin');
  try {
    for (const key of [PROTECTED_VIDEO_KEY, encodeURIComponent(PROTECTED_VIDEO_KEY), encodeURIComponent(encodeURIComponent(PROTECTED_VIDEO_KEY)), encodeURIComponent(PROTECTED_VIDEO_KEY.normalize('NFD'))]) {
      assert.equal(isLegacyProtectedPath('/' + key), true);
      const response = await worker.fetch(new Request('https://cdn.sudothy.me/' + key + '?download=1'));
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally { globalThis.fetch = original; }
});
test('unrelated CDN objects pass through', async () => {
  const original = globalThis.fetch;
  const request = new Request('https://cdn.sudothy.me/Frank%20Sinatra.mp4');
  globalThis.fetch = async received => { assert.equal(received, request); return new Response('other video'); };
  try { assert.equal(await (await worker.fetch(request)).text(), 'other video'); }
  finally { globalThis.fetch = original; }
});
