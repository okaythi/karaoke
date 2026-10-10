// Stores an uploaded video in R2 and registers its share link.
import { VIDEO_EXTENSION, mediaUrl } from '../../../../src/core/media';
import { canonicalSongId, parseSongInfoFromFilename } from '../../../../src/core/tokenizer';
import { isProtectedVideo, PROTECTED_MEDIA_PATH } from '../../../../src/security/protectedSong.js';
import { json, type Context } from '../../../../src/server/http';
import { dropListing } from '../../../../src/server/listingCache';

const SHARE_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHARE_CODE_LENGTH = 6;
const SHARE_CODE_ATTEMPTS = 5;
const MIME_TYPES: Record<string, string> = { webm: 'video/webm', mkv: 'video/x-matroska' };

function randomShareCode(): string {
  const picks = crypto.getRandomValues(new Uint8Array(SHARE_CODE_LENGTH));
  return Array.from(picks, pick => SHARE_CODE_CHARS[pick % SHARE_CODE_CHARS.length]).join('');
}

/** The video's share code: the one already registered for this file, or a new unused one. */
async function registerShareCode(db: D1Database, fileName: string): Promise<string> {
  const existing = await db.prepare('SELECT code FROM song_links WHERE file_name = ?').bind(fileName).first<{ code: string }>();
  if (existing?.code) return existing.code;

  let code = randomShareCode();
  for (let attempt = 0; attempt < SHARE_CODE_ATTEMPTS; attempt++) {
    if (!await db.prepare('SELECT 1 FROM song_links WHERE code = ?').bind(code).first()) break;
    code = randomShareCode();
  }
  // The same ID the catalog derives for a video it finds in R2, so the link opens that song.
  const { artist, title } = parseSongInfoFromFilename(fileName);
  await db.prepare('INSERT INTO song_links (code, song_id, file_name) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING')
    .bind(code, canonicalSongId(artist, title), fileName)
    .run();
  return code;
}

/** The file name and byte stream of the upload, sent either as a form field or as the raw body. */
async function readUpload(request: Request): Promise<{ filename: string; body: ReadableStream | null }> {
  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    const file = (await request.formData()).get('video');
    return typeof file === 'string' || !file ? { filename: '', body: null } : { filename: file.name, body: file.stream() };
  }
  return { filename: new URL(request.url).searchParams.get('filename') || '', body: request.body };
}

function cleanKey(filename: string): string {
  let key = filename;
  try {
    key = decodeURIComponent(key);
  } catch {
    // Not percent-encoded; use the name as sent.
  }
  return key.replace(/[\/\\:*?"<>|]/g, '').trim();
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  if (!env.MEDIA_BUCKET) {
    return json({ error: 'MEDIA_BUCKET not bound' }, 500);
  }

  try {
    const { filename, body } = await readUpload(request);
    if (!filename || !VIDEO_EXTENSION.test(filename)) {
      return json({ error: filename ? 'File must be .mp4, .webm, or .mkv' : 'No video file provided' }, 400);
    }
    if (!body || request.headers.get('content-length') === '0') {
      return json({ error: 'Video upload payload is empty' }, 400);
    }

    const key = cleanKey(filename);
    if (!key) {
      return json({ error: 'Invalid filename' }, 400);
    }

    const protectedVideo = isProtectedVideo(key);
    const bucket = protectedVideo ? env.PROTECTED_MEDIA_BUCKET : env.MEDIA_BUCKET;
    if (!bucket) return json({ error: 'Private media storage is not configured' }, 503);

    const extension = key.split('.').pop()?.toLowerCase() ?? '';
    await bucket.put(key, body as unknown as Parameters<R2Bucket['put']>[1], {
      httpMetadata: { contentType: MIME_TYPES[extension] ?? 'video/mp4' }
    });
    await dropListing(request);

    let shareCode = randomShareCode();
    if (env.DB) {
      try {
        shareCode = await registerShareCode(env.DB, key);
      } catch (error) {
        console.warn('[upload] share link was not registered:', error);
      }
    }

    return json({
      success: true,
      key,
      shareCode,
      videoUrl: protectedVideo ? PROTECTED_MEDIA_PATH : mediaUrl(key)
    });
  } catch (error) {
    console.error('[upload] failed:', error);
    return json({ error: 'Upload failed' }, 500);
  }
}
