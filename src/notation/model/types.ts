/**
 * The score document: what is written, with no positions, pixels or media
 * time. Everything a layout or a playback needs is derived from it. Every
 * element has a stable ID so edits, timing maps and styles can refer to it.
 *
 * Time is exact: offsets and lengths are fractions of a whole note. A note's
 * written value (a dotted eighth, say) and its sounding length differ only by
 * the tuplets that enclose it.
 */
import type { Fraction } from '../core/fraction';
import type { KeySignature, Pitch } from '../core/pitch';
import type { NotationId } from '../catalogue/ids';

export type StaffId = string;

export type ClefKind = 'treble' | 'bass' | 'alto' | 'tenor' | 'treble-8vb' | 'treble-8va' | 'bass-8vb' | 'baritone-f';

export type DurationBase = 'breve' | 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th' | '128th';

export interface NoteValue {
  readonly base: DurationBase;
  /** Augmentation dots: 0, 1 or 2. */
  readonly dots: number;
}

export interface TimeSignature {
  readonly beats: number;
  readonly beatType: number;
  /** How it is drawn. The meter itself is always beats/beatType. */
  readonly symbol?: 'numeric' | 'common' | 'cut';
  /** Beat groups in beatType units, e.g. [2, 2, 3] for 7/8. Defaults from the meter. */
  readonly grouping?: readonly number[];
}

/** Where an element came from; drives the review view. */
export interface Provenance {
  readonly origin: 'imported' | 'inferred' | 'edited';
  /** The inference rule or edit that created it. */
  readonly rule?: string;
  /** 0–1, for inferred elements. */
  readonly confidence?: number;
}

/** Song-defined semantic labels. The engine gives them no meaning; styles select on them. */
export interface Labels {
  readonly roles?: readonly string[];
  readonly tags?: readonly string[];
}

interface Element {
  readonly id: string;
  readonly labels?: Labels;
  readonly provenance?: Provenance;
}

export interface StaffDef {
  readonly id: StaffId;
  readonly clef: ClefKind;
  readonly name?: string;
}

export interface StaffGroup {
  readonly kind: 'brace' | 'bracket';
  readonly staves: readonly StaffId[];
}

export type EndBarline = 'barline.single' | 'barline.double' | 'barline.final' | 'barline.dashed' | 'nav.repeat-end';

export interface Measure {
  /** Number shown in the score. A pickup is 0. */
  readonly number: number;
  /** Actual length when shorter than the meter (pickup, closing partial bar). */
  readonly length?: Fraction;
  /** A time signature that starts here. Required on the first measure. */
  readonly time?: TimeSignature;
  /** A key signature that starts here. Required on the first measure. */
  readonly key?: KeySignature;
  readonly repeatStart?: boolean;
  /** Barline closing the measure; single when absent. */
  readonly end?: EndBarline;
  /** A named section starting here, for styles and navigation. */
  readonly section?: string;
}

export interface Note extends Element {
  readonly pitch: Pitch;
  /** Draw on another staff of the same group (cross-staff). */
  readonly staff?: StaffId;
  /**
   * `auto` follows the accidental rule; `show` always draws one; `courtesy`
   * draws it in parentheses; `hide` never draws it.
   */
  readonly accidental?: 'auto' | 'show' | 'courtesy' | 'hide';
}

export interface Grace {
  readonly kind: 'acciaccatura' | 'appoggiatura';
  /** Before the main event (the usual case) or after the previous one. */
  readonly placement: 'before' | 'after';
}

interface EventBase extends Element {
  /** Index into `Score.measures`. */
  readonly measure: number;
  readonly staff: StaffId;
  /** 1-based. Voice 1 is the upper (stem-up) voice when there are several. */
  readonly voice: number;
  /** Sounding position from the start of the measure. Grace notes share their main event's offset. */
  readonly offset: Fraction;
  /** Innermost enclosing tuplet. */
  readonly tuplet?: string;
}

export interface ChordEvent extends EventBase {
  readonly kind: 'chord';
  /** Written value; the sounding length also depends on enclosing tuplets. */
  readonly value: NoteValue;
  readonly notes: readonly Note[];
  /** Drawn at cue size. */
  readonly cue?: boolean;
  /** A fixed stem direction; otherwise the stem rule decides. */
  readonly stem?: 'up' | 'down';
  /** Grace notes take no time; `graceOrder` orders several at one offset. */
  readonly grace?: Grace;
  readonly graceOrder?: number;
}

export interface RestEvent extends EventBase {
  readonly kind: 'rest';
  readonly value: NoteValue;
  /** A whole-bar rest, centred whatever the meter. */
  readonly fullBar?: boolean;
}

/** Time that passes in a voice without anything drawn. */
export interface SpaceEvent extends EventBase {
  readonly kind: 'space';
  /** Sounding length, not affected by tuplets. */
  readonly length: Fraction;
}

export type ScoreEvent = ChordEvent | RestEvent | SpaceEvent;

export interface Tuplet extends Element {
  /** Notes played (3 in a triplet). */
  readonly actual: number;
  /** In the time of (2 in a triplet). */
  readonly normal: number;
  readonly parent?: string;
  readonly number?: 'auto' | 'number' | 'ratio' | 'none';
  readonly bracket?: 'auto' | 'show' | 'hide';
  readonly side?: 'auto' | 'above' | 'below';
}

export interface ClefChange extends Element {
  readonly staff: StaffId;
  readonly measure: number;
  readonly offset: Fraction;
  readonly clef: ClefKind;
}

/** What an attachment or a spanner end hangs on. */
export type Anchor =
  | { readonly event: string }
  | { readonly note: string }
  | { readonly position: { readonly measure: number; readonly offset: Fraction; readonly staff?: StaffId } }
  | { readonly barline: { readonly measure: number; readonly side: 'start' | 'end' } };

export type MarkParams = Readonly<Record<string, string | number | boolean>>;

export interface Attachment extends Element {
  readonly kind: NotationId;
  readonly anchor: Anchor;
  /** Overrides the catalogue's side rule. */
  readonly side?: 'above' | 'below';
  readonly text?: string;
  readonly params?: MarkParams;
}

export interface Spanner extends Element {
  readonly kind: NotationId;
  readonly start: Anchor;
  readonly end: Anchor;
  readonly side?: 'above' | 'below';
  readonly text?: string;
  readonly params?: MarkParams;
}

export interface ScoreMeta {
  readonly title: string;
  readonly composer?: string;
  /** Free text: edition, transcription, arranger. */
  readonly source?: string;
}

export interface Score {
  readonly schema: 1;
  readonly meta: ScoreMeta;
  readonly staves: readonly StaffDef[];
  readonly groups: readonly StaffGroup[];
  readonly measures: readonly Measure[];
  readonly events: readonly ScoreEvent[];
  readonly tuplets: readonly Tuplet[];
  readonly clefs: readonly ClefChange[];
  readonly attachments: readonly Attachment[];
  readonly spanners: readonly Spanner[];
}
