import type { Context } from '../../../../src/server/http';
import { issuePlaybackGrant, playbackError, PRIVATE_HEADERS, sameOriginRequest } from '../../../../src/server/playbackGate';
import { verifyTurnstile } from '../../../../src/server/turnstile';

/** The token itself is at most 2048 characters. */
const MAX_BODY_BYTES = 4096;

/** Reads the body up to the limit; `null` when it is larger. */
async function readBounded(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function onRequest({ request, env }: Context): Promise<Response> {
  if (request.method === 'GET') {
    if (!sameOriginRequest(request)) return playbackError(403, 'Forbidden');
    if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY || !env.PROTECTED_MEDIA_BUCKET || !env.PLAYBACK_SIGNING_SECRET)
      return playbackError(503, 'Protected playback unavailable');
    return Response.json({ siteKey: env.TURNSTILE_SITE_KEY }, { headers: PRIVATE_HEADERS });
  }
  if (request.method !== 'POST') return playbackError(405, 'Method not allowed');
  if (!sameOriginRequest(request, true)) return playbackError(403, 'Forbidden');
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return playbackError(415, 'JSON required');
  if (!request.body) return playbackError(400, 'Invalid playback request');
  try {
    // Bound the payload before parsing it.
    const bytes = await readBounded(request.body as ReadableStream<Uint8Array>);
    if (!bytes) return playbackError(413, 'Request too large');
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!await verifyTurnstile(request, env, body.token)) return playbackError(403, 'Playback verification failed');
    return issuePlaybackGrant(request, env);
  } catch {
    return playbackError(400, 'Invalid playback request');
  }
}
