import { parseRawLyrics } from './tokenizer';
import { collectParts, partKey } from './parts';
import type { LyricPart, Verse } from '../types/karaoke';

export interface LyricImport { verses: Verse[]; parts: LyricPart[]; warnings: string[] }

/** Character headers are metadata, never tokens. Existing plain text and LRC still work. */
export function parseLyricImport(text: string): LyricImport {
  const verses = parseRawLyrics(text);
  const parts = collectParts(verses);
  const warnings: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('// REVIEW:')) warnings.push(line.trim().slice(3));
    if (!line.trim().startsWith('@')) continue;
    const [names, rawColor] = line.trim().slice(1).split('|').map(value => value.trim());
    if (!names || (names !== '-' && names.split('+').some(name => !name.trim()))) {
      throw new Error('A character header needs a name, for example @Pepa. Use @- for unassigned lyrics.');
    }
    if (rawColor) {
      if (!/^#[0-9a-f]{6}$/i.test(rawColor)) throw new Error(`Invalid colour in ${line}. Use #RRGGBB.`);
      if (names.includes('+')) throw new Error('Set colours on individual character headers before using a shared header.');
      const part = parts.find(part => part.id === partKey(names));
      if (part) part.color = rawColor;
    }
  }
  // Untimed words have a real flag; a timed word at 0:00 is therefore possible.
  for (const verse of verses) for (const word of verse.words) word.timed = false;
  return { verses, parts, warnings };
}
