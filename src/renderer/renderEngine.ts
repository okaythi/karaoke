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

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);

/**
 * Lyrics may arrive from the live R2 overlay, so they are escaped before they
 * reach innerHTML. Bare emphasis tags are the only markup lyric files use.
 */
const lyricHtml = (text: string): string =>
  escapeHtml(text).replace(/&lt;(\/?)(i|b|em|strong)&gt;/gi, '<$1$2>');

/** Wipe percentage of one word at `time` on an active line. */
const wordProgress = (start: number, end: number, time: number): number => {
  const wEnd = (end && end > start) ? end : (start + 1.2);
  if (time < start) return 0;
  if (time >= wEnd) return 100;
  if (time > start) return Math.min(100, Math.max(0, ((time - start) / (wEnd - start)) * 100));
  return 0;
};

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

  let lyricsData: Verse[] = (options.lyricsData || []).filter(v => v && Array.isArray(v.words) && v.words.length > 0);
  let globalOffset: number = options.globalOffset || 0;

  let currentTopVerseIndex = -2;
  let currentBottomVerseIndex = -2;
  let cachedTopWords: HTMLElement[] = [];
  let cachedBottomWords: HTMLElement[] = [];
  // Last wipe written per word; unchanged words are not touched again.
  let topProgress: number[] = [];
  let bottomProgress: number[] = [];
  let lastFrameTime = NaN;
  let animationFrameId: number | null = null;
  let isDestroyed = false;

  const updateWipes = (verse: Verse, words: HTMLElement[], written: number[], time: number, isActive: boolean, isRecent: boolean) => {
    for (let j = 0; j < verse.words.length; j++) {
      const el = words[j];
      if (!el) continue;
      const w = verse.words[j];
      const progress = isRecent ? 100 : isActive ? wordProgress(w.start, w.end, time) : 0;
      if (written[j] === progress) continue;
      written[j] = progress;
      el.style.setProperty('--wipe-progress', `${progress}%`);
    }
  };

  const getVerseCharCount = (verse: Verse): number => {
    if (!verse) return 0;
    return verse.words.reduce((sum, w) => sum + w.word.length, 0);
  };

  const renderVerseWordsHTML = (verse: Verse, lineKey: string): string => {
    if (!verse) return '';
    const wordsHTML = verse.words.map((w, wIdx) => {
      const isJp = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(w.word);
      const margin = isJp ? '0' : '0 3px';
      const hasBreak = /\r?\n/.test(w.word);
      const cleanWord = w.word.replace(/\r?\n/g, '');

      const display = w.furigana
        ? `<span class="yomitan-ruby" data-furi="${escapeHtml(w.furigana)}"><span class="ruby-base">${lyricHtml(cleanWord)}</span></span>`
        : lyricHtml(cleanWord);

      const wordSpan = `<span class="word-wrapper${w.furigana ? ' word-has-ruby' : ''}" id="w-${lineKey}-${wIdx}" style="margin: ${margin};">
        <span class="word-base">${display}</span>
        <span class="word-highlight" aria-hidden="true">${display}</span>
      </span>`;

      return hasBreak ? `${wordSpan}<span class="k-verse-break" aria-hidden="true"></span>` : wordSpan;
    }).join('');

    const translationHTML = verse.translation
      ? `<span class="k-line-translation">${lyricHtml(verse.translation)}</span>`
      : '';

    return wordsHTML + translationHTML;
  };

  const updateFrame = () => {
    if (isDestroyed) return;

    const time = videoElement.currentTime - globalOffset;
    // While paused nothing can change until the clock, lyrics or offset do.
    if (time === lastFrameTime) {
      animationFrameId = requestAnimationFrame(updateFrame);
      return;
    }
    lastFrameTime = time;

    let activeV = -1;
    let recentV = -1;
    let upcomingV = -1;

    if (lyricsData.length > 0) {
      for (let i = 0; i < lyricsData.length; i++) {
        const v = lyricsData[i];
        if (time >= v.verseStart && time < v.verseEnd) {
          // Verses can overlap: the newly started line takes focus immediately.
          activeV = i;
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
        topProgress = [];
        topLineElement.classList.toggle('k-line-dense', getVerseCharCount(lyricsData[targetTop]) > 28);
        topLineElement.classList.toggle('k-line-has-ruby', lyricsData[targetTop].words.some(w => !!w.furigana));
        topLineElement.dataset.speaker = lyricsData[targetTop].speaker?.replace(/<[^>]*>/g, '').replace(/:$/, '').trim().toLowerCase() || '';
        topLineElement.style.display = 'flex';
        topLineElement.style.visibility = 'visible';
      } else if (focusV === -1) {
        // In instrumental gap, container opacity is 0; keep elements intact for smooth fade-out
      } else {
        topLineElement.innerHTML = '';
        cachedTopWords = [];
        topLineElement.classList.remove('k-line-has-ruby');
        topLineElement.style.visibility = 'hidden';
      }
    }

    // Mount or update Bottom line DOM only when verse changes
    if (targetBottom !== currentBottomVerseIndex) {
      currentBottomVerseIndex = targetBottom;
      if (targetBottom !== -1 && lyricsData[targetBottom]) {
        bottomLineElement.innerHTML = renderVerseWordsHTML(lyricsData[targetBottom], 'bot');
        cachedBottomWords = Array.from(bottomLineElement.querySelectorAll('.word-wrapper'));
        bottomProgress = [];
        bottomLineElement.classList.toggle('k-line-dense', getVerseCharCount(lyricsData[targetBottom]) > 28);
        bottomLineElement.classList.toggle('k-line-has-ruby', lyricsData[targetBottom].words.some(w => !!w.furigana));
        bottomLineElement.dataset.speaker = lyricsData[targetBottom].speaker?.replace(/<[^>]*>/g, '').replace(/:$/, '').trim().toLowerCase() || '';
        bottomLineElement.style.display = 'flex';
        bottomLineElement.style.visibility = 'visible';
      } else if (focusV === -1) {
        // In instrumental gap, container opacity is 0; keep elements intact for smooth fade-out
      } else {
        bottomLineElement.innerHTML = '';
        cachedBottomWords = [];
        bottomLineElement.classList.remove('k-line-has-ruby');
        bottomLineElement.style.visibility = 'hidden';
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

        updateWipes(lyricsData[targetTop], cachedTopWords, topProgress, time, isTopActive, isTopRecent);
      }

      // Bottom line state & continuous syllable wipe
      if (targetBottom !== -1 && lyricsData[targetBottom]) {
        const isBottomActive = (targetBottom === activeV);
        const isBottomRecent = (targetBottom === recentV);
        bottomLineElement.classList.toggle('k-line-active', isBottomActive || isBottomRecent);
        bottomLineElement.classList.toggle('k-line-idle', !isBottomActive && !isBottomRecent);

        updateWipes(lyricsData[targetBottom], cachedBottomWords, bottomProgress, time, isBottomActive, isBottomRecent);
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
      lyricsData = (newLyrics || []).filter(v => v && Array.isArray(v.words) && v.words.length > 0);
      currentTopVerseIndex = -2;
      currentBottomVerseIndex = -2;
      lastFrameTime = NaN;
    },
    setOffset: (newOffset: number) => {
      globalOffset = newOffset;
      lastFrameTime = NaN;
    }
  };
}
