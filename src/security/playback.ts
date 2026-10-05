import { isProtectedSong } from './protectedSong.js';
let expiresAt = 0;
let pending: Promise<void> | undefined;
export async function prepareProtectedPlayback(id: string): Promise<void> {
  if (!isProtectedSong(id) || Date.now() < expiresAt - 60_000) return;
  if (!pending) pending = (async () => {
    const config = await fetch('/api/karaoke/protected/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!config.ok) throw new Error('Protected playback is unavailable. Please try again later.');
    const { siteKey } = await config.json() as { siteKey: string };
    const { challenge } = await import('./turnstile');
    const token = await challenge(siteKey);
    const response = await fetch('/api/karaoke/protected/session', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    if (!response.ok) throw new Error('Protected playback is unavailable. Please try again later.');
    const grant = await response.json() as { expiresAt: number };
    expiresAt = grant.expiresAt;
  })().finally(() => { pending = undefined; });
  return pending;
}
