/**
 * Reviewed corrections to a generated score, docs §11. Edits are a closed
 * set of operations in the catalogue's vocabulary; each names the score IDs
 * it touches and why. They apply in order to `score.generated.json` to give
 * `score.json`. An edit whose target no longer exists (because a re-import
 * changed the music there) fails the build instead of silently vanishing.
 */
import { parsePitch } from '../core/pitch';
import { isNotation } from '../catalogue/registry';
import type { Attachment, ChordEvent, Labels, Note, Score, ScoreEvent, Spanner, StaffId, Tuplet } from './types';

interface EditBase {
  /** Why the change is right; kept with the score. */
  readonly reason: string;
}

export type Edit = EditBase & (
  | { readonly op: 'respell'; readonly note: string; readonly pitch: string }
  /** Draws a note on another staff of its group (cross-staff); its event stays where it is. */
  | { readonly op: 'setNoteStaff'; readonly note: string; readonly staff: StaffId }
  | { readonly op: 'addAttachment'; readonly attachment: Omit<Attachment, 'provenance'> }
  | { readonly op: 'removeAttachment'; readonly id: string }
  | { readonly op: 'addSpanner'; readonly spanner: Omit<Spanner, 'provenance'> }
  | { readonly op: 'removeSpanner'; readonly id: string }
  | { readonly op: 'setTuplet'; readonly tuplet: string; readonly side?: Tuplet['side']; readonly bracket?: Tuplet['bracket']; readonly number?: Tuplet['number'] }
  | { readonly op: 'setStem'; readonly event: string; readonly stem: 'up' | 'down' }
  | { readonly op: 'addLabels'; readonly target: string; readonly labels: Labels }
);

export class EditError extends Error {}

const edited = (edit: Edit) => ({ origin: 'edited' as const, rule: edit.reason });

export function applyEdits(score: Score, edits: readonly Edit[]): Score {
  let events = [...score.events];
  let attachments = [...score.attachments];
  let spanners = [...score.spanners];
  let tuplets = [...score.tuplets];

  const eventIndex = (id: string) => {
    const index = events.findIndex(event => event.id === id);
    if (index < 0) throw new EditError(`No event ${id}`);
    return index;
  };
  const noteLocation = (id: string) => {
    const index = events.findIndex(event => event.kind === 'chord' && event.notes.some(note => note.id === id));
    if (index < 0) throw new EditError(`No note ${id}`);
    return index;
  };
  const updateNote = (id: string, change: (note: Note) => Note) => {
    const index = noteLocation(id);
    const event = events[index] as ChordEvent;
    events[index] = { ...event, notes: event.notes.map(note => (note.id === id ? change(note) : note)) };
  };
  const exists = (id: string) => events.some(event => event.id === id || (event.kind === 'chord' && event.notes.some(note => note.id === id))) ||
    attachments.some(item => item.id === id) || spanners.some(item => item.id === id);

  edits.forEach((edit, position) => {
    const where = `Edit ${position + 1} (${edit.op})`;
    try {
      switch (edit.op) {
        case 'respell':
          updateNote(edit.note, note => ({ ...note, pitch: parsePitch(edit.pitch), provenance: edited(edit) }));
          break;
        case 'setNoteStaff':
          if (!score.staves.some(staff => staff.id === edit.staff)) throw new EditError(`No staff ${edit.staff}`);
          updateNote(edit.note, note => ({ ...note, staff: edit.staff, provenance: edited(edit) }));
          break;
        case 'addAttachment':
          if (!isNotation(edit.attachment.kind)) throw new EditError(`Unknown notation ${edit.attachment.kind}`);
          if (attachments.some(item => item.id === edit.attachment.id)) throw new EditError(`Attachment ${edit.attachment.id} already exists`);
          attachments.push({ ...edit.attachment, provenance: edited(edit) });
          break;
        case 'removeAttachment':
          if (!attachments.some(item => item.id === edit.id)) throw new EditError(`No attachment ${edit.id}`);
          attachments = attachments.filter(item => item.id !== edit.id);
          break;
        case 'addSpanner':
          if (!isNotation(edit.spanner.kind)) throw new EditError(`Unknown notation ${edit.spanner.kind}`);
          if (spanners.some(item => item.id === edit.spanner.id)) throw new EditError(`Spanner ${edit.spanner.id} already exists`);
          spanners.push({ ...edit.spanner, provenance: edited(edit) });
          break;
        case 'removeSpanner':
          if (!spanners.some(item => item.id === edit.id)) throw new EditError(`No spanner ${edit.id}`);
          spanners = spanners.filter(item => item.id !== edit.id);
          break;
        case 'setTuplet': {
          const index = tuplets.findIndex(item => item.id === edit.tuplet);
          if (index < 0) throw new EditError(`No tuplet ${edit.tuplet}`);
          const { side, bracket, number } = edit;
          tuplets[index] = { ...tuplets[index], ...(side ? { side } : {}), ...(bracket ? { bracket } : {}), ...(number ? { number } : {}), provenance: edited(edit) };
          break;
        }
        case 'setStem': {
          const index = eventIndex(edit.event);
          const event = events[index];
          if (event.kind !== 'chord') throw new EditError(`${edit.event} is not a chord`);
          events[index] = { ...event, stem: edit.stem, provenance: edited(edit) };
          break;
        }
        case 'addLabels': {
          if (!exists(edit.target)) throw new EditError(`No element ${edit.target}`);
          const merge = (labels: Labels | undefined): Labels => ({
            roles: [...new Set([...(labels?.roles ?? []), ...(edit.labels.roles ?? [])])],
            tags: [...new Set([...(labels?.tags ?? []), ...(edit.labels.tags ?? [])])]
          });
          events = events.map(event => {
            if (event.id === edit.target) return { ...event, labels: merge(event.labels) } as ScoreEvent;
            if (event.kind === 'chord' && event.notes.some(note => note.id === edit.target))
              return { ...event, notes: event.notes.map(note => (note.id === edit.target ? { ...note, labels: merge(note.labels) } : note)) };
            return event;
          });
          break;
        }
      }
    } catch (error) {
      throw new EditError(`${where}: ${(error as Error).message}. Reason given: ${edit.reason}`);
    }
  });
  return { ...score, events, attachments, spanners, tuplets };
}
