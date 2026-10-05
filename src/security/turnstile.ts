// Lazy-loaded only for the protected song. Use an Invisible widget in Cloudflare.
interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(id: string): void;
  remove(id: string): void;
}
const api = () => (window as Window & { turnstile?: Turnstile }).turnstile;
let scriptReady: Promise<void> | undefined;
function loadScript(): Promise<void> {
  if (!scriptReady) scriptReady = new Promise<void>((resolve, reject) => {
    if (api()?.render && api()?.execute) { resolve(); return; }
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('Playback verification timed out.')); }, 15_000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => { clearTimeout(timer); if (api()?.render && api()?.execute) resolve(); else reject(new Error('Playback verification unavailable.')); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Playback verification unavailable.')); };
    document.head.appendChild(script);
  }).catch(error => { scriptReady = undefined; throw error; });
  return scriptReady;
}
export async function challenge(siteKey: string): Promise<string> {
  await loadScript();
  return new Promise((resolve, reject) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let widget: string | undefined;
    const cleanup = () => { clearTimeout(timer); if (widget !== undefined) api()?.remove(widget); container.remove(); };
    const fail = () => { cleanup(); reject(new Error('Playback verification failed. Please select the song again.')); };
    const timer = setTimeout(fail, 25_000);
    try {
      widget = api()!.render(container, {
        sitekey: siteKey, action: 'fantaisie_playback', execution: 'execute', appearance: 'interaction-only',
        retry: 'never', 'refresh-expired': 'never',
        callback: (token: string) => { cleanup(); resolve(token); },
        'error-callback': fail, 'expired-callback': fail, 'timeout-callback': fail,
      });
      api()!.execute(widget);
    } catch { fail(); }
  });
}
