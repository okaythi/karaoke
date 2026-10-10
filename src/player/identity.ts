import { isValidKrId } from '../fingerprint/kr-id';
import { requestKrId } from './api';

/** The anonymous listener ID that votes and views are counted under. */
export interface Identity {
  /** The ID if this tab already has it. */
  known(): string | null;
  /** The ID once it has been worked out in the background. */
  eventually(): Promise<string | null>;
  /** The ID as soon as possible, for an action that needs it. */
  now(): Promise<string | null>;
}

const STORAGE_KEY = '_kr_id';

function readStored(): string | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return isValidKrId(stored) ? stored : null;
  } catch {
    // Storage is blocked; the ID is worked out again each visit.
    return null;
  }
}

function whenIdle(run: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

/**
 * Working out the ID means fingerprinting the browser, which is slow enough
 * to stutter a song that is just starting. It waits for an idle moment unless
 * something asks for the ID sooner.
 */
export function createIdentity(): Identity {
  let krId = readStored();
  let begin!: () => void;
  const begun = new Promise<void>(resolve => { begin = resolve; });

  const resolved = begun.then(async () => {
    if (krId) return krId;
    const { collectFingerprint } = await import('../fingerprint/fingerprint');
    krId = await requestKrId(await collectFingerprint());
    try {
      if (krId) sessionStorage.setItem(STORAGE_KEY, krId);
    } catch {
      // Storage is blocked; the ID still serves this page.
    }
    return krId;
  }).catch(() => null);

  whenIdle(begin);

  return {
    known: () => krId,
    eventually: () => resolved,
    now: () => {
      begin();
      return resolved;
    }
  };
}
