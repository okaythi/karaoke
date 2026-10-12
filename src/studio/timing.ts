import { autoHealTimings } from '../core/contracts';
import { isTimed, partIds } from '../core/parts';
import type { Verse } from '../types/karaoke';

export interface Cursor { v: number; w: number }
export const matchesPart = (verse: Verse, part: string) => part === '*' || (part === '' ? !partIds(verse).length : partIds(verse).includes(part));

export function nextCursor(verses: Verse[], cursor: Cursor, part: string, direction = 1): Cursor | null {
  let { v, w } = cursor;
  if (verses[v] && matchesPart(verses[v], part)) {
    const candidate = w + direction;
    if (candidate >= 0 && candidate < verses[v].words.length) return { v, w: candidate };
  }
  for (v += direction; v >= 0 && v < verses.length; v += direction) {
    if (matchesPart(verses[v], part) && verses[v].words.length) return { v, w: direction > 0 ? 0 : verses[v].words.length - 1 };
  }
  return null;
}

/** Mutates this phrase only: another singer's entrance never closes this voice. */
export function stampStart(verse: Verse, index: number, time: number): void {
  const word = verse.words[index];
  if (!word) return;
  word.start = Math.max(0, Number(time.toFixed(3)));
  word.timed = true;
  if (!word.endLocked || word.end < word.start) { word.end = word.start; word.endLocked = false; }
  const previous = verse.words[index - 1];
  if (previous && isTimed(previous) && !previous.endLocked && word.start >= previous.start) previous.end = word.start;
  autoHealTimings([verse]);
}

export function stampEnd(verse: Verse, index: number, time: number): void {
  const word = verse.words[index];
  if (!word || !isTimed(word)) return;
  word.end = Math.max(word.start, Number(time.toFixed(3)));
  word.endLocked = true;
  autoHealTimings([verse]);
}

/** Solo imports keep ordinary traversal; ensemble recording never silently uses all voices. */
export function recordingTarget(partCount: number, recordingPart: string | null): string | null {
  return partCount ? recordingPart : '*';
}

/** A clicked shared phrase stays on the armed voice if it belongs to that phrase. */
export function phraseRecordingPart(verse: Verse, recordingPart: string | null): string {
  const ids = partIds(verse);
  return recordingPart !== null && ids.includes(recordingPart) ? recordingPart : ids[0] ?? '';
}

/** Both E and the visible button end the same recorded word, after Space advances. */
export function endWordCursor(verses: Verse[], cursor: Cursor, lastStamped: Cursor | null, part: string | null): Cursor | null {
  if (part === null) return null;
  const target = lastStamped ?? cursor;
  const verse = verses[target.v];
  const word = verse?.words[target.w];
  return verse && matchesPart(verse, part) && word && isTimed(word) ? target : null;
}
