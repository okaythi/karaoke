import { isTimed, partIds, partKey } from './parts';
import type { SaveLyricsPayload, Verse } from '../types/karaoke';

/**
 * Validates a SaveLyricsPayload against strict mathematical rules:
 * - Timestamps must be non-negative numbers.
 * - verseEnd >= verseStart.
 * - For each word: end >= start.
 * - Identifiers and filenames must not be empty.
 */
export function validateSongContract(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = payload as Partial<SaveLyricsPayload>;

  if (!p.id || typeof p.id !== 'string' || !/^[a-z0-9\u0080-\uffff_-]+$/i.test(p.id)) {
    errors.push(`Invalid song ID: "${p.id}". Must be non-empty and URL-safe.`);
  }

  if (!p.videoFile || typeof p.videoFile !== 'string' || !/\.(mp4|webm|mkv)$/i.test(p.videoFile)) {
    errors.push(`Invalid videoFile: "${p.videoFile}". Must end with .mp4, .webm, or .mkv.`);
  }

  if (!p.title || typeof p.title !== 'string' || !p.title.trim()) {
    errors.push('Song title must not be empty.');
  }

  if (!p.artist || typeof p.artist !== 'string' || !p.artist.trim()) {
    errors.push('Song artist must not be empty.');
  }

  if (typeof p.globalOffset !== 'number' || !Number.isFinite(p.globalOffset)) {
    errors.push('globalOffset must be a valid number.');
  }

  const knownParts = new Set<string>();
  if (p.parts !== undefined) {
    if (!Array.isArray(p.parts)) errors.push('parts must be an array.');
    else for (const part of p.parts) {
      if (!part || typeof part.id !== 'string' || !part.id.trim() || typeof part.name !== 'string' || !part.name.trim() || typeof part.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(part.color)) {
        errors.push('Each part needs an id, name and #RRGGBB colour.');
        continue;
      }
      const key = partKey(part.id);
      if (knownParts.has(key)) errors.push(`Duplicate part: ${part.id}`);
      knownParts.add(key);
    }
  }

  if (!Array.isArray(p.lyricsData)) {
    errors.push('lyricsData must be an array of verses.');
  } else {
    p.lyricsData.forEach((verse, vIdx) => {
      if (!verse || typeof verse !== 'object') { errors.push(`Verse #${vIdx + 1} must be an object.`); return; }
      if (verse.speaker !== undefined && typeof verse.speaker !== 'string') errors.push(`Verse #${vIdx + 1} has an invalid speaker.`);
      const validSpeakers = verse.speakers === undefined || (Array.isArray(verse.speakers) && verse.speakers.every(id => typeof id === 'string' && id.trim()));
      if (!validSpeakers) errors.push(`Verse #${vIdx + 1} has invalid shared parts.`);
      if (Array.isArray(p.parts) && validSpeakers && (verse.speaker === undefined || typeof verse.speaker === 'string')) {
        for (const id of partIds(verse)) if (!knownParts.has(id)) errors.push(`Verse #${vIdx + 1} references unknown part: ${id}`);
      }
      if (typeof verse.verseStart !== 'number' || !Number.isFinite(verse.verseStart) || verse.verseStart < 0) {
        errors.push(`Verse #${vIdx + 1} has invalid verseStart: ${verse.verseStart}`);
      }
      if (typeof verse.verseEnd !== 'number' || !Number.isFinite(verse.verseEnd) || verse.verseEnd < verse.verseStart) {
        errors.push(`Verse #${vIdx + 1} has invalid verseEnd (${verse.verseEnd} < ${verse.verseStart})`);
      }
      if (!Array.isArray(verse.words)) {
        errors.push(`Verse #${vIdx + 1} words must be an array.`);
      } else {
        verse.words.forEach((w, wIdx) => {
          if (!w || typeof w !== 'object') { errors.push(`Verse #${vIdx + 1} contains an invalid word.`); return; }
          if (w.timed !== undefined && typeof w.timed !== 'boolean') errors.push('timed must be a boolean.');
          if (w.endLocked !== undefined && typeof w.endLocked !== 'boolean') errors.push('endLocked must be a boolean.');
          if (typeof w.word !== 'string') {
            errors.push(`Verse #${vIdx + 1}, Word #${wIdx + 1} word must be a string.`);
          }
          if (typeof w.start !== 'number' || !Number.isFinite(w.start) || w.start < 0) {
            errors.push(`Verse #${vIdx + 1}, Word "${w.word}" has invalid start time: ${w.start}`);
          }
          if (typeof w.end !== 'number' || !Number.isFinite(w.end) || w.end < w.start) {
            errors.push(`Verse #${vIdx + 1}, Word "${w.word}" has invalid end time: ${w.end} (start: ${w.start})`);
          }
        });
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Auto-heals unclosed word endpoints and verse boundaries before contract validation.
 */
export function autoHealTimings(verses: Verse[]): Verse[] {
  verses.forEach(verse => {
    let innerDurSum = 0;
    let innerCount = 0;
    for (let j = 0; j < verse.words.length - 1; j++) {
      const d = verse.words[j].end - verse.words[j].start;
      if (d > 0.05 && d < 4.0) { innerDurSum += d; innerCount++; }
    }
    const avgDur = innerCount > 0 ? (innerDurSum / innerCount) : 0.4;

    let maxWordEnd = 0;
    verse.words.forEach((w, idx) => {
      if (isTimed(w) && !w.endLocked && (!w.end || w.end <= w.start)) {
        const next = verse.words[idx + 1];
        if (next && isTimed(next) && next.start > w.start) {
          w.end = next.start;
        } else {
          const naturalHold = Math.max(0.8, Math.min(1.8, avgDur * 2.0));
          w.end = parseFloat((w.start + naturalHold).toFixed(3));
        }
      }
      if (isTimed(w) && w.end > maxWordEnd) {
        maxWordEnd = w.end;
      }
    });

    const timedWords = verse.words.filter(isTimed);
    if (timedWords.length > 0) {
      verse.verseStart = Math.min(...timedWords.map(word => word.start));
      verse.verseEnd = Math.max(verse.verseStart, maxWordEnd);
    }
  });

  return verses;
}
