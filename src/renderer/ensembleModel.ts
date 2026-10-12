import { isVerseTimed, partIds } from '../core/parts';
import type { Verse } from '../types/karaoke';

export interface EnsembleSection {
  start: number;
  end: number;
  /** Stable slots throughout an overlapping passage; same-voice overlaps get extra slots. */
  slots: number[][];
}

export function buildEnsembleSections(verses: Verse[]): EnsembleSection[] {
  const ordered = verses.map((verse, index) => ({ verse, index })).filter(item => isVerseTimed(item.verse)).sort((a, b) => a.verse.verseStart - b.verse.verseStart || a.index - b.index);
  const sections: EnsembleSection[] = [];
  let members: number[] = [];
  let start = 0, end = 0;
  const finish = () => {
    if (!members.length) return;
    const slots: number[][] = [];
    const keys: string[] = [];
    for (const index of members) {
      const verse = verses[index];
      const key = partIds(verse).sort().join('+');
      let slot = slots.findIndex((items, s) => keys[s] === key && verses[items[items.length - 1]].verseEnd <= verse.verseStart);
      if (slot < 0) { slot = slots.length; slots.push([]); keys.push(key); }
      slots[slot].push(index);
    }
    sections.push({ start, end, slots });
  };
  for (const { verse, index } of ordered) {
    if (members.length && verse.verseStart >= end) { finish(); members = []; }
    if (!members.length) { start = verse.verseStart; end = verse.verseEnd; }
    end = Math.max(end, verse.verseEnd);
    members.push(index);
  }
  finish();
  return sections;
}

export function visibleSection(sections: EnsembleSection[], time: number): EnsembleSection | undefined {
  return sections.find(section => time >= section.start && time < section.end)
    ?? sections.find(section => time >= section.start - 2 && time < section.start)
    ?? sections.find(section => time >= section.end && time <= section.end + 0.6);
}

export function slotVerse(slot: number[], verses: Verse[], time: number): number {
  const active = slot.find(index => time >= verses[index].verseStart && time < verses[index].verseEnd);
  if (active !== undefined) return active;
  const next = slot.find(index => time < verses[index].verseStart && time >= verses[index].verseStart - 2);
  if (next !== undefined) return next;
  return slot.findLast(index => time >= verses[index].verseEnd && time <= verses[index].verseEnd + 0.6) ?? -1;
}
