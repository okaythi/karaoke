import { PROTECTED_SCORE_KEY } from '../../../../src/security/protectedSong.js';
import type { Context } from '../../../../src/server/http';
import { PRIVATE_HEADERS, playbackError, verifyPlaybackGrant } from '../../../../src/server/playbackGate';

export async function onRequest({ request, env }: Context): Promise<Response> {
  if (request.method !== 'GET') return playbackError(405, 'Method not allowed');
  if (!await verifyPlaybackGrant(request, env)) return playbackError(403, 'Playback session required');
  if (!env.PROTECTED_MEDIA_BUCKET) return playbackError(503, 'Protected arrangement unavailable');
  try {
    const object = await env.PROTECTED_MEDIA_BUCKET.get(PROTECTED_SCORE_KEY);
    if (!object) return playbackError(404, 'Protected arrangement unavailable');
    return new Response(object.body as BodyInit, { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'application/json' } });
  } catch {
    return playbackError(503, 'Protected arrangement unavailable');
  }
}
