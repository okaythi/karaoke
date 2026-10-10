import { escapeHtml, lyricHtml } from '../core/html';
import { hasCjk } from '../core/script';
import { followPlayback } from '../playback/frames';
import type { Verse } from '../types/karaoke';

export type LineMode = 'dual' | 'single';

export interface RenderEngineOptions {
  videoElement: HTMLVideoElement;
  containerElement: HTMLElement;
  topLineElement: HTMLElement;
  bottomLineElement: HTMLElement;
  lyricsData?: Verse[];
  globalOffset?: number;
  /** A compact lyric lane alongside an instrumental score. */
  lineMode?: LineMode;
}

export interface RenderEngineController {
  destroy: () => void;
  setLineMode: (mode: LineMode) => void;
}

/** A verse appears this long before its first word is sung. */
const LEAD_IN_SECONDS = 4.0;
/** A finished verse stays this long before it clears. */
const FADE_OUT_GRACE = 0.6;
/** A word without an end time wipes over this long. */
const UNTIMED_WORD_SECONDS = 1.2;
/** Verses longer than this are set smaller. */
const DENSE_VERSE_CHARS = 28;
/** No verse is on this line, and none has been since the last reset. */
const UNMOUNTED = -2;

/** Wipe percentage of one word at `time` on an active line. */
export const wordProgress = (start: number, end: number, time: number): number => {
  const wordEnd = end > start ? end : start + UNTIMED_WORD_SECONDS;
  if (time <= start) return 0;
  if (time >= wordEnd) return 100;
  return ((time - start) / (wordEnd - start)) * 100;
};

/** One physical lyric line and the verse it currently shows. */
interface LyricLine {
  readonly element: HTMLElement;
  verseIndex: number;
  words: HTMLElement[];
  /** Last wipe written per word; unchanged words are not touched again. */
  written: number[];
}

const speakerKey = (speaker?: string): string =>
  speaker?.replace(/<[^>]*>/g, '').replace(/:$/, '').trim().toLowerCase() || '';

/**
 * Draws the sung verse and the one after it, wiping each word as it is sung.
 *
 * Verses alternate between the two lines: even verses on the top line, odd
 * ones on the bottom, each mounted ahead of time so the eye can read on. A
 * verse appears no earlier than four seconds before it starts; through
 * instrumental breaks the stage is empty. In single-line mode only the
 * current verse is shown, fitted to one line.
 */
