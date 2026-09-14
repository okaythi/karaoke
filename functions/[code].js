// Cloudflare Pages dynamic shortlink router
export async function onRequest({ request, params, env }) {
  const code = params.code;

  const ua = request.headers.get('user-agent') || '';
  if (/facebookexternalhit|Facebot|facebookcatalog|meta-externalagent|Twitterbot|Discordbot|TelegramBot|WhatsApp|LinkedInBot|Slackbot|SkypeUriPreview|Applebot|Googlebot|bingbot|bot|crawl|spider|preview|fetcher/i.test(ua)) {
    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Robots-Tag': 'noindex, nofollow, nosnippet, noimageindex, noarchive',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  // Pass through asset requests (files with extensions) or reserved paths
  if (!code || code.includes('.') || code === 'admin' || code === 'api') {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }

  // 1. Look up song in D1 database by share code or song_id slug
  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT song_id FROM song_links WHERE code = ? OR song_id = ?').bind(code, code).first();
      if (row && row.song_id) {
        const redirectUrl = new URL(`/?song=${encodeURIComponent(row.song_id)}`, request.url);
        return Response.redirect(redirectUrl.toString(), 302);
      }
    } catch (err) {
      console.warn('[Shortlink Router] D1 lookup failed:', err);
    }
  }

  // 2. If it's a valid slug, redirect directly to the song player
  if (/^[A-Za-z0-9_-]+$/.test(code)) {
    return Response.redirect(new URL(`/?song=${encodeURIComponent(code)}`, request.url).toString(), 302);
  }

  // Fallback: redirect to homepage
  return Response.redirect(new URL('/', request.url).toString(), 302);
}
