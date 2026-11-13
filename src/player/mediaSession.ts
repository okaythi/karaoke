import { albumArtQuery, lookUpAlbumArt } from '../catalog/itunes';
import type { SongCatalogItem } from '../types/karaoke';

export interface MediaSessionHandlers {
  onPlay(): void;
  onPause(): void;
  onSeekBackward(): void;
  onSeekForward(): void;
  onPreviousTrack(): void;
  onNextTrack(): void;
}

export interface MediaSessionBridge {
  show(song: SongCatalogItem): void;
}

/** Wires OS / hardware media keys and lock-screen metadata to the theater player. */
export function createMediaSession(
  video: HTMLVideoElement,
  handlers: MediaSessionHandlers
): MediaSessionBridge {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  let activeSongId: string | null = null;

  if (session) {
    const actions: ReadonlyArray< readonly [MediaSessionAction, MediaSessionActionHandler] > = [
      ['play', handlers.onPlay],
      ['pause', handlers.onPause],
      ['seekbackward', handlers.onSeekBackward],
      ['seekforward', handlers.onSeekForward],
      ['previoustrack', handlers.onPreviousTrack],
      ['nexttrack', handlers.onNextTrack]
    ];
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Older browsers may not support every media session action.
      }
    }

    const syncPosition = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      try {
        session.setPositionState?.({
          duration: video.duration,
          playbackRate: video.playbackRate || 1,
          position: Math.min(video.currentTime, video.duration)
        });
      } catch {
        // Ignore transient position range errors while switching tracks.
      }
    };

    video.addEventListener('play', () => { session.playbackState = 'playing'; syncPosition(); });
    video.addEventListener('pause', () => { session.playbackState = 'paused'; syncPosition(); });
    video.addEventListener('loadedmetadata', syncPosition);
    video.addEventListener('seeked', syncPosition);
    video.addEventListener('ratechange', syncPosition);
  }

  return {
    show(song) {
      activeSongId = song.id;
      if (!session || typeof MediaMetadata === 'undefined') return;
      session.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist
      });
      void lookUpAlbumArt(albumArtQuery(song), 512).then(artUrl => {
        if (!artUrl || activeSongId !== song.id || !session.metadata) return;
        session.metadata = new MediaMetadata({
          title: song.title,
          artist: song.artist,
          artwork: [{ src: artUrl, sizes: '512x512' }]
        });
      });
    }
  };
}
