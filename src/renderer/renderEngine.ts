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

const LEAD_IN_SECONDS = 4.0; // Lyrics strictly appear 4 seconds before playing
const FADE_OUT_GRACE = 0.6;  // Brief grace period after verse ends before clearing

/**
 * High-performance 60 FPS karaoke render engine.
 * Implements:
 * 1. Strict 4-second lead-in rule: lyrics are completely hidden during instrumental breaks
 *    and ONLY mount 4s before the vocal onset.
 * 2. Alternating Dual-Line Staging: Even verses on Top line (left-aligned), Odd verses on Bottom line (right-aligned).
 * 3. GPU-accelerated continuous syllable wipe via CSS clip-path: inset().
 * 4. Simultaneous Yomitan Ruby (furigana) wiping.
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

    // Determine currently active singing verse
    let activeV = -1;
    for (let i = 0; i < lyricsData.length; i++) {
      const v = lyricsData[i];
      if (time >= v.verseStart && time <= v.verseEnd) {
        activeV = i;
        break;
      }
    }

    // Determine visibility for Top line (Even verses) and Bottom line (Odd verses)
    // A verse is strictly visible ONLY within [verseStart - 4.0s, verseEnd + 0.6s]
    let targetTop = -1;
    let targetBottom = -1;

    if (lyricsData.length > 0) {
      for (let i = 0; i < lyricsData.length; i++) {
        const v = lyricsData[i];
        const isEligible = time >= (v.verseStart - LEAD_IN_SECONDS) && time <= (v.verseEnd + FADE_OUT_GRACE);

        if (isEligible) {
          if (i % 2 === 0) {
            targetTop = i;
          } else {
            targetBottom = i;
          }
        }
      }
    }

    // Mount or update Top line DOM only when verse changes
    if (targetTop !== currentTopVerseIndex) {
      currentTopVerseIndex = targetTop;
      if (targetTop !== -1 && lyricsData[targetTop]) {
        topLineElement.innerHTML = renderVerseWordsHTML(lyricsData[targetTop], 'top');
        cachedTopWords = Array.from(topLineElement.querySelectorAll('.word-wrapper'));
        topLineElement.style.display = 'flex';
      } else {
        topLineElement.innerHTML = '';
        cachedTopWords = [];
        topLineElement.style.display = 'none';
      }
    }

    // Mount or update Bottom line DOM only when verse changes
    if (targetBottom !== currentBottomVerseIndex) {
      currentBottomVerseIndex = targetBottom;
      if (targetBottom !== -1 && lyricsData[targetBottom]) {
        bottomLineElement.innerHTML = renderVerseWordsHTML(lyricsData[targetBottom], 'bot');
        cachedBottomWords = Array.from(bottomLineElement.querySelectorAll('.word-wrapper'));
        bottomLineElement.style.display = 'flex';
      } else {
        bottomLineElement.innerHTML = '';
        cachedBottomWords = [];
        bottomLineElement.style.display = 'none';
      }
    }

    // Container visibility: strictly visible if either line is currently in its 4s lead-in/active window
    if (targetTop !== -1 || targetBottom !== -1) {
      containerElement.style.opacity = '1';

      // Top line state & wipe progress
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

      // Bottom line state & wipe progress
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
      // Instrumental break or intro: completely fade out lyrics
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
