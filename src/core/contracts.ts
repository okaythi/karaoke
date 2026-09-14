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

  if (typeof p.globalOffset !== 'number' || isNaN(p.globalOffset)) {
    errors.push('globalOffset must be a valid number.');
  }

  if (!Array.isArray(p.lyricsData)) {
    errors.push('lyricsData must be an array of verses.');
  } else {
    p.lyricsData.forEach((verse, vIdx) => {
      if (typeof verse.verseStart !== 'number' || isNaN(verse.verseStart) || verse.verseStart < 0) {
        errors.push(`Verse #${vIdx + 1} has invalid verseStart: ${verse.verseStart}`);
      }
      if (typeof verse.verseEnd !== 'number' || isNaN(verse.verseEnd) || verse.verseEnd < verse.verseStart) {
        errors.push(`Verse #${vIdx + 1} has invalid verseEnd (${verse.verseEnd} < ${verse.verseStart})`);
      }
      if (!Array.isArray(verse.words)) {
        errors.push(`Verse #${vIdx + 1} words must be an array.`);
      } else {
        verse.words.forEach((w, wIdx) => {
          if (typeof w.word !== 'string') {
            errors.push(`Verse #${vIdx + 1}, Word #${wIdx + 1} word must be a string.`);
          }
          if (typeof w.start !== 'number' || isNaN(w.start) || w.start < 0) {
            errors.push(`Verse #${vIdx + 1}, Word "${w.word}" has invalid start time: ${w.start}`);
          }
          if (typeof w.end !== 'number' || isNaN(w.end) || w.end < w.start) {
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
  verses.forEach((verse) => {
    let maxWordEnd = 0;
    verse.words.forEach((w, idx) => {
      if (w.start > 0 && (!w.end || w.end <= w.start)) {
        const next = verse.words[idx + 1];
        if (next && next.start > w.start) {
          w.end = next.start;
        } else if (verse.verseEnd > w.start) {
          w.end = verse.verseEnd;
        } else {
          w.end = parseFloat((w.start + 1.5).toFixed(3));
        }
      }
      if (w.end && w.end > maxWordEnd) {
        maxWordEnd = w.end;
      }
    });

    if (verse.words.length > 0) {
      if (verse.verseStart <= 0 && verse.words[0].start > 0) {
        verse.verseStart = verse.words[0].start;
      }
      if (verse.verseEnd <= verse.verseStart) {
        verse.verseEnd = parseFloat((Math.max(verse.verseStart + 1.0, maxWordEnd)).toFixed(3));
      }
    }
  });

  return verses;
}
