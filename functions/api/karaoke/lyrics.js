// Live lyrics overlay reader from R2

function json(data, status) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Song IDs are single path segments (slugs, possibly Japanese). */
function isSongId(id) {
  return id.length <= 200 && !/[\/\\]/.test(id) && !id.includes('..');
}

export async function onRequestGet({ request, env }) {
  if (!env.MEDIA_BUCKET) {
    return json({ error: 'MEDIA_BUCKET not bound' }, 404);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return json({ error: 'Missing id param' }, 400);
  }
  if (!isSongId(id)) {
    return json({ error: 'Invalid id param' }, 400);
  }

  try {
    // Conditional read: an unchanged overlay answers 304 without a body.
    const object = await env.MEDIA_BUCKET.get(`_lyrics_live/${id}.json`, { onlyIf: request.headers });

    if (!object) {
      return json({ error: 'Not found in live overlay' }, 404);
    }

    // `no-cache` still revalidates every request, so saves show up at once,
    // but an unchanged overlay is not downloaded again.
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'ETag': object.httpEtag
    });
    if (!('body' in object)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch (err) {
    console.error('[lyrics] overlay read failed:', err);
    return json({ error: 'Overlay read failed' }, 500);
  }
}
