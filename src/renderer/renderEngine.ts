import type { Verse } from '../types/karaoke';

export interface RenderEngineOptions {
  videoElement: HTMLVideoElement;
  containerElement: HTMLElement;
  topLineElement: HTMLElement;
  bottomLineElement: HTMLElement;
  lyricsData?: Verse[];
  globalOffset?: number;
}

export interface RenderEngineController {
  destroy: () => void;
  setLyrics: (lyrics: Verse[]) => void;
  setOffset: (offset: number) => void;
}

/**
 * Creates the high-performance 60 FPS karaoke render engine.
 */
export function createRenderEngine(options: RenderEngineOptions): RenderEngineController {
  const {
    videoElement,
    containerElement,
    topLineElement,
    bottomLineElement
  } = options;

  let lyricsData: Verse[] = options.lyricsData || [];
  let globalOffset: number = options.globalOffset || 0;

  let currentTopVerseIndex = -2;
  let currentBottomVerseIndex = -2;
  let cachedTopWords: HTMLElement[] = [];
  let cachedBottomWords: HTMLElement[] = [];
  let animationFrameId: number | null = null;
  let isDestroyed = false;

  const renderVerseWordsHTML = (verse: Verse, lineKey: string): string => {
    if (!verse) return '';
    const wordsHTML = verse.words.map((w, wIdx) => {
      const isJp = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(w.word);
      const margin = isJp ? '0' : '0 3px';
      const display = w.furigana
        ? `<span class="yomitan-ruby" data-furi="${w.furigana}">${w.word}</span>`
        : w.word;

      return `<span class="word-wrapper" id="w-${lineKey}-${wIdx}" style="margin: ${margin};">
        <span class="word-base">${display}</span>
        <span class="word-highlight" aria-hidden="true">${display}</span>
      </span>`;
    }).join('');

    const translationHTML = verse.translation
      ? `<span class="k-line-translation">${verse.translation}</span>`
      : '';

    return wordsHTML + translationHTML;
  };

  const updateFrame = () => {
    if (isDestroyed) return;

    const time = videoElement.currentTime - globalOffset;
    let activeV = -1;
    let upcomingV = -1;

    if (lyricsData.length > 0) {
      for (let i = 0; i < lyricsData.length; i++) {
        const v = lyricsData[i];
        if (time >= v.verseStart && time <= v.verseEnd) {
          activeV = i;
          break;
        }
        if (time < v.verseStart) {
          upcomingV = i;
          break;
        }
      }
    }

    // Alternating Dual-Line Target Resolution
    const focusV = activeV !== -1 ? activeV : upcomingV;
    let targetTop = -1;
    let targetBottom = -1;

    if (focusV !== -1 && lyricsData.length > 0) {
      if (focusV % 2 === 0) {
        // Even verse on Top line; Odd verse pre-buffered on Bottom line
        targetTop = focusV;
        targetBottom = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
      } else {
        // Odd verse on Bottom line; Top line immediately mounts next Even verse
        targetBottom = focusV;
        targetTop = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
      }
    }

    // Mount or update Top line DOM only when verse identity changes
    if (targetTop !== currentTopVerseIndex) {
      currentTopVerseIndex = targetTop;
      if (targetTop !== -1 && lyricsData[targetTop]) {
        topLineElement.innerHTML = renderVerseWordsHTML(lyricsData[targetTop], 'top');
        cachedTopWords = Array.from(topLineElement.querySelectorAll('.word-wrapper'));
      } else {
        topLineElement.innerHTML = '';
        cachedTopWords = [];
      }
    }

    // Mount or update Bottom line DOM only when verse identity changes
    if (targetBottom !== currentBottomVerseIndex) {
      currentBottomVerseIndex = targetBottom;
      if (targetBottom !== -1 && lyricsData[targetBottom]) {
        bottomLineElement.innerHTML = renderVerseWordsHTML(lyricsData[targetBottom], 'bot');
        cachedBottomWords = Array.from(bottomLineElement.querySelectorAll('.word-wrapper'));
      } else {
        bottomLineElement.innerHTML = '';
        cachedBottomWords = [];
      }
    }

    // Update Syllable Wipe & Opacity States
    if (targetTop !== -1 || targetBottom !== -1) {
      containerElement.style.opacity = '1';

      // Top line wipe update
      if (targetTop !== -1 && lyricsData[targetTop]) {
        const isTopActive = targetTop === activeV;
        topLineElement.classList.toggle('k-line-active', isTopActive);
        topLineElement.classList.toggle('k-line-idle', !isTopActive);

        const vTop = lyricsData[targetTop];
        for (let j = 0; j < vTop.words.length; j++) {
          const w = vTop.words[j];
          const el = cachedTopWords[j];
          if (!el) continue;

          let progress = 0;
          if (isTopActive) {
            if (time >= w.end) {
              progress = 100;
            } else if (time > w.start && w.end > w.start) {
              progress = Math.min(100, Math.max(0, ((time - w.start) / (w.end - w.start)) * 100));
            }
          }
          el.style.setProperty('--wipe-progress', `${progress}%`);
        }
      }

      // Bottom line wipe update
      if (targetBottom !== -1 && lyricsData[targetBottom]) {
        const isBottomActive = targetBottom === activeV;
        bottomLineElement.classList.toggle('k-line-active', isBottomActive);
        bottomLineElement.classList.toggle('k-line-idle', !isBottomActive);

        const vBot = lyricsData[targetBottom];
        for (let j = 0; j < vBot.words.length; j++) {
          const w = vBot.words[j];
          const el = cachedBottomWords[j];
          if (!el) continue;

          let progress = 0;
          if (isBottomActive) {
            if (time >= w.end) {
              progress = 100;
            } else if (time > w.start && w.end > w.start) {
              progress = Math.min(100, Math.max(0, ((time - w.start) / (w.end - w.start)) * 100));
            }
          }
          el.style.setProperty('--wipe-progress', `${progress}%`);
        }
      }
    } else {
      containerElement.style.opacity = '0';
    }

    animationFrameId = requestAnimationFrame(updateFrame);
  };

  animationFrameId = requestAnimationFrame(updateFrame);

  return {
    destroy: () => {
      isDestroyed = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    },
    setLyrics: (newLyrics: Verse[]) => {
      lyricsData = newLyrics;
      currentTopVerseIndex = -2;
      currentBottomVerseIndex = -2;
    },
    setOffset: (newOffset: number) => {
      globalOffset = newOffset;
    }
  };
}
