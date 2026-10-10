// Lists the videos and live lyric overlays held in R2.
import { VIDEO_EXTENSION } from '../../../src/core/media';
import { PROTECTED_VIDEO_KEY, isProtectedVideo } from '../../../src/security/protectedSong.js';
import { json, type Context } from '../../../src/server/http';
import { LISTING_TTL_SECONDS, readListing, storeListing } from '../../../src/server/listingCache';

const LIVE_LYRICS_PREFIX = '_lyrics_live/';

/** R2 returns at most 1000 keys per call; follow the cursor so no song drops out of the catalog. */
async function listAllObjects(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function onRequestGet({ request, env, waitUntil }: Context): Promise<Response> {
  if (!env.MEDIA_BUCKET) {
    return json({ error: 'MEDIA_BUCKET not bound', videos: [], liveLyrics: [] });
  }

  const cached = await readListing(request);
  if (cached) return cached;

  try {
    const [objects, protectedVideo] = await Promise.all([
      listAllObjects(env.MEDIA_BUCKET),
      env.PROTECTED_MEDIA_BUCKET?.head(PROTECTED_VIDEO_KEY)
    ]);

    const liveLyrics = objects
      .filter(o => o.key.startsWith(LIVE_LYRICS_PREFIX) && o.key.endsWith('.json'))
      .map(o => o.key.slice(LIVE_LYRICS_PREFIX.length, -'.json'.length));

    const videos: { key: string; size?: number; uploaded?: Date }[] = objects
      .filter(o => !isProtectedVideo(o.key) && !o.key.startsWith('karaoke-source/') && VIDEO_EXTENSION.test(o.key))
      .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
    if (protectedVideo) videos.push({ key: PROTECTED_VIDEO_KEY });

    const response = json({ videos, liveLyrics }, 200, { 'Cache-Control': `public, max-age=${LISTING_TTL_SECONDS}` });
    waitUntil(storeListing(request, response.clone()));
    return response;
  } catch (error) {
    console.error('[videos] listing failed:', error);
    return json({ error: 'Listing failed', videos: [], liveLyrics: [] }, 500);
  }
}
