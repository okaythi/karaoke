import { issuePlaybackGrant, playbackError, PRIVATE_HEADERS, sameOriginRequest } from '../../../../src/server/playbackGate.js';
import { verifyTurnstile } from '../../../../src/server/turnstile.js';
export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    if (!sameOriginRequest(request)) return playbackError(403, 'Forbidden');
    if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY || !env.PROTECTED_MEDIA_BUCKET || !env.PLAYBACK_SIGNING_SECRET)
      return playbackError(503, 'Protected playback unavailable');
    return Response.json({ siteKey: env.TURNSTILE_SITE_KEY }, { headers: PRIVATE_HEADERS });
  }
  if (request.method !== 'POST') return playbackError(405, 'Method not allowed');
  if (!sameOriginRequest(request, true)) return playbackError(403, 'Forbidden');
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return playbackError(415, 'JSON required');
  // Bound the payload before parsing; the token itself is at most 2048 characters.
  const reader = request.body?.getReader();
  if (!reader) return playbackError(400, 'Invalid playback request');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return playbackError(413, 'Request too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!await verifyTurnstile(request, env, body.token)) return playbackError(403, 'Playback verification failed');
    return issuePlaybackGrant(request, env);
  } catch { return playbackError(400, 'Invalid playback request'); }
}
