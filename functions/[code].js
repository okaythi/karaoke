// Cloudflare Pages dynamic shortlink router for karaoke.nixlabs.tech/[6-digit-code]
export async function onRequest({ request, params, env }) {
  const code = params.code;

  // Only match 6-character alphanumeric codes
  if (!code || !/^[A-Za-z0-9]{6}$/.test(code)) {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }

  // 1. Look up song in D1 database
  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT song_id FROM song_links WHERE code = ?').bind(code).first();
      if (row && row.song_id) {
        const redirectUrl = new URL(`/?song=${encodeURIComponent(row.song_id)}`, request.url);
        return Response.redirect(redirectUrl.toString(), 302);
      }
    } catch (err) {
      console.warn('[Shortlink Router] D1 lookup failed:', err);
    }
  }

  // Fallback: redirect to homepage
  return Response.redirect(new URL('/', request.url).toString(), 302);
}
