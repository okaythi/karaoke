// Saves a song's lyrics: to R2 at once so playback picks them up, then to the repository for good.
import { validateSongContract } from '../../../../src/core/contracts';
import { isSongId, json, type Context, type Env } from '../../../../src/server/http';
import { dropListing } from '../../../../src/server/listingCache';
import type { SaveLyricsPayload } from '../../../../src/types/karaoke';

/** UTF-8 safe base64 for the GitHub contents API. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Commits the lyric file through the GitHub contents API. Returns an error message, or null on success. */
async function commitToGitHub(env: Env, id: string, content: string): Promise<string | null> {
  const repo = env.GITHUB_REPO || 'okaythi/gewoonthy';
  const branch = env.GITHUB_BRANCH || 'production';
  const fileUrl = `https://api.github.com/repos/${repo}/contents/src/data/lyrics/${id}.json`;
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare-Pages-Karaoke-Studio'
  };

  // An existing file can only be replaced by naming its current blob.
  const current = await fetch(`${fileUrl}?ref=${branch}`, { headers });
  const sha = current.ok ? (await current.json() as { sha?: string }).sha : undefined;

  const commit = await fetch(fileUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: `sync(lyrics): update timings for ${id}`, content: toBase64(content), branch, sha })
  });
  if (commit.ok) return null;
  return (await commit.json() as { message?: string }).message || 'GitHub commit failed';
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  let payload: SaveLyricsPayload;
  try {
    payload = await request.json() as SaveLyricsPayload;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const contract = validateSongContract(payload);
  if (!contract.valid || !isSongId(payload.id)) {
    return json({ error: 'Invalid SaveLyricsPayload structure', details: contract.errors }, 400);
  }

  const { id } = payload;
  const content = JSON.stringify(payload, null, 2);
  let liveCached = false;
  let githubCommitted = false;
  let githubError: string | null = null;

  if (env.MEDIA_BUCKET) {
    try {
      await env.MEDIA_BUCKET.put(`_lyrics_live/${id}.json`, content, { httpMetadata: { contentType: 'application/json' } });
      await dropListing(request);
      liveCached = true;
    } catch (error) {
      console.warn('[save] live overlay write failed:', error);
    }
  }

  if (env.GITHUB_TOKEN) {
    try {
      githubError = await commitToGitHub(env, id, content);
      githubCommitted = githubError === null;
    } catch (error) {
      console.warn('[save] GitHub commit failed:', error);
      githubError = 'GitHub commit failed';
    }
  }

  return json({ success: true, id, liveCached, githubCommitted, githubError });
}
