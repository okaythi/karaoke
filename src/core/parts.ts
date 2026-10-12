import type { LyricPart, Verse, Word } from '../types/karaoke';

export const PART_COLORS = ['#edd18e', '#8fd5f4', '#eaa3da', '#9bd7a0', '#c0b2ff', '#ffad86', '#8ce0d0', '#e7c898', '#c6d87d', '#e9a8b1'];
export const partKey = (name: string) => name.normalize('NFC').trim().toLocaleLowerCase('en-US');
export const partIds = (verse: Verse): string[] =>
  [...new Set((verse.speakers?.length ? verse.speakers : verse.speaker ? [verse.speaker] : []).map(partKey))];
export const isTimed = (word: Word): boolean => word.timed ?? (word.start > 0 || word.end > 0);
export const isVerseTimed = (verse: Verse): boolean => verse.verseEnd > verse.verseStart && verse.words.some(isTimed);

/** Retains chosen colours; also makes legacy speaker assignments editable. */
export function collectParts(verses: Verse[], existing: LyricPart[] = []): LyricPart[] {
  const parts = existing.map(part => ({ ...part, id: partKey(part.id) }));
  const known = new Set(parts.map(part => part.id));
  for (const verse of verses) {
    const names = verse.speakers?.length ? verse.speakers : verse.speaker ? [verse.speaker] : [];
    for (const name of names) {
      const id = partKey(name);
      if (!known.has(id)) {
        parts.push({ id, name, color: PART_COLORS[parts.length % PART_COLORS.length] });
        known.add(id);
      }
    }
  }
  return parts;
}

export function partColor(verse: Verse, parts: LyricPart[]): string {
  return parts.find(part => part.id === partIds(verse)[0])?.color ?? '#deb668';
}
