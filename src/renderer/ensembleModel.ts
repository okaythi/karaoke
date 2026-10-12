import { isTimed, isVerseTimed, partIds } from '../core/parts';
import type { Verse } from '../types/karaoke';

export const ENSEMBLE_LEAD_IN = 2;
const FADE_OUT_GRACE = 0.6;
const SOLO_PROMINENCE_WEIGHT = 3;

export interface EnsembleLane {
  key: string;
  partIds: string[];
  verses: number[];
  /** Reserved stack height keeps lower singers still when a held line clears. */
  maxLines: number;
}

export interface EnsembleSection {
  start: number;
  end: number;
  /** One area per singer, with the inferred lead first. */
  voices: EnsembleLane[];
  /** Shared words appear once, centered, rather than becoming another singer. */
  shared: EnsembleLane[];
}

type Entrance = { verse: Verse; index: number };

function groupLanes(members: Entrance[]): { voices: EnsembleLane[]; shared: EnsembleLane[] } {
  const lanes = new Map<string, EnsembleLane>();
  for (const { verse, index } of members) {
    const ids = partIds(verse).sort();
    const key = JSON.stringify(ids);
    let lane = lanes.get(key);
    if (!lane) { lane = { key, partIds: ids, verses: [], maxLines: 1 }; lanes.set(key, lane); }
    lane.verses.push(index);
  }
  return {
    voices: [...lanes.values()].filter(lane => lane.partIds.length <= 1),
    shared: [...lanes.values()].filter(lane => lane.partIds.length > 1)
  };
}

/** Rank by actual sung time, with extra weight for exposed solo moments.
 * A sweep unions same-singer overlaps, so duplicate/estimated tails cannot
 * inflate a singer's score. Shared choruses do not influence the solo lead.
 * This is a timing heuristic, not an attempt to infer prominence from audio.
 */
function prominence(lanes: EnsembleLane[], verses: Verse[]): Map<string, number> {
  const events: { time: number; key: string; delta: number }[] = [];
  for (const lane of lanes) {
    for (const index of lane.verses) {
      for (const word of verses[index].words) {
        if (!isTimed(word) || word.end <= word.start) continue;
        events.push({ time: word.start, key: lane.key, delta: 1 }, { time: word.end, key: lane.key, delta: -1 });
      }
    }
  }
  events.sort((a, b) => a.time - b.time);
  const active = new Map<string, number>();
  const scores = new Map(lanes.map(lane => [lane.key, 0]));
  let previous = events[0]?.time ?? 0;
  for (const event of events) {
    const duration = event.time - previous;
    if (duration > 0) {
      for (const key of active.keys()) scores.set(key, scores.get(key)! + duration * (active.size === 1 ? SOLO_PROMINENCE_WEIGHT : 1));
    }
    const count = (active.get(event.key) ?? 0) + event.delta;
    if (count > 0) active.set(event.key, count); else active.delete(event.key);
    previous = event.time;
  }
  return scores;
}

function sameCast(a: EnsembleSection, b: EnsembleSection): boolean {
  const keys = (section: EnsembleSection) => [...section.voices, ...section.shared].map(lane => lane.key).sort();
  const left = keys(a), right = keys(b);
  return left.length === right.length && left.every((key, i) => key === right[i]);
}

/** Compile choreography once on load/timing edits, never inside playback frames.
 * Positions persist through each connected passage. A new cast is an explicit
 * formation change; short breaths with the same cast keep the same formation.
 */
export function buildEnsembleSections(verses: Verse[]): EnsembleSection[] {
  const ordered = verses.map((verse, index) => ({ verse, index })).filter(item => isVerseTimed(item.verse)).sort((a, b) => a.verse.verseStart - b.verse.verseStart || a.index - b.index);
  const globalVoices = groupLanes(ordered).voices;
  const globalScores = prominence(globalVoices, verses);
  const order = globalVoices.sort((a, b) => globalScores.get(b.key)! - globalScores.get(a.key)!).map(lane => lane.key);
  const sections: EnsembleSection[] = [];
  let members: Entrance[] = [];
  let start = 0, end = 0;
  const finish = () => {
    if (!members.length) return;
    const section: EnsembleSection = { start, end, ...groupLanes(members) };
    const previous = sections.at(-1);
    if (previous && start - previous.end <= ENSEMBLE_LEAD_IN && sameCast(previous, section)) {
      previous.end = end;
      for (const lane of [...section.voices, ...section.shared]) {
        [...previous.voices, ...previous.shared].find(item => item.key === lane.key)!.verses.push(...lane.verses);
      }
    } else sections.push(section);
  };
  for (const item of ordered) {
    if (members.length && item.verse.verseStart >= end) { finish(); members = []; }
    if (!members.length) { start = item.verse.verseStart; end = item.verse.verseEnd; }
    end = Math.max(end, item.verse.verseEnd);
    members.push(item);
  }
  finish();
  for (const section of sections) {
    const scores = prominence(section.voices, verses);
    const stableOrder = (a: EnsembleLane, b: EnsembleLane) => order.indexOf(a.key) - order.indexOf(b.key);
    section.voices.sort(stableOrder);
    // Choose a passage lead once, then preserve the song's order for all backing voices.
    const lead = [...section.voices].sort((a, b) => scores.get(b.key)! - scores.get(a.key)! || stableOrder(a, b))[0];
    if (lead && section.voices.length > 2) section.voices = [lead, ...section.voices.filter(lane => lane !== lead)];
    for (const lane of [...section.voices, ...section.shared]) {
      const edges = lane.verses.flatMap(index => [{ time: verses[index].verseStart, delta: 1 }, { time: verses[index].verseEnd, delta: -1 }]);
      edges.sort((a, b) => a.time - b.time || a.delta - b.delta);
      let active = 0;
      for (const edge of edges) { active += edge.delta; lane.maxLines = Math.max(lane.maxLines, active); }
    }
    section.shared.sort((a, b) => a.key.localeCompare(b.key));
  }
  return sections;
}

