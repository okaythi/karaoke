import { PLAYBACK_ACTION } from '../security/protectedSong.js';
import type { Env } from './http';

export { PLAYBACK_ACTION };

export async function verifyTurnstile(request: Request, env: Env, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048 || !env.TURNSTILE_SECRET_KEY) return false;
  const hostname = new URL(request.url).hostname;
  const allowed = (env.PLAYBACK_HOSTNAMES || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!allowed.includes(hostname)) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get('cf-connecting-ip') || undefined }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    return result.success === true && result.hostname === hostname && result.action === PLAYBACK_ACTION;
  } catch {
    return false;
  }
}
