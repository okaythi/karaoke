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

  const getVerseCharCount = (verse: Verse): number => {
    if (!verse) return 0;
    return verse.words.reduce((sum, w) => sum + w.word.length, 0);
  };

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
    let recentV = -1;
    let upcomingV = -1;

    if (lyricsData.length > 0) {
      for (let i = 0; i < lyricsData.length; i++) {
        const v = lyricsData[i];
        if (time >= v.verseStart && time <= v.verseEnd) {
          activeV = i;
          break;
        }
        if (time > v.verseEnd && time <= v.verseEnd + FADE_OUT_GRACE) {
          recentV = i;
        }
        if (time < v.verseStart) {
          if (upcomingV === -1) {
            upcomingV = i;
          }
        }
      }
    }

    // Determine the focus verse:
    // 1. Actively singing verse
    // 2. Verse that just ended within grace period (0.6s)
    // 3. Upcoming verse strictly within 4.0s lead-in window
    // 4. Otherwise -1 (instrumental break / intro)
    let focusV = -1;
    if (activeV !== -1) {
      focusV = activeV;
    } else if (recentV !== -1) {
      focusV = recentV;
    } else if (upcomingV !== -1 && time >= (lyricsData[upcomingV].verseStart - LEAD_IN_SECONDS)) {
      focusV = upcomingV;
    }

    // Topological Alternating Dual-Line Target Resolution:
    // Even verses on Top line, Odd verses on Bottom line
    let targetTop = -1;
    let targetBottom = -1;

    if (focusV !== -1 && lyricsData.length > 0) {
      if (focusV % 2 === 0) {
        // Even verse is Active/Upcoming on Top line
        targetTop = focusV;
        // Pre-buffer next Odd verse on Bottom line
        targetBottom = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
      } else {
        // Odd verse is Active/Upcoming on Bottom line
        targetBottom = focusV;
        // Pre-buffer next Even verse on Top line
        targetTop = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
      }
    }

    // Mount or update Top line DOM only when verse changes
    if (targetTop !== currentTopVerseIndex) {
      currentTopVerseIndex = targetTop;
      if (targetTop !== -1 && lyricsData[targetTop]) {
        topLineElement.innerHTML = renderVerseWordsHTML(lyricsData[targetTop], 'top');
        cachedTopWords = Array.from(topLineElement.querySelectorAll('.word-wrapper'));
        topLineElement.classList.toggle('k-line-dense', getVerseCharCount(lyricsData[targetTop]) > 28);
        topLineElement.classList.toggle('k-line-has-ruby', lyricsData[targetTop].words.some(w => !!w.furigana));
        topLineElement.style.display = 'flex';
      } else if (focusV === -1) {
        // In instrumental gap, container opacity is 0; keep elements intact for smooth fade-out
      } else {
        topLineElement.innerHTML = '';
        cachedTopWords = [];
        topLineElement.classList.remove('k-line-has-ruby');
        topLineElement.style.display = 'none';
      }
    }

    // Mount or update Bottom line DOM only when verse changes
    if (targetBottom !== currentBottomVerseIndex) {
      currentBottomVerseIndex = targetBottom;
      if (targetBottom !== -1 && lyricsData[targetBottom]) {
        bottomLineElement.innerHTML = renderVerseWordsHTML(lyricsData[targetBottom], 'bot');
        cachedBottomWords = Array.from(bottomLineElement.querySelectorAll('.word-wrapper'));
        bottomLineElement.classList.toggle('k-line-dense', getVerseCharCount(lyricsData[targetBottom]) > 28);
        bottomLineElement.classList.toggle('k-line-has-ruby', lyricsData[targetBottom].words.some(w => !!w.furigana));
        bottomLineElement.style.display = 'flex';
      } else if (focusV === -1) {
        // In instrumental gap, container opacity is 0; keep elements intact for smooth fade-out
      } else {
        bottomLineElement.innerHTML = '';
        cachedBottomWords = [];
        bottomLineElement.classList.remove('k-line-has-ruby');
        bottomLineElement.style.display = 'none';
      }
    }

    // Container visibility: show only when lyrics are active or in 4s lead-in
    if (targetTop !== -1 || targetBottom !== -1) {
      containerElement.style.opacity = '1';

      // Top line state & continuous syllable wipe
      if (targetTop !== -1 && lyricsData[targetTop]) {
        const isTopActive = (targetTop === activeV);
        const isTopRecent = (targetTop === recentV);
        topLineElement.classList.toggle('k-line-active', isTopActive || isTopRecent);
        topLineElement.classList.toggle('k-line-idle', !isTopActive && !isTopRecent);

        const vTop = lyricsData[targetTop];
        for (let j = 0; j < vTop.words.length; j++) {
          const w = vTop.words[j];
          const el = cachedTopWords[j];
          if (!el) continue;

          let progress = 0;
          if (isTopRecent) {
            progress = 100;
          } else if (isTopActive) {
            const wEnd = (w.end && w.end > w.start) ? w.end : (w.start + 1.2);
            if (time < w.start) {
              progress = 0;
            } else if (time >= wEnd) {
              progress = 100;
            } else if (time > w.start && wEnd > w.start) {
              progress = Math.min(100, Math.max(0, ((time - w.start) / (wEnd - w.start)) * 100));
            }
          }
          el.style.setProperty('--wipe-progress', `${progress}%`);
        }
      }

      // Bottom line state & continuous syllable wipe
      if (targetBottom !== -1 && lyricsData[targetBottom]) {
        const isBottomActive = (targetBottom === activeV);
        const isBottomRecent = (targetBottom === recentV);
        bottomLineElement.classList.toggle('k-line-active', isBottomActive || isBottomRecent);
        bottomLineElement.classList.toggle('k-line-idle', !isBottomActive && !isBottomRecent);

        const vBot = lyricsData[targetBottom];
        for (let j = 0; j < vBot.words.length; j++) {
          const w = vBot.words[j];
          const el = cachedBottomWords[j];
          if (!el) continue;

          let progress = 0;
          if (isBottomRecent) {
            progress = 100;
          } else if (isBottomActive) {
            const wEnd = (w.end && w.end > w.start) ? w.end : (w.start + 1.2);
            if (time < w.start) {
              progress = 0;
            } else if (time >= wEnd) {
              progress = 100;
            } else if (time > w.start && wEnd > w.start) {
              progress = Math.min(100, Math.max(0, ((time - w.start) / (wEnd - w.start)) * 100));
            }
          }
          el.style.setProperty('--wipe-progress', `${progress}%`);
        }
      }
    } else {
      // Instrumental break, guitar solo, or intro > 4s: completely hide lyrics
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
