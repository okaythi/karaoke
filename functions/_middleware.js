// Global Cloudflare Pages middleware to block all rich link preview embed generation
import { apiDenied, isAdminPath, isSameOriginWrite, notFound, resolveAdminAccess, signInPage } from '../src/server/adminGate.js';

const SCRAPER_PATTERN = /facebookexternalhit|Facebot|facebookcatalog|meta-externalagent|Twitterbot|Discordbot|TelegramBot|WhatsApp|LinkedInBot|Slackbot|SkypeUriPreview|Applebot|Googlebot|bingbot|Yahoo|Baidu|DuckDuckBot|Yandex|bot|crawl|spider|preview|fetcher/i;
const ROBOTS_TAG = 'noindex, nofollow, nosnippet, noimageindex, noarchive';

export async function onRequest(context) {
  const { request, next } = context;
  const ua = request.headers.get('user-agent') || '';

  // Runs before every route, including the shortlink router, so scrapers never reach them.
  if (SCRAPER_PATTERN.test(ua)) {
    // Return empty 200 plain text with zero content so chat apps produce zero embed card
    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Robots-Tag': ROBOTS_TAG,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  // The upload portal and its API are for INTERNAL_SUPER_ADMIN accounts only.
  const { pathname } = new URL(request.url);
  if (isAdminPath(pathname)) {
    const isApi = pathname.startsWith('/api/');
    if (isApi && !isSameOriginWrite(request)) return apiDenied(403);
    const access = await resolveAdminAccess(request);
    if (access === 'signed-out') return isApi ? apiDenied(401) : signInPage(request);
    if (access !== 'admin') return isApi ? apiDenied(403) : notFound();
  }

  const response = await next();

  // Attach anti-snippet and noindex headers to all responses. The response
  // from next() may have immutable headers, so it is re-wrapped first.
  const wrapped = new Response(response.body, response);
  wrapped.headers.set('X-Robots-Tag', ROBOTS_TAG);
  wrapped.headers.set('X-Content-Type-Options', 'nosniff');
  return wrapped;
}
