import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issuePlaybackGrant, verifyPlaybackGrant, GRANT_SECONDS } from '../playbackGate.js';
import { parseRange, serveProtectedVideo } from '../protectedVideo.js';
import { verifyTurnstile } from '../turnstile.js';
import { onRequest as session } from '../../../functions/api/karaoke/protected/session.js';
const env = { PLAYBACK_SIGNING_SECRET: 'test-secret-with-at-least-32-bytes-long', PROTECTED_MEDIA_BUCKET: {} };
const now = Date.now();
const mintRequest = () => new Request('https://karaoke.example/api/karaoke/protected/session', { method: 'POST', headers: { origin: 'https://karaoke.example', 'user-agent': 'viewer' } });
test('music.sudothy.me can verify and obtain a same-origin playback grant', async () => {
  const config = readFileSync(new URL('../../../wrangler.toml', import.meta.url), 'utf8');
  const hostnames = config.match(/^PLAYBACK_HOSTNAMES = "([^"]+)"/m)[1];
  const musicEnv = { ...env, PLAYBACK_HOSTNAMES: hostnames, TURNSTILE_SECRET_KEY: 'test-secret' };
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ success: true, hostname: 'music.sudothy.me', action: 'fantaisie_playback' });
    const response = await session({ env: musicEnv, request: new Request('https://music.sudothy.me/api/karaoke/protected/session', {
      method: 'POST', headers: { origin: 'https://music.sudothy.me', 'content-type': 'application/json', 'user-agent': 'viewer' },
      body: JSON.stringify({ token: 'test-token' }),
    }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal(await verifyPlaybackGrant(new Request('https://music.sudothy.me/api/karaoke/protected/video', {
      headers: { cookie, 'user-agent': 'viewer', 'sec-fetch-site': 'same-origin' },
    }), musicEnv), true);
    globalThis.fetch = async () => Response.json({ success: true, hostname: 'karaoke.nixlabs.tech', action: 'fantaisie_playback' });
    assert.equal(await verifyTurnstile(new Request('https://music.sudothy.me/api/karaoke/protected/session'), musicEnv, 'test-token'), false);
  } finally { globalThis.fetch = original; }
});
async function granted(headers = {}) {
  const response = await issuePlaybackGrant(mintRequest(), env, now);
  return new Request('https://karaoke.example/api/karaoke/protected/video', { headers: { cookie: response.headers.get('set-cookie').split(';')[0], 'user-agent': 'viewer', ...headers } });
}
test('grant is short-lived, host-only and inaccessible to script; no cache', async () => {
  const response = await issuePlaybackGrant(mintRequest(), env, now);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /__Host-.*Secure; HttpOnly; SameSite=Strict/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(await verifyPlaybackGrant(await granted(), env, now), true);
  assert.equal(await verifyPlaybackGrant(await granted(), env, now + GRANT_SECONDS * 1000), false);
});
test('forged, cross-site, duplicate, wrong-agent and rotated-secret grants fail', async () => {
  const valid = await granted();
  const cookie = valid.headers.get('cookie');
  for (const headers of [{ cookie: cookie + 'x' }, { 'sec-fetch-site': 'same-site' }, { 'user-agent': 'thief' }, { cookie: `${cookie}; ${cookie}` }, { origin: 'https://thief.example' }, { 'sec-fetch-mode': 'navigate' }]) {
    assert.equal(await verifyPlaybackGrant(await granted(headers), env, now), false);
  }
  assert.equal(await verifyPlaybackGrant(valid, { ...env, PLAYBACK_SIGNING_SECRET: 'rotated-secret-with-at-least-32-bytes' }, now), false);
});
test('grant issuance fails closed without private storage, secret or origin', async () => {
  assert.equal((await issuePlaybackGrant(mintRequest(), {}, now)).status, 503);
  assert.equal((await issuePlaybackGrant(mintRequest(), { ...env, PROTECTED_MEDIA_BUCKET: undefined }, now)).status, 503);
  assert.equal((await issuePlaybackGrant(new Request('https://karaoke.example', { method: 'POST' }), env, now)).status, 403);
});
test('valid ranges support seeking; malformed, multi-range and overflow fail', () => {
  assert.deepEqual(parseRange('bytes=10-19', 100), { offset: 10, length: 10 });
  assert.deepEqual(parseRange('bytes=90-', 100), { offset: 90, length: 10 });
  assert.deepEqual(parseRange('bytes=-20', 100), { offset: 80, length: 20 });
  assert.deepEqual(parseRange('bytes=90-200', 100), { offset: 90, length: 10 });
  for (const range of ['bytes=100-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=-', 'bytes=9007199254740999-']) assert.equal(parseRange(range, 100), false);
});
test('video never reads public storage; verifies grant before storage access', async () => {
  let reads = 0;
  const bucket = { head: async () => { reads++; return { size: 100, etag: 'tag' }; }, get: async (_key, options) => { reads++; assert.deepEqual(options.range, { offset: 10, length: 10 }); return { body: new Uint8Array(10) }; } };
  const context = { env: { ...env, PROTECTED_MEDIA_BUCKET: bucket, MEDIA_BUCKET: { get: () => assert.fail('public storage fallback') } } };
  const denied = await serveProtectedVideo({ ...context, request: new Request('https://karaoke.example/api/karaoke/protected/video') });
  assert.equal(denied.status, 403); assert.equal(reads, 0);
  const response = await serveProtectedVideo({ ...context, request: await granted({ range: 'bytes=10-19' }) });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.arrayBuffer()).byteLength, 10);
  assert.equal((await serveProtectedVideo({ request: await granted(), env: { ...env, PROTECTED_MEDIA_BUCKET: undefined } })).status, 503);
});
test('server checks Turnstile success, hostname and action; network errors deny', async () => {
  const original = globalThis.fetch;
  const cfEnv = { TURNSTILE_SECRET_KEY: 'secret', PLAYBACK_HOSTNAMES: 'karaoke.example' };
  try {
    for (const result of [{ success: false }, { success: true, hostname: 'thief.example', action: 'fantaisie_playback' }, { success: true, hostname: 'karaoke.example', action: 'login' }]) {
      globalThis.fetch = async () => Response.json(result);
      assert.equal(await verifyTurnstile(mintRequest(), cfEnv, 'token'), false);
    }
    globalThis.fetch = async () => Response.json({ success: true, hostname: 'karaoke.example', action: 'fantaisie_playback' });
    assert.equal(await verifyTurnstile(mintRequest(), cfEnv, 'token'), true);
    assert.equal(await verifyTurnstile(mintRequest(), cfEnv, ''), false);
    assert.equal(await verifyTurnstile(mintRequest(), { ...cfEnv, PLAYBACK_HOSTNAMES: 'other.example' }, 'token'), false);
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await verifyTurnstile(mintRequest(), cfEnv, 'token'), false);
  } finally { globalThis.fetch = original; }
});
test('session endpoint cannot mint a cookie without a verified Turnstile token', async () => {
  const request = new Request(mintRequest(), { headers: { origin: 'https://karaoke.example', 'content-type': 'application/json' }, body: JSON.stringify({ token: '' }) });
  const response = await session({ request, env });
  assert.equal(response.status, 403); assert.equal(response.headers.get('set-cookie'), null);
});
test('successful Turnstile token issues grant; reused token cannot issue another', async () => {
  const original = globalThis.fetch;
  let used = false;
  const cfEnv = { ...env, TURNSTILE_SECRET_KEY: 'secret', PLAYBACK_HOSTNAMES: 'karaoke.example' };
  const request = () => new Request(mintRequest(), { headers: { origin: 'https://karaoke.example', 'content-type': 'application/json', 'user-agent': 'viewer' }, body: JSON.stringify({ token: 'single-use-token' }) });
  try {
    globalThis.fetch = async () => {
      if (used) return Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
      used = true;
      return Response.json({ success: true, hostname: 'karaoke.example', action: 'fantaisie_playback' });
    };
    const first = await session({ request: request(), env: cfEnv });
    assert.equal(first.status, 200); assert.ok(first.headers.get('set-cookie'));
    const second = await session({ request: request(), env: cfEnv });
    assert.equal(second.status, 403); assert.equal(second.headers.get('set-cookie'), null);
  } finally { globalThis.fetch = original; }
});
test('HEAD and unsatisfiable range return correct headers without downloading video', async () => {
  const cfEnv = { ...env, PROTECTED_MEDIA_BUCKET: { head: async () => ({ size: 100 }), get: () => assert.fail('must not download a body') } };
  const response = await serveProtectedVideo({ env: cfEnv, request: new Request(await granted(), { method: 'HEAD' }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), '100');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  const invalid = await serveProtectedVideo({ env: cfEnv, request: await granted({ range: 'bytes=100-' }) });
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */100');
});
