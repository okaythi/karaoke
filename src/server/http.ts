/** Bindings and variables from wrangler.toml and the Pages dashboard. Any may be absent in a preview. */
export interface Env {
  DB?: D1Database;
  MEDIA_BUCKET?: R2Bucket;
  PROTECTED_MEDIA_BUCKET?: R2Bucket;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  PLAYBACK_SIGNING_SECRET?: string;
  PLAYBACK_HOSTNAMES?: string;
}

export interface Context {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  next(): Promise<Response>;
  waitUntil(promise: Promise<unknown>): void;
}

/** Responses here are per listener or change on save, so they are not cached unless a caller says otherwise. */
export function json(data: unknown, status = 200, headers: Record<string, string> = { 'Cache-Control': 'no-store' }): Response {
  return Response.json(data, { status, headers });
}

/** Every value sent for a cookie name; a browser sends one, a forged header may send several. */
export function cookieValues(request: Request, name: string): string[] {
  return (request.headers.get('cookie') || '')
    .split(';')
    .map(pair => pair.trim())
    .filter(pair => pair.startsWith(`${name}=`))
    .map(pair => pair.slice(name.length + 1));
}

/** Song IDs become R2 keys and repository paths, so they must stay a single path segment. */
export function isSongId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\/\\]/.test(id) && !id.includes('..');
}
