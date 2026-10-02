/**
 * Read access to a score: lookups by ID, the signature and clef in force at
 * any point, and the exact sounding length of every event. Built once per
 * score; the score itself stays plain data.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import type { KeySignature } from '../core/pitch';
import { durationOf, meterLength } from './time';
import type {
  Anchor, Attachment, ChordEvent, ClefKind, Note, Score, ScoreEvent, Spanner, StaffGroup, StaffId, TimeSignature, Tuplet
} from './types';

export interface NoteRef {
  readonly note: Note;
  readonly event: ChordEvent;
}

export class ScoreIndex {
  readonly measureStarts: readonly Fraction[];
  private readonly times: TimeSignature[] = [];
  private readonly keys: KeySignature[] = [];
  private readonly events = new Map<string, ScoreEvent>();
  private readonly notes = new Map<string, NoteRef>();
  private readonly tuplets = new Map<string, Tuplet>();
  private readonly byMeasure = new Map<string, ScoreEvent[]>();
  private readonly attachmentsByTarget = new Map<string, Attachment[]>();

  constructor(readonly score: Score) {
    let time = score.measures[0]?.time;
    let key = score.measures[0]?.key;
    if (!time || !key) throw new Error('The first measure needs a time and a key signature');
    const starts: Fraction[] = [];
    let start = F.ZERO;
    for (const measure of score.measures) {
      time = measure.time ?? time;
      key = measure.key ?? key;
      this.times.push(time!);
      this.keys.push(key!);
      starts.push(start);
      start = F.add(start, measure.length ?? meterLength(time!));
    }
    starts.push(start);
    this.measureStarts = starts;
    for (const tuplet of score.tuplets) this.tuplets.set(tuplet.id, tuplet);
    for (const event of score.events) {
      this.events.set(event.id, event);
      if (event.kind === 'chord') for (const note of event.notes) this.notes.set(note.id, { note, event });
      const bucket = `${event.measure}`;
      (this.byMeasure.get(bucket) ?? this.byMeasure.set(bucket, []).get(bucket)!).push(event);
    }
    for (const list of this.byMeasure.values()) list.sort(eventOrder);
    for (const attachment of score.attachments) {
      const target = anchorTarget(attachment.anchor);
      (this.attachmentsByTarget.get(target) ?? this.attachmentsByTarget.set(target, []).get(target)!).push(attachment);
    }
  }

  get measureCount(): number {
    return this.score.measures.length;
  }

  timeAt(measure: number): TimeSignature {
    return this.times[measure];
  }

  keyAt(measure: number): KeySignature {
    return this.keys[measure];
  }

  measureLength(measure: number): Fraction {
    return F.sub(this.measureStarts[measure + 1], this.measureStarts[measure]);
  }

  /** Position from the start of the score, in whole notes. */
  absolute(measure: number, offset: Fraction): Fraction {
    return F.add(this.measureStarts[measure], offset);
  }

  event(id: string): ScoreEvent {
    const found = this.events.get(id);
    if (!found) throw new Error(`No event ${id}`);
    return found;
  }

  note(id: string): NoteRef {
    const found = this.notes.get(id);
    if (!found) throw new Error(`No note ${id}`);
    return found;
  }

  hasEvent(id: string): boolean {
    return this.events.has(id);
  }

  tuplet(id: string): Tuplet {
    const found = this.tuplets.get(id);
    if (!found) throw new Error(`No tuplet ${id}`);
    return found;
  }

  /** Enclosing tuplets of an event, outermost first. */
  tupletChain(event: ScoreEvent): Tuplet[] {
    const chain: Tuplet[] = [];
    for (let id = event.tuplet; id; id = this.tuplet(id).parent) chain.unshift(this.tuplet(id));
    return chain;
  }

  /** The factor tuplets apply to written lengths (2/3 inside a triplet). */
  timeFactor(event: ScoreEvent): Fraction {
    return this.tupletChain(event).reduce((factor, tuplet) => F.mul(factor, F.frac(tuplet.normal, tuplet.actual)), F.ONE);
  }

  /** Sounding length in whole notes; zero for grace notes. */
  length(event: ScoreEvent): Fraction {
    if (event.kind === 'space') return event.length;
    if (event.kind === 'rest' && event.fullBar) return this.measureLength(event.measure);
    if (event.kind === 'chord' && event.grace) return F.ZERO;
    return F.mul(durationOf(event.value), this.timeFactor(event));
  }

  end(event: ScoreEvent): Fraction {
    return F.add(event.offset, this.length(event));
  }

  /** Events of a measure in time order; grace notes come before their main event. */
  eventsIn(measure: number, staff?: StaffId, voice?: number): ScoreEvent[] {
    const all = this.byMeasure.get(`${measure}`) ?? [];
    return all.filter(event => (staff === undefined || event.staff === staff) && (voice === undefined || event.voice === voice));
  }

  voicesIn(measure: number, staff: StaffId): number[] {
    return [...new Set(this.eventsIn(measure, staff).map(event => event.voice))].sort((a, b) => a - b);
  }

  /** Voices of a staff that draw anything in a measure. */
  drawnVoices(measure: number, staff: StaffId): number[] {
    return [...new Set(this.eventsIn(measure, staff).filter(event => event.kind !== 'space').map(event => event.voice))]
      .sort((a, b) => a - b);
  }

  /** The clef in force for a staff at a point, including a change at exactly that point. */
  clefAt(staff: StaffId, measure: number, offset: Fraction): ClefKind {
    let clef = this.staff(staff).clef;
    for (const change of this.score.clefs) {
      if (change.staff !== staff) continue;
      if (change.measure < measure || (change.measure === measure && F.le(change.offset, offset))) clef = change.clef;
    }
    return clef;
  }

  staff(id: StaffId) {
    const found = this.score.staves.find(staff => staff.id === id);
    if (!found) throw new Error(`No staff ${id}`);
    return found;
  }

  staffIndex(id: StaffId): number {
    return this.score.staves.findIndex(staff => staff.id === id);
  }

  groupOf(staff: StaffId): StaffGroup | undefined {
    return this.score.groups.find(group => group.staves.includes(staff));
  }

  /** Attachments hanging on an event, note or barline. */
  attachmentsOn(target: string): Attachment[] {
    return this.attachmentsByTarget.get(target) ?? [];
  }

  spanners(kind?: string): Spanner[] {
    return kind ? this.score.spanners.filter(spanner => spanner.kind === kind) : [...this.score.spanners];
  }
}

/** A key identifying what an anchor hangs on. */
export function anchorTarget(anchor: Anchor): string {
  if ('event' in anchor) return anchor.event;
  if ('note' in anchor) return anchor.note;
  if ('barline' in anchor) return `barline:${anchor.barline.measure}:${anchor.barline.side}`;
  return `position:${anchor.position.measure}:${F.key(anchor.position.offset)}:${anchor.position.staff ?? ''}`;
}

/** Time order; at one offset grace notes before main events, in their written order. */
export function eventOrder(a: ScoreEvent, b: ScoreEvent): number {
  return a.measure - b.measure || F.compare(a.offset, b.offset) || graceRank(a) - graceRank(b);
}

function graceRank(event: ScoreEvent): number {
  if (event.kind !== 'chord' || !event.grace) return 0;
  return event.grace.placement === 'before' ? -100 + (event.graceOrder ?? 0) : 100 + (event.graceOrder ?? 0);
}