export function createRenderEngine(options: RenderEngineOptions): RenderEngineController {
  const { videoElement, containerElement } = options;
  const lyrics = (options.lyricsData || []).filter(verse => verse && Array.isArray(verse.words) && verse.words.length > 0);
  const globalOffset = options.globalOffset || 0;
  const top: LyricLine = { element: options.topLineElement, verseIndex: UNMOUNTED, words: [], written: [] };
  const bottom: LyricLine = { element: options.bottomLineElement, verseIndex: UNMOUNTED, words: [], written: [] };
  let singleLine = false;
  let lastTime = NaN;

  const verseHtml = (verse: Verse): string => {
    const words = verse.words.map(word => {
      const hasBreak = !singleLine && /\r?\n/.test(word.word);
      const text = lyricHtml(word.word.replace(/\r?\n/g, singleLine ? ' ' : ''));
      const display = word.furigana
        ? `<span class="yomitan-ruby" data-furi="${escapeHtml(word.furigana)}"><span class="ruby-base">${text}</span></span>`
        : text;
      const classes = `word-wrapper${word.furigana ? ' word-has-ruby' : ''}${hasCjk(word.word) ? ' word-cjk' : ''}`;
      const span = `<span class="${classes}"><span class="word-base">${display}</span><span class="word-highlight" aria-hidden="true">${display}</span></span>`;
      return hasBreak ? `${span}<span class="k-verse-break" aria-hidden="true"></span>` : span;
    }).join('');
    return verse.translation ? `${words}<span class="k-line-translation">${lyricHtml(verse.translation)}</span>` : words;
  };

  /** Puts verse `target` on the line. Returns whether the line's content changed. */
  const mount = (line: LyricLine, target: number, stageEmpty: boolean): boolean => {
    if (target === line.verseIndex) return false;
    line.verseIndex = target;
    const verse = lyrics[target];
    if (verse) {
      line.element.innerHTML = verseHtml(verse);
      line.words = Array.from(line.element.querySelectorAll<HTMLElement>('.word-wrapper'));
      line.written = [];
      line.element.classList.toggle('k-line-dense', verse.words.reduce((sum, word) => sum + word.word.length, 0) > DENSE_VERSE_CHARS);
      line.element.classList.toggle('k-line-has-ruby', verse.words.some(word => !!word.furigana));
      line.element.dataset.speaker = speakerKey(verse.speaker);
      line.element.style.visibility = 'visible';
    } else if (!stageEmpty) {
      line.element.innerHTML = '';
      line.words = [];
      line.element.classList.remove('k-line-has-ruby');
      line.element.style.visibility = 'hidden';
    }
    // Otherwise the stage is fading out, and the old words stay in place under the fade.
    return true;
  };

  const wipe = (line: LyricLine, time: number, active: number, recent: number) => {
    const verse = lyrics[line.verseIndex];
    if (!verse) return;
    const isActive = line.verseIndex === active;
    const isRecent = line.verseIndex === recent;
    line.element.classList.toggle('k-line-active', isActive || isRecent);
    line.element.classList.toggle('k-line-idle', !isActive && !isRecent);
    verse.words.forEach((word, index) => {
      const element = line.words[index];
      if (!element) return;
      const progress = isRecent ? 100 : isActive ? wordProgress(word.start, word.end, time) : 0;
      if (line.written[index] === progress) return;
      line.written[index] = progress;
      element.style.setProperty('--wipe-progress', `${progress}%`);
    });
  };

  // Fits a single physical line when its verse changes or the stage is resized,
  // so measurement stays out of the per-frame wipe.
  const fitSingleLine = () => {
    top.element.style.fontSize = '';
    if (!singleLine || !top.element.clientWidth) return;
    for (let pass = 0; pass < 2 && top.element.scrollWidth > top.element.clientWidth; pass++) {
      const size = parseFloat(getComputedStyle(top.element).fontSize);
      top.element.style.fontSize = `${size * top.element.clientWidth / top.element.scrollWidth}px`;
    }
  };

  const draw = () => {
    const time = videoElement.currentTime - globalOffset;
    if (time === lastTime) return;
    lastTime = time;

    let active = -1;
    let recent = -1;
    let upcoming = -1;
    lyrics.forEach((verse, index) => {
      // Verses can overlap: the newly started line takes focus immediately.
      if (time >= verse.verseStart && time < verse.verseEnd) active = index;
      if (time > verse.verseEnd && time <= verse.verseEnd + FADE_OUT_GRACE) recent = index;
      if (time < verse.verseStart && upcoming === -1) upcoming = index;
    });

    // The verse in focus: being sung, else just finished, else about to start.
    let focus = -1;
    if (active !== -1) focus = active;
    else if (recent !== -1) focus = recent;
    else if (upcoming !== -1 && time >= lyrics[upcoming].verseStart - LEAD_IN_SECONDS) focus = upcoming;

    // The focused verse takes the line matching its parity; the other line holds the verse after it.
    let topTarget = -1;
    let bottomTarget = -1;
    if (focus !== -1) {
      const next = focus + 1 < lyrics.length ? focus + 1 : -1;
      if (singleLine) topTarget = focus;
      else if (focus % 2 === 0) [topTarget, bottomTarget] = [focus, next];
      else [topTarget, bottomTarget] = [next, focus];
    }

    const topChanged = mount(top, topTarget, focus === -1);
    mount(bottom, bottomTarget, focus === -1);

    containerElement.style.opacity = focus === -1 ? '0' : '1';
    if (focus !== -1) {
      wipe(top, time, active, recent);
      wipe(bottom, time, active, recent);
    }
    if (topChanged) fitSingleLine();
  };

  const frames = followPlayback(videoElement, draw);
  const redraw = () => {
    lastTime = NaN;
    frames.draw();
  };

  const setLineMode = (mode: LineMode) => {
    singleLine = mode === 'single';
    containerElement.classList.toggle('lyrics-single-line', singleLine);
    // The score's lyric lane never reserves a second verse.
    bottom.element.hidden = singleLine;
    top.verseIndex = bottom.verseIndex = UNMOUNTED;
    redraw();
  };

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fitSingleLine) : undefined;
  resizeObserver?.observe(containerElement);
  setLineMode(options.lineMode ?? 'dual');

  return {
    destroy: () => {
      frames.stop();
      resizeObserver?.disconnect();
      top.element.style.fontSize = '';
      containerElement.classList.remove('lyrics-single-line');
      bottom.element.hidden = false;
    },
    setLineMode
  };
}
