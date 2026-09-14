// Global Cloudflare Pages middleware to block all rich link preview embed generation
export async function onRequest(context) {
  const { request, next } = context;
  const ua = request.headers.get('user-agent') || '';

  const isScraper = /facebookexternalhit|Facebot|facebookcatalog|meta-externalagent|Twitterbot|Discordbot|TelegramBot|WhatsApp|LinkedInBot|Slackbot|SkypeUriPreview|Applebot|Googlebot|bingbot|Yahoo|Baidu|DuckDuckBot|Yandex|bot|crawl|spider|preview|fetcher/i.test(ua);

  if (isScraper) {
    // Return empty 200 plain text with zero content so chat apps produce zero embed card
    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Robots-Tag': 'noindex, nofollow, nosnippet, noimageindex, noarchive',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  const response = await next();

  // Attach anti-snippet and noindex headers to all responses
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noimageindex, noarchive');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
