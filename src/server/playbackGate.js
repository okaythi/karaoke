// Anonymous playback grants deter hotlinking and URL sharing. They are NOT DRM:
// a public viewer can request a grant and inspect the bytes they receive.
import { PROTECTED_SONG_ID } from '../security/protectedSong.js';
const COOKIE = '__Host-karaoke_playback';
export const GRANT_SECONDS = 15 * 60;
const encoder = new TextEncoder();
export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
export function playbackError(status, error) {
  return Response.json({ error }, { status, headers: PRIVATE_HEADERS });
}
function configured(env) {
  return typeof env.PLAYBACK_SIGNING_SECRET === 'string' && encoder.encode(env.PLAYBACK_SIGNING_SECRET).length >= 32;
}
function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unbase64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function key(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.PLAYBACK_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function agentHash(request) {
  return base64(await crypto.subtle.digest('SHA-256', encoder.encode(request.headers.get('user-agent') || '')));
}
export function sameOriginRequest(request, write = false) {
  const origin = new URL(request.url).origin;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const supplied = request.headers.get('origin');
  if (write) return supplied === origin;
  if (supplied && supplied !== origin) return false;
  if (request.headers.get('sec-fetch-mode') === 'navigate') return false;
  return true;
}
export async function issuePlaybackGrant(request, env, now = Date.now()) {
  if (!sameOriginRequest(request, true)) return playbackError(403, 'Forbidden');
  if (!configured(env) || !env.PROTECTED_MEDIA_BUCKET) return playbackError(503, 'Protected playback unavailable');
  const iat = Math.floor(now / 1000);
  const payload = base64(encoder.encode(JSON.stringify({ v: 1, song: PROTECTED_SONG_ID, iat, exp: iat + GRANT_SECONDS, ua: await agentHash(request), nonce: crypto.randomUUID() })));
  const signature = base64(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(payload)));
  return Response.json({ expiresAt: (iat + GRANT_SECONDS) * 1000 }, {
    headers: { ...PRIVATE_HEADERS, 'Set-Cookie': `${COOKIE}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${GRANT_SECONDS}` }
  });
}
export async function verifyPlaybackGrant(request, env, now = Date.now()) {
  if (!sameOriginRequest(request) || !configured(env)) return false;
  const matches = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return false;
  const token = matches[0].slice(COOKIE.length + 1);
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  const [payload, signature] = token.split('.');
  try {
    if (!await crypto.subtle.verify('HMAC', await key(env), unbase64(signature), encoder.encode(payload))) return false;
    const grant = JSON.parse(new TextDecoder().decode(unbase64(payload)));
    const seconds = Math.floor(now / 1000);
    return grant.v === 1 && grant.song === PROTECTED_SONG_ID && Number.isInteger(grant.iat) && Number.isInteger(grant.exp)
      && grant.iat <= seconds && grant.exp > seconds && grant.exp - grant.iat === GRANT_SECONDS
      && grant.ua === await agentHash(request);
  } catch { return false; }
}
