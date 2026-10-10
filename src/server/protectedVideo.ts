import { PROTECTED_VIDEO_KEY } from '../security/protectedSong.js';
import type { Env } from './http';
import { PRIVATE_HEADERS, playbackError, verifyPlaybackGrant } from './playbackGate';

/** The byte range a `Range` header asks for: `null` when absent, `false` when it cannot be satisfied. */
export function parseRange(header: string | null, size: number): { offset: number; length: number } | null | false {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}

export async function serveProtectedVideo({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return playbackError(405, 'Method not allowed');
  if (!await verifyPlaybackGrant(request, env)) return playbackError(403, 'Playback session required');
  // Never fall back to MEDIA_BUCKET: it has a public CDN origin.
  if (!env.PROTECTED_MEDIA_BUCKET) return playbackError(503, 'Protected playback unavailable');
  try {
    const object = await env.PROTECTED_MEDIA_BUCKET.head(PROTECTED_VIDEO_KEY);
    if (!object) return playbackError(404, 'Media unavailable');
    const headers = new Headers({ ...PRIVATE_HEADERS, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    let rangeHeader = request.headers.get('range');
    // A mismatched validator requires the complete representation.
    if (request.headers.has('if-range') && request.headers.get('if-range') !== object.httpEtag) rangeHeader = null;
    const range = request.method === 'HEAD' ? null : parseRange(rangeHeader, object.size);
    if (range === false) {
      headers.set('Content-Range', `bytes */${object.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Length', String(range ? range.length : object.size));
    if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    if (request.method === 'HEAD') return new Response(null, { headers });
    const body = await env.PROTECTED_MEDIA_BUCKET.get(PROTECTED_VIDEO_KEY, {
      onlyIf: { etagMatches: object.etag }, ...(range ? { range } : {})
    });
    if (!body || !('body' in body)) return playbackError(409, 'Media changed; retry playback');
    return new Response(body.body as BodyInit, { status: range ? 206 : 200, headers });
  } catch {
    return playbackError(503, 'Protected playback unavailable');
  }
}