export function visibleSection(sections: EnsembleSection[], time: number): EnsembleSection | undefined {
  return sections.find(section => time >= section.start && time < section.end)
    ?? sections.find(section => time >= section.start - ENSEMBLE_LEAD_IN && time < section.start)
    ?? sections.find(section => time >= section.end && time <= section.end + FADE_OUT_GRACE);
}

/** The latest entrance owns the singer's main line. Real held overlaps remain
 * beneath it, in the same area, with independent word wipes. No active text is lost.
 */
export function laneVerses(lane: EnsembleLane, verses: Verse[], time: number): number[] {
  const active = lane.verses.filter(index => time >= verses[index].verseStart && time < verses[index].verseEnd);
  if (active.length) return active.reverse();
  const next = lane.verses.find(index => time < verses[index].verseStart && time >= verses[index].verseStart - ENSEMBLE_LEAD_IN);
  if (next !== undefined) return [next];
  const recent = lane.verses.findLast(index => time >= verses[index].verseEnd && time <= verses[index].verseEnd + FADE_OUT_GRACE);
  return recent === undefined ? [] : [recent];
}

export interface EnsemblePlacement { column: number; span: number; row: number }

/** Places depend on the passage cast and viewport, never on which phrases are visible. */
export function ensembleLayout(count: number, width: number): { columns: number; places: EnsemblePlacement[] } {
  const columns = Math.min(Math.max(1, count), width >= 720 ? 3 : width >= 360 ? 2 : 1);
  if (count <= 2 || columns === 1) {
    return { columns, places: Array.from({ length: count }, (_, i) => ({ column: i % columns + 1, span: 1, row: Math.floor(i / columns) + 1 })) };
  }
  const places: EnsemblePlacement[] = [{ column: columns === 3 ? 2 : 1, span: columns === 3 ? 1 : 2, row: 1 }];
  for (let i = 1; i < count; i++) {
    const support = i - 1;
    if (columns === 3 && support < 2) places.push({ column: support === 0 ? 1 : 3, span: 1, row: 1 });
    else {
      const remaining = columns === 3 ? support - 2 : support;
      const rowStart = Math.floor(remaining / columns) * columns;
      const rowCount = Math.min(columns, count - (columns === 3 ? 3 : 1) - rowStart);
      // Center the last backing singer; a final pair flank the center symmetrically.
      const column = columns === 3 && rowCount < 3 ? (rowCount === 1 ? 2 : remaining % columns === 0 ? 1 : 3) : remaining % columns + 1;
      places.push({ column, span: columns === 2 && rowCount === 1 ? 2 : 1, row: Math.floor(remaining / columns) + 2 });
    }
  }
  return { columns, places };
}

/** Reserve the tallest possible visible stack for a lane, using measured text
 * heights at its current width. Touching phrases never reserve a false overlap.
 */
export function reservedLaneHeight(lane: EnsembleLane, verses: Verse[], heights: Map<number, { primary: number; tail: number }>): number {
  const events = lane.verses.flatMap((index, rank) => [{ time: verses[index].verseStart, rank, delta: 1 }, { time: verses[index].verseEnd, rank, delta: -1 }]);
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  const active = new Set<number>();
  let tailHeight = 0;
  let maximum = Math.max(0, ...lane.verses.map(index => heights.get(index)!.primary));
  for (const event of events) {
    const height = heights.get(lane.verses[event.rank])!;
    if (event.delta > 0) active.add(event.rank); else active.delete(event.rank);
    tailHeight += event.delta * height.tail;
    if (!active.size) continue;
    const latest = heights.get(lane.verses[Math.max(...active)])!;
    maximum = Math.max(maximum, tailHeight + latest.primary - latest.tail);
  }
  return Math.ceil(maximum);
}
