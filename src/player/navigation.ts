import type { SongCatalogItem } from '../types/karaoke';

/** Builds the URL path + query string when a song is selected, keeping unrelated params. */
export function buildSongHistoryUrl(
  currentSearch: string,
  pathname: string,
  song: Pick<SongCatalogItem, 'id' | 'shareCode'>
): string {
  const params = new URLSearchParams(currentSearch);
  params.set('song', song.shareCode || song.id);
  params.delete('t');
  params.delete('time');
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Picks the next or previous song in the visible list, wrapping around at the ends. */
export function adjacentSong(
  songs: readonly SongCatalogItem[],
  activeId: string | null,
  step: -1 | 1
): SongCatalogItem | null {
  if (songs.length === 0) return null;
  const currentIndex = activeId ? songs.findIndex(song => song.id === activeId) : -1;
  if (currentIndex === -1) return songs[0] ?? null;
  const nextIndex = (currentIndex + step + songs.length) % songs.length;
  return songs[nextIndex] ?? null;
}

/** Seeks the video once metadata is available so browsers do not reset early seeks to 0. */
export function seekWhenReady(video: HTMLVideoElement, seconds: number, signal?: AbortSignal): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const apply = () => {
    if (signal?.aborted) return;
    const max = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seconds;
    video.currentTime = Math.min(seconds, max);
  };
  if (video.readyState >= 1) {
    apply();
    return;
  }
  video.addEventListener('loadedmetadata', apply, { once: true, signal });
}
