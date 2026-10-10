// Anonymous playback grants deter hotlinking and URL sharing. They are NOT DRM:
// a public viewer can request a grant and inspect the bytes they receive.
import { PROTECTED_SONG_ID } from '../security/protectedSong.js';
import { cookieValues, type Env } from './http';

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
  'Referrer-Policy': 'no-referrer'
};

export function playbackError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: PRIVATE_HEADERS });
}

function configured(env: Env): env is Env & { PLAYBACK_SIGNING_SECRET: string } {
  return typeof env.PLAYBACK_SIGNING_SECRET === 'string' && encoder.encode(env.PLAYBACK_SIGNING_SECRET).length >= 32;
}

function base64(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function agentHash(request: Request): Promise<string> {
  return base64(await crypto.subtle.digest('SHA-256', encoder.encode(request.headers.get('user-agent') || '')));
}

export function sameOriginRequest(request: Request, write = false): boolean {
  const origin = new URL(request.url).origin;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const supplied = request.headers.get('origin');
  if (write) return supplied === origin;
  if (supplied && supplied !== origin) return false;
  if (request.headers.get('sec-fetch-mode') === 'navigate') return false;
  return true;
}

export async function issuePlaybackGrant(request: Request, env: Env, now = Date.now()): Promise<Response> {
  if (!sameOriginRequest(request, true)) return playbackError(403, 'Forbidden');
  if (!configured(env) || !env.PROTECTED_MEDIA_BUCKET) return playbackError(503, 'Protected playback unavailable');
  const iat = Math.floor(now / 1000);
  const payload = base64(encoder.encode(JSON.stringify({
    v: 1, song: PROTECTED_SONG_ID, iat, exp: iat + GRANT_SECONDS, ua: await agentHash(request), nonce: crypto.randomUUID()
  })));
  const signature = base64(await crypto.subtle.sign('HMAC', await signingKey(env.PLAYBACK_SIGNING_SECRET), encoder.encode(payload)));
  return Response.json({ expiresAt: (iat + GRANT_SECONDS) * 1000 }, {
    headers: { ...PRIVATE_HEADERS, 'Set-Cookie': `${COOKIE}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${GRANT_SECONDS}` }
  });
}

export async function verifyPlaybackGrant(request: Request, env: Env, now = Date.now()): Promise<boolean> {
  if (!sameOriginRequest(request) || !configured(env)) return false;
  // Two cookies of this name means one was injected; neither is trusted.
  const tokens = cookieValues(request, COOKIE);
  if (tokens.length !== 1) return false;
  const [token] = tokens;
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  const [payload, signature] = token.split('.');
  try {
    if (!await crypto.subtle.verify('HMAC', await signingKey(env.PLAYBACK_SIGNING_SECRET), unbase64(signature), encoder.encode(payload))) return false;
    const grant = JSON.parse(new TextDecoder().decode(unbase64(payload)));
    const seconds = Math.floor(now / 1000);
    return grant.v === 1 && grant.song === PROTECTED_SONG_ID && Number.isInteger(grant.iat) && Number.isInteger(grant.exp)
      && grant.iat <= seconds && grant.exp > seconds && grant.exp - grant.iat === GRANT_SECONDS
      && grant.ua === await agentHash(request);
  } catch {
    return false;
  }
}
