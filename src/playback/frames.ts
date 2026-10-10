/**
 * Calls `draw` once per animation frame while the media plays, and once for
 * each seek, pause or source change while it does not, so a paused stage
 * costs nothing. The next frame is requested before drawing, so a failed draw
 * cannot stop the view following playback.
 */
export interface PlaybackFrames {
  /** Draws now, for state changes that are not the media clock's. */
  draw(): void;
  stop(): void;
}

const STILL_EVENTS = ['pause', 'seeking', 'seeked', 'timeupdate', 'loadeddata', 'emptied', 'ended'] as const;

export function followPlayback(media: HTMLMediaElement, draw: () => void): PlaybackFrames {
  let request = 0;
  let stopped = false;

  const frame = () => {
    request = media.paused || media.ended || stopped ? 0 : requestAnimationFrame(frame);
    draw();
  };
  const start = () => {
    if (!request && !stopped) request = requestAnimationFrame(frame);
  };
  // While the media plays the frame loop draws; otherwise each of these events is a change to show.
  const drawStill = () => {
    if (!media.paused && !media.ended) return;
    cancelAnimationFrame(request);
    request = 0;
    draw();
  };

  media.addEventListener('play', start);
  // Resuming after a stall or a seek from the end fires only `playing`.
  media.addEventListener('playing', start);
  for (const type of STILL_EVENTS) media.addEventListener(type, drawStill);
  if (!media.paused) start();

  return {
    draw,
    stop() {
      stopped = true;
      cancelAnimationFrame(request);
      request = 0;
      media.removeEventListener('play', start);
      media.removeEventListener('playing', start);
      for (const type of STILL_EVENTS) media.removeEventListener(type, drawStill);
    }
  };
}
