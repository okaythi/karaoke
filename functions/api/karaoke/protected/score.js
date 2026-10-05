import { PRIVATE_HEADERS, playbackError, verifyPlaybackGrant } from '../../../../src/server/playbackGate.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return playbackError(405, 'Method not allowed');
  if (!await verifyPlaybackGrant(request, env)) return playbackError(403, 'Playback session required');
  if (!env.PROTECTED_MEDIA_BUCKET) return playbackError(503, 'Protected arrangement unavailable');
  try {
    const object = await env.PROTECTED_MEDIA_BUCKET.get('fantaisie/runtime-score.json');
    if (!object) return playbackError(404, 'Protected arrangement unavailable');
    return new Response(object.body, { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'application/json' } });
  } catch { return playbackError(503, 'Protected arrangement unavailable'); }
}
