import { byId } from './dom';

export interface AudioMix {
  /** The instrumental stem for the new song, or none. Vocals come back on. */
  setStem(url: string | null): void;
  toggleMute(): void;
  toggleVocals(): void;
}

export type StemSyncAction =
  | { readonly kind: 'in-sync'; readonly rate: number }
  | { readonly kind: 'nudge'; readonly rate: number }
  | { readonly kind: 'seek'; readonly time: number; readonly rate: number };

/** Below this drift, in seconds, the stem plays at the video's exact rate. */
const SOFT_DRIFT_MIN = 0.015;
/** Above this drift, in seconds, the stem seeks directly rather than nudging rate. */
const HARD_DRIFT_MAX = 0.16;
/** Maximum proportional rate adjustment applied during a soft nudge. */
const MAX_RATE_NUDGE = 0.025;
const PILL_FADE_MS = 150;

/**
 * Pure drift resolver: small phase errors nudge playbackRate smoothly so the
 * listener hears no click; larger gaps snap currentTime directly.
 */
export function resolveStemSync(videoTime: number, stemTime: number, baseRate = 1): StemSyncAction {
  const safeRate = Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 1;
  const drift = videoTime - stemTime;
  const absDrift = Math.abs(drift);
  if (!Number.isFinite(drift) || absDrift <= SOFT_DRIFT_MIN) {
    return { kind: 'in-sync', rate: safeRate };
  }
  if (absDrift >= HARD_DRIFT_MAX) {
    return { kind: 'seek', time: Math.max(0, videoTime), rate: safeRate };
  }
  const factor = Math.max(-MAX_RATE_NUDGE, Math.min(MAX_RATE_NUDGE, drift * 0.25));
  return { kind: 'nudge', rate: Number((safeRate * (1 + factor)).toFixed(4)) };
}

/**
 * Volume, mute and the vocal toggle. With vocals removed the video is muted
 * and an instrumental stem plays in step with it; whichever of the two is
 * audible follows the volume slider and the mute button.
 */
export function createAudioMix(video: HTMLVideoElement): AudioMix {
  const slider = byId<HTMLInputElement>('deck-volume-slider');
  const muteButton = byId<HTMLButtonElement>('deck-vol-btn');
  const voiceButton = byId<HTMLButtonElement>('deck-voice-btn');
  const pill = byId('voice-pointer-pill');

  let volume = parseFloat(slider.value);
  let silent = false;
  let stem: HTMLAudioElement | null = null;
  let vocalsRemoved = false;

  const apply = () => {
    if (!silent) {
      video.volume = volume;
      if (stem) stem.volume = volume;
    }
    video.muted = vocalsRemoved || silent;
    if (stem) stem.muted = !vocalsRemoved || silent;
    slider.value = String(silent ? 0 : volume);
    muteButton.dataset.level = silent ? 'muted' : volume < 0.5 ? 'low' : 'high';
  };

  const pillText = () => (vocalsRemoved ? 'Restore Vocals' : 'Remove Vocals');

  const showVoiceButton = () => {
    voiceButton.hidden = !stem;
    voiceButton.classList.toggle('karaoke-active', vocalsRemoved);
    voiceButton.setAttribute('aria-pressed', String(vocalsRemoved));
    pill.textContent = pillText();
    if (!stem) {
      pill.classList.remove('visible');
      pill.hidden = true;
    }
  };

  const playStem = () => {
    if (!stem) return;
    if (stem.preload !== 'auto') stem.preload = 'auto';
    stem.playbackRate = video.playbackRate || 1;
    stem.currentTime = video.currentTime;
    stem.play().catch(error => console.warn('Stem playback was prevented:', error));
  };

  slider.addEventListener('input', () => {
    const level = parseFloat(slider.value);
    silent = level === 0;
    if (!silent) volume = level;
    apply();
  });

  const toggleMute = () => {
    silent = !silent;
    apply();
  };
  muteButton.addEventListener('click', toggleMute);

  const toggleVocals = () => {
    if (!stem) return;
    vocalsRemoved = !vocalsRemoved;
    apply();
    if (!vocalsRemoved) {
      stem.pause();
      stem.playbackRate = video.playbackRate || 1;
    } else if (!video.paused) {
      playStem();
    } else if (stem.preload !== 'auto') {
      stem.preload = 'auto';
    }
    showVoiceButton();
  };
  voiceButton.addEventListener('click', toggleVocals);

  // The tip follows the pointer rather than sitting on the button.
  const movePill = (event: MouseEvent) => {
    pill.style.left = `${event.clientX}px`;
    pill.style.top = `${event.clientY}px`;
  };
  voiceButton.addEventListener('mouseenter', event => {
    pill.textContent = pillText();
    pill.hidden = false;
    movePill(event);
    requestAnimationFrame(() => pill.classList.add('visible'));
  });
  voiceButton.addEventListener('mousemove', movePill);
  voiceButton.addEventListener('mouseleave', () => {
    pill.classList.remove('visible');
    setTimeout(() => {
      if (!pill.classList.contains('visible')) pill.hidden = true;
    }, PILL_FADE_MS);
  });

  video.addEventListener('play', () => {
    if (vocalsRemoved) playStem();
  });
  video.addEventListener('playing', () => {
    if (vocalsRemoved) playStem();
  });
  for (const type of ['pause', 'waiting', 'stalled', 'ended', 'error'] as const) {
    video.addEventListener(type, () => stem?.pause());
  }
  video.addEventListener('ratechange', () => {
    if (stem) stem.playbackRate = video.playbackRate || 1;
  });
  video.addEventListener('seeking', () => {
    if (vocalsRemoved && stem) {
      stem.playbackRate = video.playbackRate || 1;
      stem.currentTime = video.currentTime;
    }
  });
  video.addEventListener('timeupdate', () => {
    if (!vocalsRemoved || !stem || video.paused || !video.duration) return;
    const action = resolveStemSync(video.currentTime, stem.currentTime, video.playbackRate || 1);
    if (action.kind === 'seek') stem.currentTime = action.time;
    if (stem.playbackRate !== action.rate) stem.playbackRate = action.rate;
    if (stem.paused) stem.play().catch(console.warn);
  });

  apply();
  showVoiceButton();

  return {
    setStem(url) {
      if (stem) {
        stem.pause();
        stem.src = '';
      }
      stem = url ? new Audio(url) : null;
      // Only fetch header metadata up front; full audio buffers when vocals are toggled off.
      if (stem) stem.preload = 'metadata';
      vocalsRemoved = false;
      apply();
      showVoiceButton();
    },
    toggleMute,
    toggleVocals
  };
}
