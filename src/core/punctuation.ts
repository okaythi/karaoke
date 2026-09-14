import type { Word, Verse } from '../types/karaoke';

export const OPENING_PUNCT_REGEX = /^[「『“‘"'(（【〔《〈［\[]+$/;
export const CLOSING_PUNCT_REGEX = /^[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;]+$/;
export const ALL_PUNCT_REGEX = /^[「『“‘"'(（【〔《〈［\[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;\s]+$/;

/**
 * Automatically merges isolated punctuation (quotes, brackets, periods) into adjacent words
 * so users never have to tap/sync a quotation mark or punctuation symbol.
 */
export function cleanVersePunctuation(verses: Verse[]): Verse[] {
  verses.forEach(v => {
    if (!v.words || v.words.length === 0) return;

    const cleaned: Word[] = [];
    let pendingPrefix = '';

    for (let i = 0; i < v.words.length; i++) {
      const w = v.words[i];
      const trimmed = w.word.trim();

      // If word is pure punctuation
      if (ALL_PUNCT_REGEX.test(trimmed)) {
        if (OPENING_PUNCT_REGEX.test(trimmed)) {
          // Opening quote: accumulate to prepend to the next word
          pendingPrefix += w.word;
        } else if (cleaned.length > 0) {
          // Closing quote or punctuation: append to previous word
          const prev = cleaned[cleaned.length - 1];
          prev.word = prev.word.trimEnd() + w.word;
          if (w.end > prev.end) prev.end = w.end;
        } else {
          // Lone punctuation at start: accumulate as prefix
          pendingPrefix += w.word;
        }
      } else {
        // Normal word: attach any accumulated opening punctuation prefix
        if (pendingPrefix) {
          w.word = pendingPrefix + w.word;
          pendingPrefix = '';
        }
        cleaned.push(w);
      }
    }

    // If any leftover prefix with no subsequent word, append to last word
    if (pendingPrefix && cleaned.length > 0) {
      cleaned[cleaned.length - 1].word += pendingPrefix;
    }

    v.words = cleaned;
  });

  return verses;
}
