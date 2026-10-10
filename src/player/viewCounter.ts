import { reportView } from './api';
import type { Identity } from './identity';

/** A song counts as viewed once it has actually played for this long; paused time does not count. */
const VIEW_THRESHOLD_MS = 5470;

export interface ViewCounter {
  /** Starts counting afresh for a newly selected song. */
  watch(videoKey: string): void;
}

/** Reports one view per selection of a song, after the listener has genuinely played it. */
export function createViewCounter(video: HTMLVideoElement, identity: Identity): ViewCounter {
  let videoKey: string | null = null;
  let counted = false;
  let playedMs = 0;
  let playingSince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopClock = () => {
    clearTimeout(timer);
    timer = undefined;
    playingSince = null;
  };

  const onPlay = () => {
    if (counted || !videoKey) return;
    const key = videoKey;
    clearTimeout(timer);
    playingSince = performance.now();
    timer = setTimeout(async () => {
      if (counted || videoKey !== key) return;
      counted = true;
      await reportView(key, await identity.now());
    }, VIEW_THRESHOLD_MS - playedMs);
  };

  const onStop = () => {
    if (counted) return;
    // Keep what has been played so far, so resuming does not restart the clock.
    if (playingSince !== null) playedMs += performance.now() - playingSince;
    stopClock();
  };

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onStop);
  video.addEventListener('error', onStop);

  return {
    watch(key) {
      stopClock();
      videoKey = key;
      counted = false;
      playedMs = 0;
    }
  };
}
