import { byId } from './dom';

export interface AudioMix {
  /** The instrumental stem for the new song, or none. Vocals come back on. */
  setStem(url: string | null): void;
  toggleMute(): void;
}

/** The stem is pulled back to the video when the two drift further apart than this, in seconds. */
const MAX_STEM_DRIFT = 0.05;
const PILL_FADE_MS = 150;

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
    pill.textContent = pillText();
    if (!stem) {
      pill.classList.remove('visible');
      pill.hidden = true;
    }
  };

  const playStem = () => {
    if (!stem) return;
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

  voiceButton.addEventListener('click', () => {
    if (!stem) return;
    vocalsRemoved = !vocalsRemoved;
    apply();
    if (!vocalsRemoved) stem.pause();
    else if (!video.paused) playStem();
    showVoiceButton();
  });

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
  for (const type of ['pause', 'ended', 'error']) video.addEventListener(type, () => stem?.pause());
  video.addEventListener('seeking', () => {
    if (vocalsRemoved && stem) stem.currentTime = video.currentTime;
  });
  video.addEventListener('timeupdate', () => {
    if (!vocalsRemoved || !stem || video.paused || !video.duration) return;
    if (Math.abs(stem.currentTime - video.currentTime) > MAX_STEM_DRIFT) stem.currentTime = video.currentTime;
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
      if (stem) stem.preload = 'auto';
      vocalsRemoved = false;
      apply();
      showVoiceButton();
    },
    toggleMute
  };
}
