import type { Word, Verse } from '../types/karaoke';
import { OPENING_PUNCT_REGEX, CLOSING_PUNCT_REGEX, cleanVersePunctuation } from './punctuation';

/**
 * Standardize text using Unicode NFC normalization and trimmed whitespace.
 */
export function normalizeText(str: string): string {
  if (!str) return '';
  return str.normalize('NFC').trim();
}

/**
 * Parses artist and title from a standard filename like "Artist - Title.mp4".
 */
export function parseSongInfoFromFilename(fileName: string): { artist: string; title: string; ext: string } {
  const norm = normalizeText(fileName);
  const extMatch = norm.match(/\.(mp4|webm|mkv)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
  const clean = norm.replace(/\.(mp4|webm|mkv)$/i, '');

  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    return { artist: artist || 'Unknown Artist', title: title || 'Untitled', ext };
  }

  return {
    artist: 'Unknown Artist',
    title: clean.trim() || 'Untitled',
    ext
  };
}

/**
 * Generates a canonical video filename "Artist - Title.mp4".
 * Sanitizes forbidden filesystem and URI characters.
 */
export function canonicalVideoFilename(artist: string, title: string, ext = 'mp4'): string {
  const cleanArtist = normalizeText(artist).replace(/[\/\\:*?"<>|]/g, '').trim() || 'Unknown';
  const cleanTitle = normalizeText(title).replace(/[\/\\:*?"<>|]/g, '').trim() || 'Untitled';
  const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'mp4';
  return `${cleanArtist} - ${cleanTitle}.${cleanExt}`;
}

/**
 * Deterministically generates a URL-safe lowercase slug (e.g. "bmth-go-to-hell").
 * Transliterates Latin diacritics and handles CJK/Cyrillic scripts robustly.
 */
export function canonicalSongId(artist: string, title: string, explicitSlug?: string): string {
  if (explicitSlug && explicitSlug.trim()) {
    const sanitized = normalizeText(explicitSlug)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (sanitized.length > 0) return sanitized;
  }

  // Decompose accented characters (e.g. é -> e, ø -> o, ü -> u)
  const combined = `${artist} ${title}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  let slug = combined
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // If slug is empty (purely Japanese, Cyrillic, etc.)
  if (!slug) {
    const unicodeClean = normalizeText(`${artist}-${title}`)
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    slug = unicodeClean || `song-${Date.now()}`;
  }

  return slug;
}

/**
 * Ingests raw lyrics text or LRC file content, breaking it into structured Verses and Words.
 * Automatically attaches opening and closing punctuation to adjacent phonetic words.
 */
export function parseRawLyrics(rawText: string): Verse[] {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const verses: Verse[] = [];

  const isLrcLine = /^\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\](.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lrcMatch = line.match(isLrcLine);

    let verseStart = 0;
    let verseContent = line;

    if (lrcMatch) {
      const mins = parseInt(lrcMatch[1], 10);
      const secs = parseFloat(lrcMatch[2]);
      verseStart = parseFloat((mins * 60 + secs).toFixed(3));
      verseContent = lrcMatch[3].trim();
    }

    if (!verseContent) continue;

    const words: Word[] = [];

    // Check if line contains CJK characters
    const hasCjk = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/.test(verseContent);

    if (hasCjk) {
      // Regex tokenizer for Japanese lyrics:
      // 1. Ruby annotation: 漢字[ふりがな]
      // 2. Compound kana (拗音, 促音, 長音): standard kana followed by small kana or ー
      // 3. Standalone Kanji
      // 4. Latin / alphanumeric words
      // 5. Punctuation
      // 6. Whitespace
      const tokenRegex = /([\u4e00-\u9faf\u3400-\u4dbf]+)\[([\u3040-\u309f\u30a0-\u30ff]+)\]|([\u3040-\u309f\u30a0-\u30ff][ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー]*)|([\u4e00-\u9faf\u3400-\u4dbf])|([^\s\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf「『“‘"'(（【〔《〈［\[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;]+)|([「『“‘"'(（【〔《〈［\[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;]+)|(\s+)/gu;

      let match: RegExpExecArray | null;
      let pendingPrefix = '';

      while ((match = tokenRegex.exec(verseContent)) !== null) {
        const [, rubyKanji, rubyFuri, compoundKana, singleKanji, latinWord, punct, whitespace] = match;

        if (whitespace) {
          if (words.length > 0) {
            const lastWord = words[words.length - 1];
            if (!/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(lastWord.word)) {
              if (!lastWord.word.endsWith(' ')) {
                lastWord.word += ' ';
              }
            }
          }
          continue;
        }

        if (punct) {
          if (OPENING_PUNCT_REGEX.test(punct)) {
            pendingPrefix += punct;
          } else if (CLOSING_PUNCT_REGEX.test(punct)) {
            if (words.length > 0) {
              words[words.length - 1].word += punct;
            } else {
              pendingPrefix += punct;
            }
          } else {
            pendingPrefix += punct;
          }
          continue;
        }

        if (rubyKanji && rubyFuri) {
          words.push({
            word: pendingPrefix + rubyKanji,
            furigana: rubyFuri,
            start: 0,
            end: 0
          });
          pendingPrefix = '';
        } else if (compoundKana) {
          words.push({
            word: pendingPrefix + compoundKana,
            start: 0,
            end: 0
          });
          pendingPrefix = '';
        } else if (singleKanji) {
          words.push({
            word: pendingPrefix + singleKanji,
            start: 0,
            end: 0
          });
          pendingPrefix = '';
        } else if (latinWord) {
          words.push({
            word: pendingPrefix + latinWord,
            start: 0,
            end: 0
          });
          pendingPrefix = '';
        }
      }

      if (pendingPrefix && words.length > 0) {
        words[words.length - 1].word += pendingPrefix;
      }
    } else {
      const parts = verseContent.split(/(\s+)/);
      let currentWord = '';

      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (/^\s+$/.test(part)) {
          if (currentWord) {
            currentWord += part;
            words.push({ word: currentWord, start: 0, end: 0 });
            currentWord = '';
          }
        } else {
          if (currentWord) {
            words.push({ word: currentWord, start: 0, end: 0 });
          }
          currentWord = part;
        }
      }
      if (currentWord) {
        words.push({ word: currentWord, start: 0, end: 0 });
      }
    }

    if (words.length > 0) {
      verses.push({
        verseStart,
        verseEnd: verseStart > 0 ? parseFloat((verseStart + 2).toFixed(3)) : 0,
        words
      });
    }
  }

  return cleanVersePunctuation(verses);
}
