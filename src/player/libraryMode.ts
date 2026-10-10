import type { SongCatalogItem } from '../types/karaoke';

/** Score tracks belong to Piano; the remaining sung tracks belong to Lyrics. */
export type LibraryMode = 'lyrics' | 'piano';

export const LIBRARY_MODES: readonly LibraryMode[] = ['lyrics', 'piano'];

export type SongsByMode = Record<LibraryMode, SongCatalogItem[]>;

const STORAGE_KEY = 'karaoke.libraryMode';

const isLibraryMode = (value: unknown): value is LibraryMode =>
  LIBRARY_MODES.includes(value as LibraryMode);

export const otherMode = (mode: LibraryMode): LibraryMode => (mode === 'lyrics' ? 'piano' : 'lyrics');

/** Splits the catalog into one list per mode, keeping the catalog's order. */
export function groupSongsByMode(songs: SongCatalogItem[], hasScore: (song: SongCatalogItem) => boolean): SongsByMode {
  return {
    lyrics: songs.filter(song => song.hasLyrics && !song.scoreOnly && !hasScore(song)),
    piano: songs.filter(hasScore)
  };
}

/**
 * The mode to open in. A shared link wins, so the linked song is in the list
 * it opens on; then the listener's last choice; never a mode with nothing in
 * it while the other has songs.
 */
export function resolveInitialMode(songs: SongsByMode, stored: LibraryMode | null, linked?: SongCatalogItem): LibraryMode {
  const preferred = stored ?? 'lyrics';
  if (linked) {
    if (songs[preferred].includes(linked)) return preferred;
    if (songs[otherMode(preferred)].includes(linked)) return otherMode(preferred);
  }
  return songs[preferred].length === 0 && songs[otherMode(preferred)].length > 0 ? otherMode(preferred) : preferred;
}

// Storage throws in private windows and when site data is blocked; the choice is a convenience, never required.
export function readStoredMode(): LibraryMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLibraryMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeMode(mode: LibraryMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not remembered; the next visit opens in the default mode.
  }
}
