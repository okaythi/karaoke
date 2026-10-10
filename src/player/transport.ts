import { byId } from './dom';

export interface Transport {
  showPlaying(playing: boolean): void;
  /** Hides the large play button while something else occupies the frame. */
  hideCenterPlay(): void;
  /** Back to 0:00 for a newly loaded song. */
  reset(): void;
}

const formatClock = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

/** Play button, clock and scrubber. Deciding what a press of play does is the caller's. */
export function createTransport(video: HTMLVideoElement, onToggle: () => void): Transport {
  const playButton = byId<HTMLButtonElement>('deck-play-btn');
  const centerPlay = byId<HTMLButtonElement>('center-play-btn');
  const current = byId('deck-time-current');
  const duration = byId('deck-time-duration');
  const scrubber = byId<HTMLInputElement>('deck-progress-scrubber');
  let scrubbing = false;

  const showPlaying = (playing: boolean) => {
    playButton.dataset.state = playing ? 'playing' : 'paused';
    centerPlay.classList.toggle('hidden', playing);
  };

  const showProgress = (percent: number) => scrubber.style.setProperty('--progress', `${percent}%`);

  const showTime = () => {
    if (!video.duration) return;
    current.textContent = formatClock(video.currentTime);
    duration.textContent = formatClock(video.duration);
  };

  playButton.addEventListener('click', onToggle);
  video.addEventListener('click', onToggle);
  centerPlay.addEventListener('click', event => {
    event.stopPropagation();
    onToggle();
  });

  video.addEventListener('play', () => showPlaying(true));
  video.addEventListener('pause', () => showPlaying(false));
  video.addEventListener('error', () => {
    console.error('Video playback error:', video.error);
    showPlaying(false);
  });
  video.addEventListener('loadedmetadata', showTime);
  video.addEventListener('durationchange', showTime);
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    showTime();
    const percent = (video.currentTime / video.duration) * 100;
    showProgress(percent);
    // The thumb stays under the finger while it is being dragged.
    if (!scrubbing) scrubber.value = String(percent);
  });

  scrubber.addEventListener('input', () => {
    scrubbing = true;
    const percent = parseFloat(scrubber.value);
    showProgress(percent);
    if (!video.duration) return;
    video.currentTime = (percent / 100) * video.duration;
    current.textContent = formatClock(video.currentTime);
  });
  scrubber.addEventListener('change', () => { scrubbing = false; });

  return {
    showPlaying,
    hideCenterPlay: () => centerPlay.classList.add('hidden'),
    reset() {
      scrubber.value = '0';
      showProgress(0);
      current.textContent = '0:00';
      duration.textContent = '0:00';
    }
  };
}
