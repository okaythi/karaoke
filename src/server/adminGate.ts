// Admin access for the upload portal (/admin*) and its API (/api/admin/*).
//
// Only Nixlabs accounts holding the INTERNAL_SUPER_ADMIN role flag may enter.
// Role flags live in the Accounts IdP's database, not in the session token,
// so the visitor's `_nixlabs_session` cookie is forwarded to the IdP's
// authoritative session endpoint, which also checks signature, expiry,
// revocation and account standing. Any failure denies access.

import { cookieValues } from './http';

const ACCOUNTS_ORIGIN = 'https://accounts.nixlabs.tech';
const SESSION_COOKIE = '_nixlabs_session';

/** Mirrors RoleFlag in the accounts project (src/flags.ts). */
export const RoleFlag = Object.freeze({
  MEMBER: 1 << 0,
  MEMBER_PREMIUM: 1 << 1,
  INTERNAL_TEST: 1 << 2,
  INTERNAL_SUPER_ADMIN: 1 << 3,
});

export function isAdminPath(pathname: string): boolean {
  return /^\/(api\/)?admin(\/|$)/.test(pathname);
}

/** Resolves the caller's standing with the IdP. */
export async function resolveAdminAccess(request: Request): Promise<'admin' | 'signed-out' | 'forbidden'> {
  const [token] = cookieValues(request, SESSION_COOKIE);
  if (!token) return 'signed-out';
  try {
    const res = await fetch(`${ACCOUNTS_ORIGIN}/api/session`, {
      headers: { Accept: 'application/json', Cookie: `${SESSION_COOKIE}=${token}` },
    });
    if (!res.ok) return 'forbidden';
    const session = await res.json() as { authenticated?: boolean; account?: { banned?: boolean }; user?: { role_flags?: unknown } };
    if (!session?.authenticated) return 'signed-out';
    if (session.account?.banned) return 'forbidden';
    const flags = Number(session.user?.role_flags) | 0;
    return (flags & RoleFlag.INTERNAL_SUPER_ADMIN) !== 0 ? 'admin' : 'forbidden';
  } catch (error) {
    console.error('[admin] session lookup failed:', error);
    return 'forbidden';
  }
}

/** State-changing admin API calls must come from the karaoke site itself. */
export function isSameOriginWrite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** Admin pages are not acknowledged to anyone who may not use them. */
export function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', ...NO_STORE } });
}

export function apiDenied(status: 401 | 403): Response {
  return Response.json({ error: status === 401 ? 'Sign in required' : 'Forbidden' }, { status, headers: NO_STORE });
}

/**
 * Signed-out visitors are sent through the Accounts handshake and come back
 * to the page they asked for. Styled with the theater palette.
 */
export function signInPage(request: Request): Response {
  const returnTo = new URL(request.url).href;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Sign in · Karaoke</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #131211; color: #f5f0e6;
    font: 14px 'Plus Jakarta Sans', system-ui, sans-serif; }
  main { width: min(340px, calc(100vw - 32px)); padding: 28px 24px; background: #1f1c19; border: 1px solid #2e2924; border-radius: 10px; text-align: center; }
  h1 { margin: 0 0 6px; font-size: 17px; }
  p { margin: 0 0 20px; color: #9a9183; line-height: 1.5; }
  a { display: inline-block; padding: 9px 18px; border-radius: 6px; background: #deb668; color: #131211; font-weight: 700; text-decoration: none; }
  a:hover { background: #edd18e; }
</style></head>
<body><main><h1>Sign in required</h1><p>The karaoke studio is restricted to Nixlabs administrators.</p>
<a id="sign-in" href="${ACCOUNTS_ORIGIN}/login">Sign in with Nixlabs</a></main>
<script>
  (async () => {
    try {
      const res = await fetch('${ACCOUNTS_ORIGIN}/api/handshake', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo: ${JSON.stringify(returnTo)} }) });
      if (res.ok) {
        const { url } = await res.json();
        if (typeof url === 'string' && url.startsWith('${ACCOUNTS_ORIGIN}/')) document.getElementById('sign-in').href = url;
      }
    } catch (_) { /* the plain sign-in link above still works */ }
  })();
</script></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
}
