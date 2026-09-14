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
  verses.forEach((verse, vIdx) => {
    let innerDurSum = 0;
    let innerCount = 0;
    for (let j = 0; j < verse.words.length - 1; j++) {
      const d = verse.words[j].end - verse.words[j].start;
      if (d > 0.05 && d < 4.0) { innerDurSum += d; innerCount++; }
    }
    const avgDur = innerCount > 0 ? (innerDurSum / innerCount) : 0.4;
    const nextV = verses[vIdx + 1];
    const nextStart = (nextV && nextV.words && nextV.words.length > 0) ? nextV.words[0].start : null;

    let maxWordEnd = 0;
    verse.words.forEach((w, idx) => {
      if (w.start > 0 && (!w.end || w.end <= w.start)) {
        const next = verse.words[idx + 1];
        if (next && next.start > w.start) {
          w.end = next.start;
        } else {
          const naturalHold = Math.max(0.8, Math.min(1.8, avgDur * 2.0));
          const limit = (nextStart !== null && nextStart > w.start) ? (nextStart - w.start) : naturalHold;
          w.end = parseFloat((w.start + Math.min(limit, naturalHold)).toFixed(3));
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
      const naturalEnd = parseFloat((maxWordEnd + 0.4).toFixed(3));
      if (nextStart !== null && nextStart > maxWordEnd) {
        verse.verseEnd = Math.min(nextStart, naturalEnd);
      } else {
        verse.verseEnd = Math.max(verse.verseStart + 0.5, naturalEnd);
      }
    }
  });

  return verses;
}
