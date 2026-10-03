/**
 * Structural checks on a score. A score that passes can be laid out: every
 * reference resolves, every catalogue kind is used the way its entry says,
 * every voice fills its measures exactly, and ties join equal pitches.
 */
import * as F from '../core/fraction';
import { midi } from '../core/pitch';
import { entry, isNotation } from '../catalogue/registry';
import { ScoreIndex } from './query';
import type { Anchor, Score } from './types';

export interface Issue {
  readonly level: 'error' | 'warning';
  readonly message: string;
  /** The element the issue is about. */
  readonly ref?: string;
}

export function validateScore(score: Score): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string, ref?: string) => issues.push({ level: 'error', message, ref });
  const warning = (message: string, ref?: string) => issues.push({ level: 'warning', message, ref });

  if (score.schema !== 1) error(`Unknown schema ${score.schema}`);
  if (!score.measures.length) { error('A score needs at least one measure'); return issues; }
  let index: ScoreIndex;
  try { index = new ScoreIndex(score); } catch (problem) { error((problem as Error).message); return issues; }

  const staffIds = new Set(score.staves.map(staff => staff.id));
  const ids = new Set<string>();
  const unique = (id: string) => { if (ids.has(id)) error(`Duplicate ID ${id}`, id); ids.add(id); };

  for (const tuplet of score.tuplets) {
    unique(tuplet.id);
    if (tuplet.actual <= 0 || tuplet.normal <= 0) error('Tuplet ratio must be positive', tuplet.id);
    if (tuplet.parent && !score.tuplets.some(other => other.id === tuplet.parent)) error(`Unknown parent tuplet ${tuplet.parent}`, tuplet.id);
  }

  for (const event of score.events) {
    unique(event.id);
    if (event.measure < 0 || event.measure >= score.measures.length) { error('Measure out of range', event.id); continue; }
    if (!staffIds.has(event.staff)) error(`Unknown staff ${event.staff}`, event.id);
    if (event.voice < 1) error('Voices are numbered from 1', event.id);
    if (event.tuplet && !score.tuplets.some(tuplet => tuplet.id === event.tuplet)) error(`Unknown tuplet ${event.tuplet}`, event.id);
    if (F.lt(event.offset, F.ZERO)) error('Negative offset', event.id);
    if (F.gt(index.end(event), index.measureLength(event.measure))) error('Event runs past the end of its measure', event.id);
    if (event.kind === 'chord') {
      if (!event.notes.length) error('A chord needs at least one note', event.id);
      for (const note of event.notes) {
        unique(note.id);
        if (note.staff && !staffIds.has(note.staff)) error(`Unknown staff ${note.staff}`, note.id);
      }
    }
  }

  // Every voice that appears in a measure fills it exactly, without overlaps.
  for (let measure = 0; measure < score.measures.length; measure++) {
    for (const staff of score.staves) {
      for (const voice of index.voicesIn(measure, staff.id)) {
        let cursor = F.ZERO;
        for (const event of index.eventsIn(measure, staff.id, voice)) {
          if (event.kind === 'chord' && event.grace) continue;
          if (F.lt(event.offset, cursor)) error(`Overlaps the previous event in voice ${voice}`, event.id);
          else if (F.gt(event.offset, cursor)) warning(`Gap before this event in voice ${voice}`, event.id);
          cursor = F.max(cursor, index.end(event));
        }
        if (F.lt(cursor, index.measureLength(measure)))
          warning(`Voice ${voice} of ${staff.id} stops before the end of measure ${score.measures[measure].number}`);
      }
    }
  }

  const resolves = (anchor: Anchor): boolean => {
    if ('event' in anchor) return index.hasEvent(anchor.event);
    if ('note' in anchor) { try { index.note(anchor.note); return true; } catch { return false; } }
    if ('barline' in anchor) return anchor.barline.measure >= 0 && anchor.barline.measure < score.measures.length;
    return anchor.position.measure >= 0 && anchor.position.measure < score.measures.length;
  };

  for (const attachment of score.attachments) {
    unique(attachment.id);
    if (!isNotation(attachment.kind)) { error(`Unknown notation ${attachment.kind}`, attachment.id); continue; }
    const known = entry(attachment.kind);
    if (known.model !== 'attachment') error(`${attachment.kind} is a ${known.model}, not an attachment`, attachment.id);
    if (!resolves(attachment.anchor)) error('Anchor does not resolve', attachment.id);
  }

  for (const spanner of score.spanners) {
    unique(spanner.id);
    if (!isNotation(spanner.kind)) { error(`Unknown notation ${spanner.kind}`, spanner.id); continue; }
    const known = entry(spanner.kind);
    if (known.model !== 'spanner') error(`${spanner.kind} is a ${known.model}, not a spanner`, spanner.id);
    if (!resolves(spanner.start) || !resolves(spanner.end)) { error('Anchor does not resolve', spanner.id); continue; }
    if (spanner.staff && !score.staves.some(staff => staff.id === spanner.staff)) error(`Unknown staff ${spanner.staff}`, spanner.id);
    if (spanner.kind === 'tie' && 'note' in spanner.start && 'note' in spanner.end) {
      const from = index.note(spanner.start.note), to = index.note(spanner.end.note);
      if (midi(from.note.pitch) !== midi(to.note.pitch)) error('A tie must join equal pitches', spanner.id);
    }
  }

  for (const change of score.clefs) {
    unique(change.id);
    if (!staffIds.has(change.staff)) error(`Unknown staff ${change.staff}`, change.id);
  }
  return issues;
}
