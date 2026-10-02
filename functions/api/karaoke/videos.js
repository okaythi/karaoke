// Lists all video files and live lyrics overlays hosted in Cloudflare R2 MEDIA_BUCKET

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
};

/** R2 returns at most 1000 keys per call; follow the cursor so no song drops out of the catalog. */
async function listAllObjects(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ cursor });
    objects.push(...(page.objects || []));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function onRequestGet({ env }) {
  if (!env.MEDIA_BUCKET) {
    return new Response(JSON.stringify({ error: 'MEDIA_BUCKET not bound', videos: [], liveLyrics: [] }), {
      status: 200,
      headers: HEADERS
    });
  }

  try {
    const objects = await listAllObjects(env.MEDIA_BUCKET);
    const liveLyrics = objects
      .filter(o => o.key.startsWith('_lyrics_live/') && o.key.endsWith('.json'))
      .map(o => o.key.slice('_lyrics_live/'.length, -'.json'.length));

    const videos = objects
      .filter(o => !o.key.startsWith('karaoke-source/') && /\.(mp4|webm|mkv)$/i.test(o.key))
      .map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded
      }));

    return new Response(JSON.stringify({ videos, liveLyrics }), { headers: HEADERS });
  } catch (err) {
    console.error('[videos] listing failed:', err);
    return new Response(JSON.stringify({ error: 'Listing failed', videos: [], liveLyrics: [] }), {
      status: 500,
      headers: HEADERS
    });
  }
}
