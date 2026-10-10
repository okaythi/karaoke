// Runs before every route: answers link-preview scrapers with nothing and gates the admin area.
import { apiDenied, isAdminPath, isSameOriginWrite, notFound, resolveAdminAccess, signInPage } from '../src/server/adminGate';
import type { Context } from '../src/server/http';

const SCRAPER_PATTERN = /facebookexternalhit|Facebot|facebookcatalog|meta-externalagent|Twitterbot|Discordbot|TelegramBot|WhatsApp|LinkedInBot|Slackbot|SkypeUriPreview|Applebot|Googlebot|bingbot|Yahoo|Baidu|DuckDuckBot|Yandex|bot|crawl|spider|preview|fetcher/i;
const ROBOTS_TAG = 'noindex, nofollow, nosnippet, noimageindex, noarchive';

export async function onRequest({ request, next }: Context): Promise<Response> {
  // An empty body gives chat apps nothing to build an embed card from.
  if (SCRAPER_PATTERN.test(request.headers.get('user-agent') || '')) {
    return new Response('', {
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

  // The response from next() may have immutable headers, so it is re-wrapped first.
  const response = await next();
  const wrapped = new Response(response.body, response);
  wrapped.headers.set('X-Robots-Tag', ROBOTS_TAG);
  wrapped.headers.set('X-Content-Type-Options', 'nosniff');
  return wrapped;
}
