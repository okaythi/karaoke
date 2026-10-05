import { PROTECTED_VIDEO_KEY } from '../../src/security/protectedSong.js';
export function isLegacyProtectedPath(pathname) {
  let path = pathname.slice(1);
  for (let pass = 0; pass < 3; pass++) {
    if (path.normalize('NFC') === PROTECTED_VIDEO_KEY) return true;
    try { path = decodeURIComponent(path); } catch { return false; }
  }
  return false;
}
export default {
  async fetch(request) {
    if (isLegacyProtectedPath(new URL(request.url).pathname)) {
      // Deny before any CDN cache lookup. The original object is already removed.
      return new Response('Not found', {
        status: 410,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' }
      });
    }
    return fetch(request);
  }
};
