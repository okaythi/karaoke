/**
 * The shape of a catalogue entry. An entry is data: it says what a notation
 * is, how the model expresses it, how it is drawn and where it goes. Layout
 * and render read these fields, so most entries need no code of their own:
 * one glyph placer handles every articulation, one line placer every hairpin,
 * ottava and pedal bracket. Only `structure` entries (noteheads, beams,
 * barlines, …) are drawn by dedicated engine code.
 *
 * See docs/09-notation-engine.md §4–5 for the behaviour each field encodes.
 */

export type Family =
  | 'staff' | 'barline' | 'clef' | 'key' | 'time' | 'note' | 'grace' | 'cue' | 'rest' | 'acc' | 'tuplet'
  | 'tie' | 'slur' | 'gliss' | 'artic' | 'orn' | 'arp' | 'dyn' | 'pedal' | 'ottava' | 'tempo' | 'expr'
  | 'nav' | 'finger';

/** Size classes, docs §4.2. */
export type SizeClass = 'full' | 'change' | 'cue' | 'grace' | 'small-text';

/** Vertical layers outward from the notehead, docs §4.1. */
export type Layer = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Marks that line up across a whole line of music, docs §4.3. */
export type Baseline = 'dynamics' | 'pedal' | 'tempo' | 'ottava';

/**
 * Which side of the staff a mark goes on.
 * - `notehead`: opposite the stem; with several voices, the voice's own side.
 * - `voice`: above for a single voice and voice 1, below for voice 2.
 * - `above` / `below`: always that side of the staff it belongs to.
 * - `between-staves`: between the staves of a brace group (piano dynamics), else below.
 * - `outer`: above the upper staff of a group, below the lower one (fingering).
 * - `system`: above the top staff of the system.
 * - `through`: drawn across the staff (caesura).
 */
export type SideRule = 'notehead' | 'voice' | 'above' | 'below' | 'between-staves' | 'outer' | 'system' | 'through';

/** Horizontal alignment of a mark. */
export type Align =
  | 'event'          // centred on the notehead column (on the stem when on the stem side)
  | 'stem'           // across the stem, between notehead and stem end (tremolo strokes)
  | 'event-left'     // starts at the left edge of the event
  | 'after'          // between the event and the next one
  | 'event-right'    // just right of the event (breath mark)
  | 'barline'        // centred on a barline
  | 'before-barline' // ending at a barline (D.C. al Fine)
  | 'measure'        // centred in the measure
  | 'measure-start'; // at the first event of the measure

export type TextStyle = 'tempo' | 'expression' | 'technique' | 'navigation' | 'rehearsal' | 'small';

export type AnchorKind = 'event' | 'note' | 'position' | 'barline' | 'measure';

export type Drawing =
  /** Drawn by dedicated engine code from the score structure. */
  | { readonly type: 'structure'; readonly glyphs?: readonly string[] }
  /**
   * One SMuFL glyph; `below` is the form used when placed below. `variants`
   * picks another glyph by the value of a parameter (fermata length, finger
   * number, tremolo strokes). `inside` lets it sit in a staff space.
   */
  | {
      readonly type: 'glyph'; readonly above: string; readonly below?: string; readonly align: Align; readonly inside?: boolean;
      readonly variants?: { readonly param: string; readonly above: Readonly<Record<string, string>>; readonly below?: Readonly<Record<string, string>> };
    }
  /** Words. `content` names a composed text (`metronome`); otherwise the attachment's text or `default`. */
  | { readonly type: 'text'; readonly style: TextStyle; readonly align: Align; readonly default?: string;
      readonly enclosure?: 'box'; readonly content?: 'metronome' }
  /** A spanner drawn as a line between two decorations. */
  | {
      readonly type: 'line';
      readonly line: 'solid' | 'dashed' | 'wiggle' | 'hairpin-open' | 'hairpin-close' | 'none';
      readonly start?: Decoration;
      readonly end?: Decoration;
      /** Drawn at the start of a continuation after a line break. */
      readonly continuation?: Decoration;
      /** The spanner's text, set inside the start of the line (volta numbers). */
      readonly label?: TextStyle;
      /** Where a span that ends on release stops: just after the last notehead, or at the end of its duration. */
      readonly extent?: 'notehead' | 'duration';
    }
  /** A tie or slur curve. */
  | { readonly type: 'curve'; readonly curve: 'tie' | 'slur' | 'phrasing' | 'laissez-vibrer' }
  /** A vertical sign beside a chord (arpeggio). */
  | { readonly type: 'vertical'; readonly segment: string; readonly cap?: { readonly up?: string; readonly down?: string }; readonly bracket?: boolean };

export type Decoration =
  | { readonly kind: 'hook'; readonly toward: 'staff' | 'away' }
  | { readonly kind: 'glyph'; readonly glyph: string; readonly below?: string; readonly parenthesize?: boolean }
  | { readonly kind: 'text'; readonly style: TextStyle; readonly default?: string; readonly parenthesize?: boolean }
  | { readonly kind: 'notch' };

export type PlaybackEffect =
  | 'none'
  | 'grace'                    // takes no written time; own audio times when aligned
  | 'extend-to-next-attack'    // fermata, caesura, breath mark
  | 'roll'                     // arpeggio
  | 'linked-performance'       // trills, tremolos: many performed notes, one written note
  | 'navigation'               // repeats and jumps change the performance order
  | 'sustain'                  // pedal keeps notes sounding
  | 'tie';                     // merges notes into one sounding note

export interface Example {
  readonly title?: string;
  /** Score shorthand, see src/notation/shorthand. */
  readonly score: string;
  /** Line width in staff spaces, to show line-break behaviour. */
  readonly width?: number;
}

interface EntryBase {
  readonly id: string;
  readonly family: Family;
  readonly name: string;
  /** Other names people use for it ("vertical wavy line"). */
  readonly aliases?: readonly string[];
  readonly summary: string;
  /** Section of docs/09-notation-engine.md with its full behaviour. */
  readonly spec: string;
  readonly drawing: Drawing;
  readonly layer: Layer;
  readonly sizes: readonly SizeClass[];
  readonly side?: SideRule;
  readonly baseline?: Baseline;
  readonly playback: PlaybackEffect;
  /** A behaviour from the spec that the engine does not do yet; shown in the gallery. */
  readonly pending?: string;
  /** Which import pass may create it; absent when it only comes from sources or edits. */
  readonly inference?: string;
  readonly examples: readonly Example[];
}

export interface StructureEntry extends EntryBase {
  readonly model: 'structure';
}

export interface AttachmentEntry extends EntryBase {
  readonly model: 'attachment';
  readonly anchor: AnchorKind;
}

export interface SpannerEntry extends EntryBase {
  readonly model: 'spanner';
  readonly anchor: AnchorKind;
  /** Whether a span ends where its end event starts (a pedal release) or where it stops sounding (a hairpin). */
  readonly endsAt: 'onset' | 'release';
  /** Octaves the written notes under the span sit from the sounding ones (−1 under 8va). */
  readonly writtenOctaves?: number;
}

export type CatalogueEntry = StructureEntry | AttachmentEntry | SpannerEntry;
