import type { SongScore } from '../notation/songs';
import type { ScoreViewController, createScoreView } from '../notation/view/theater';
import { createRenderEngine, type RenderEngineController } from '../renderer/renderEngine';
import type { Verse } from '../types/karaoke';
import { byId } from './dom';

/** A loaded arrangement and the view that draws it; the view's code arrives with the first scored song. */
export interface LoadedScore {
  bundle: SongScore;
  createView: typeof createScoreView;
}

export interface Stage {
  /** Takes down the previous song's lyrics and score. */
  clear(): void;
  /** Puts a song's lyrics and score under the video. With both, the lyrics take a single line beneath the score. */
  mount(content: { verses: Verse[]; globalOffset: number; score: LoadedScore | null }): void;
  /** A message over the video, or a spinner while `loading`; an empty message removes it. */
  showStatus(message: string, loading?: boolean): void;
}

/** What is shown with the video: synchronized lyrics, an engraved score, or both. */
export function createStage(video: HTMLVideoElement): Stage {
  const middle = byId('stage-middle');
  const lyricsContainer = byId('lyrics-stage-container');
  const scoreContainer = byId('piano-score-container');
  const status = byId('playback-status');
  const frame = video.closest<HTMLElement>('.video-frame-container');
  let lyrics: RenderEngineController | null = null;
  let score: ScoreViewController | null = null;

  // The frame takes the shape of the video once its dimensions are known.
  const fitFrame = () => {
    if (!frame || !video.videoWidth || !video.videoHeight) return;
    frame.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    frame.style.setProperty('--video-ratio', String(video.videoWidth / video.videoHeight));
  };
  video.addEventListener('loadedmetadata', fitFrame);
  video.addEventListener('durationchange', fitFrame);

  const clear = () => {
    lyrics?.destroy();
    score?.destroy();
    lyrics = score = null;
    scoreContainer.hidden = true;
    scoreContainer.replaceChildren();
    lyricsContainer.hidden = true;
    middle.classList.remove('score-with-lyrics');
  };

  return {
    clear,
    mount({ verses, globalOffset, score: loaded }) {
      clear();
      const withScore = loaded !== null && verses.length > 0;
      lyricsContainer.hidden = verses.length === 0;
      middle.classList.toggle('score-with-lyrics', withScore);
      lyrics = createRenderEngine({
        videoElement: video,
        containerElement: lyricsContainer,
        topLineElement: byId('k-line-top'),
        bottomLineElement: byId('k-line-bottom'),
        lyricsData: verses,
        globalOffset,
        lineMode: withScore ? 'single' : 'dual'
      });
      if (loaded) {
        // The view measures its container, which must be laid out first.
        scoreContainer.hidden = false;
        score = loaded.createView(video, scoreContainer, loaded.bundle);
      }
    },
    showStatus(message, loading = false) {
      status.replaceChildren();
      status.classList.toggle('is-loading', loading);
      if (loading) {
        const label = document.createElement('span');
        label.className = 'visually-hidden';
        label.textContent = message;
        status.appendChild(label);
      } else {
        status.textContent = message;
      }
      status.hidden = !message;
    }
  };
}
