// Shortlink router: /<share code or song id> opens that song in the player.
// Link-preview scrapers are already answered by _middleware.ts.
import type { Context } from '../src/server/http';

const MAX_CODE_LENGTH = 200;

export async function onRequest({ request, params, env }: Context): Promise<Response> {
  const code = typeof params.code === 'string' ? params.code : '';
  const playerAt = (songId?: string) =>
    Response.redirect(new URL(songId ? `/?song=${encodeURIComponent(songId)}` : '/', request.url).toString(), 302);

  // Asset requests (anything with an extension) and reserved paths pass through.
  if (!code || code.includes('.') || code === 'admin' || code === 'api') {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }

  if (env.DB && code.length <= MAX_CODE_LENGTH) {
    try {
      const row = await env.DB.prepare('SELECT song_id FROM song_links WHERE code = ? OR song_id = ?').bind(code, code).first<{ song_id: string }>();
      if (row?.song_id) return playerAt(row.song_id);
    } catch (error) {
      console.warn('[shortlink] lookup failed:', error);
    }
  }

  // An unregistered slug may still be a song id the player knows.
  return /^[A-Za-z0-9_-]+$/.test(code) ? playerAt(code) : playerAt();
}
