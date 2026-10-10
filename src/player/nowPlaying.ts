import { albumArtQuery, fetchAlbumArt } from '../catalog/itunes';
import { escapeHtml, safeHref } from '../core/html';
import { hasJapaneseLetters } from '../core/script';
import type { SongCatalogItem, SupportItem } from '../types/karaoke';
import { byId } from './dom';

export interface NowPlaying {
  show(song: SongCatalogItem): void;
}

/** The header cover is 40px wide; this covers a 3x screen. */
const HEADER_ART_SIZE = 120;
/** The Japanese logo eases in this long after a Japanese song starts. */
const JAPANESE_LOGO_DELAY_MS = 5500;

const EXTERNAL_LINK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

/** An explicit language covers romanized titles; the script covers the rest. */
const isJapanese = (song: SongCatalogItem): boolean =>
  song.language === 'ja' || song.itunesCountry?.toLowerCase() === 'jp' || hasJapaneseLetters(`${song.title} ${song.artist}`);

function supportLinks(song: SongCatalogItem): SupportItem[] {
  if (!song.support) return [];
  return song.supportItems ?? (Array.isArray(song.support) ? song.support : []);
}

/** The header's account of the playing song: cover, title, artist, badges and ways to support the artist. */
export function createNowPlaying(): NowPlaying {
  const artwork = byId<HTMLImageElement>('active-track-art');
  const title = byId('active-track-title-text');
  const artist = byId('active-track-artist');
  const translationBadge = byId('badge-translation');
  const dialectBadge = byId('badge-dialect');
  const support = byId('support-dropdown-container');
  const supportButton = byId<HTMLButtonElement>('support-artist-btn');
  const supportMenu = byId('support-menu');
  const logoFrame = byId('brand-logo-frame');
  let logoTimer: ReturnType<typeof setTimeout> | undefined;

  supportButton.addEventListener('click', event => {
    event.stopPropagation();
    supportMenu.hidden = !supportMenu.hidden;
  });
  document.addEventListener('click', event => {
    if (!support.contains(event.target as Node)) supportMenu.hidden = true;
  });

  const showLogo = (japanese: boolean) => {
    if (!japanese) {
      clearTimeout(logoTimer);
      logoTimer = undefined;
      logoFrame.classList.remove('japanese-visible');
    } else if (!logoFrame.classList.contains('japanese-visible') && !logoTimer) {
      logoTimer = setTimeout(() => {
        logoFrame.classList.add('japanese-visible');
        logoTimer = undefined;
      }, JAPANESE_LOGO_DELAY_MS);
    }
  };

  return {
    show(song) {
      title.textContent = song.title;
      artist.textContent = song.artist;
      translationBadge.hidden = !song.hasTranslation || song.isDialect;
      dialectBadge.hidden = !song.hasTranslation || !song.isDialect;
      fetchAlbumArt(albumArtQuery(song), artwork, { size: HEADER_ART_SIZE });

      const links = supportLinks(song);
      support.hidden = links.length === 0;
      supportMenu.hidden = true;
      supportMenu.innerHTML = links.map(link => `
        <a href="${safeHref(link.itemLink)}" target="_blank" rel="noopener noreferrer" class="support-menu-item">
          <span>${escapeHtml(link.itemName)}</span>
          ${EXTERNAL_LINK_ICON}
        </a>
      `).join('');

      showLogo(isJapanese(song));
    }
  };
}
