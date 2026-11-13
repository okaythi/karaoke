import type { SongCatalogItem } from '../types/karaoke';
import { byId } from './dom';

const COPIED_LABEL_MS = 1300;
const DEFAULT_SHARE_ORIGIN = 'https://karaoke.nixlabs.tech';
const MUSIC_SHARE_ORIGIN = 'https://music.sudothy.me';

export interface ShareOriginContext {
  origin?: string;
  hostname?: string;
  musicVisitor?: boolean;
}

/** Builds a clickable share URL for the listener's active domain. */
export function shareUrl(
  song: Pick<SongCatalogItem, 'id' | 'shareCode'>,
  context?: ShareOriginContext
): string {
  const hostname = context?.hostname ?? (typeof location !== 'undefined' ? location.hostname : '');
  const musicVisitor = context?.musicVisitor
    ?? (typeof document !== 'undefined' && document.documentElement.classList.contains('music-visitor'));
  const origin = context?.origin ?? (typeof location !== 'undefined' ? location.origin : '');
  const base = musicVisitor || hostname === 'music.sudothy.me'
    ? MUSIC_SHARE_ORIGIN
    : /^https?:\/\//i.test(origin)
      ? origin
      : DEFAULT_SHARE_ORIGIN;
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(song.shareCode || song.id)}`;
}

/**
 * The share button copies the playing song's short link. It is also the only
 * way anything is copied from the page: every other copy is cancelled.
 */
export function initShareButton(playingSong: () => SongCatalogItem | null): void {
  const button = byId<HTMLButtonElement>('track-share-btn');
  let copying = false;
  let labelTimer: ReturnType<typeof setTimeout> | undefined;

  document.addEventListener('copy', event => {
    if (copying) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Browsers without the Clipboard API copy from a selection instead.
  const copyFromSelection = (text: string) => {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  };

  const copy = async (text: string) => {
    copying = true;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else copyFromSelection(text);
    } catch (error) {
      console.warn('The share link could not be copied:', error);
    } finally {
      copying = false;
    }
  };

  button.addEventListener('click', async event => {
    event.stopPropagation();
    const song = playingSong();
    if (!song) return;
    await copy(shareUrl(song));

    button.classList.add('copied');
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => button.classList.remove('copied'), COPIED_LABEL_MS);
  });
}
