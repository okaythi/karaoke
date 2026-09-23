// Upload video endpoint for Karaoke in Cloudflare Pages
export async function onRequestPost({ request, env }) {
  if (!env.MEDIA_BUCKET) {
    return new Response(JSON.stringify({ error: 'MEDIA_BUCKET not bound' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let filename = '';
    let fileBody = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('video');
      if (!file || typeof file === 'string') {
        return new Response(JSON.stringify({ error: 'No video file provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      filename = file.name;
      fileBody = file.stream();
    } else {
      const url = new URL(request.url);
      filename = url.searchParams.get('filename') || '';
      fileBody = request.body;
    }

    if (!filename || !/\.(mp4|webm|mkv)$/i.test(filename)) {
      return new Response(JSON.stringify({ error: 'File must be .mp4, .webm, or .mkv' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength === '0' || !fileBody) {
      return new Response(JSON.stringify({ error: 'Video upload payload is empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Clean and decode filename
    let cleanKey = filename;
    try {
      cleanKey = decodeURIComponent(cleanKey);
    } catch (_) {}
    cleanKey = cleanKey.replace(/[\/\\:*?"<>|]/g, '').trim();

    if (!cleanKey) {
      return new Response(JSON.stringify({ error: 'Invalid filename' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const ext = cleanKey.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'webm' ? 'video/webm' : ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';

    await env.MEDIA_BUCKET.put(cleanKey, fileBody, {
      httpMetadata: {
        contentType: mimeType
      }
    });

    // Generate unique 6-digit alphanumeric code for the song
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let shareCode = '';
    for (let i = 0; i < 6; i++) {
      shareCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    if (env.DB) {
      try {
        const existing = await env.DB.prepare('SELECT code FROM song_links WHERE file_name = ?').bind(cleanKey).first();
        if (existing?.code) {
          shareCode = existing.code;
        } else {
          for (let attempt = 0; attempt < 5; attempt++) {
            const collision = await env.DB.prepare('SELECT 1 FROM song_links WHERE code = ?').bind(shareCode).first();
            if (!collision) break;
            shareCode = '';
            for (let i = 0; i < 6; i++) {
              shareCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }
          }
          const defaultSongId = cleanKey.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          await env.DB.prepare('INSERT INTO song_links (code, song_id, file_name) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING')
            .bind(shareCode, defaultSongId, cleanKey)
            .run();
        }
      } catch (dbErr) {
        console.warn('Could not register share link in D1:', dbErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      key: cleanKey,
      shareCode,
      videoUrl: `https://cdn.sudothy.me/${encodeURIComponent(cleanKey)}`
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
