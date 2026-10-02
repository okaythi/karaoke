/**
 * Colours and opacity for every drawn item, docs §9.
 *
 * A style sheet is a list of rules. Each rule selects items by any mix of
 * notation kind, staff, voice, role, tag, measure range, section or score ID,
 * optionally for one playback state, and sets their colours. Sheets cascade:
 * engine defaults, then the song's sheet, then the viewer's. Within the
 * cascade a more specific selector wins, and among equals the later rule.
 *
 * No colour is ever written in engine code: defaults name Theater tokens.
 */
import type { DisplayItem } from '../layout/display';

export type PlaybackState = 'idle' | 'upcoming' | 'active' | 'played';

export type OneOrMany<T> = T | readonly T[];

export interface Selector {
  /** A catalogue ID ('artic.staccato') or a family with a wildcard ('dyn.*'). */
  readonly kind?: OneOrMany<string>;
  readonly staff?: OneOrMany<string>;
  readonly voice?: OneOrMany<number>;
  readonly role?: OneOrMany<string>;
  readonly tag?: OneOrMany<string>;
  /** Inclusive range of measure numbers as printed. */
  readonly measures?: readonly [number, number];
  readonly section?: OneOrMany<string>;
  /** Score IDs (notes, events, spanners). */
  readonly ref?: OneOrMany<string>;
  /** Only for items in this playback state. */
  readonly state?: PlaybackState;
}

export interface Gradient { readonly from: string; readonly to: string }

export interface StyleProps {
  /** Resting colour. */
  readonly ink?: string;
  /** Colour that fills a note while it glides. */
  readonly glide?: string | Gradient;
  /** Colour after the note has sounded. */
  readonly played?: string;
  /** Colour shortly before the note sounds. */
  readonly upcoming?: string;
  readonly opacity?: number;
}

export interface StyleRule {
  readonly select: Selector;
  readonly set: StyleProps;
}

export interface StyleSheet {
  /** Named colours the rules may use, e.g. { rose: '#de8adc' }. */
  readonly palette?: Readonly<Record<string, string>>;
  readonly rules: readonly StyleRule[];
}

export interface ResolvedStyle {
  readonly ink: string;
  readonly glide: string | Gradient;
  readonly played: string;
  readonly upcoming: string;
  readonly opacity: number;
}

/** Facts about the score a selector may need beyond the item itself. */
export interface StyleScope {
  /** Printed number of a measure index. */
  measureNumber(measure: number): number;
  /** Section a measure index belongs to. */
  sectionOf(measure: number): string | undefined;
}

/** The engine's own sheet: Theater tokens only. */
export const DEFAULT_SHEET: StyleSheet = {
  palette: {
    'theater-text': 'var(--theater-text)',
    'theater-text-muted': 'var(--theater-text-muted)',
    'theater-text-dim': 'var(--theater-text-dim)',
    'accent-brass': 'var(--accent-brass)',
    'accent-brass-hover': 'var(--accent-brass-hover)'
  },
  // Noteheads and signs in the muted text tone; lines, stems and beams a step dimmer.
  rules: [
    { select: {}, set: { ink: 'theater-text-muted', glide: 'accent-brass', opacity: 1 } },
    { select: { kind: ['staff.lines', 'staff.ledger', 'staff.system-line', 'barline.*', 'staff.brace', 'staff.bracket', 'note.stem', 'note.beam', 'note.flag'] },
      set: { ink: 'theater-text-dim' } }
  ]
};

const list = <T>(value: OneOrMany<T> | undefined): readonly T[] | undefined =>
  value === undefined ? undefined : (Array.isArray(value) ? value : [value as T]);

function kindMatches(patterns: readonly string[], element: string): boolean {
  return patterns.some(pattern => pattern === element || (pattern.endsWith('.*') && element.startsWith(pattern.slice(0, -1))) || pattern === '*');
}

/** How specific a selector is: one point per field, a hundred for exact IDs. */
export function specificity(selector: Selector): number {
  let points = 0;
  for (const key of ['kind', 'staff', 'voice', 'role', 'tag', 'measures', 'section', 'state'] as const) if (selector[key] !== undefined) points++;
  if (selector.ref !== undefined) points += 100;
  return points;
}

export function matches(selector: Selector, item: DisplayItem, scope: StyleScope, state?: PlaybackState): boolean {
  if (selector.state !== undefined && selector.state !== state) return false;
  const kinds = list(selector.kind);
  if (kinds && !kindMatches(kinds, item.element)) return false;
  const { semantic } = item;
  const staves = list(selector.staff);
  if (staves && (!semantic.staff || !staves.includes(semantic.staff))) return false;
  const voices = list(selector.voice);
  if (voices && (semantic.voice === undefined || !voices.includes(semantic.voice))) return false;
  const roles = list(selector.role);
  if (roles && !roles.some(role => semantic.roles?.includes(role))) return false;
  const tags = list(selector.tag);
  if (tags && !tags.some(tag => semantic.tags?.includes(tag))) return false;
  if (selector.measures) {
    if (semantic.measure === undefined) return false;
    const number = scope.measureNumber(semantic.measure);
    if (number < selector.measures[0] || number > selector.measures[1]) return false;
  }
  const sections = list(selector.section);
  if (sections && (semantic.measure === undefined || !sections.includes(scope.sectionOf(semantic.measure) ?? ''))) return false;
  const refs = list(selector.ref);
  if (refs && !refs.some(ref => item.refs.includes(ref))) return false;
  return true;
}

export class StyleResolver {
  private readonly palette: Record<string, string>;
  private readonly rules: { rule: StyleRule; layer: number; order: number; weight: number }[];

  /** Sheets from lowest to highest precedence (defaults first). */
  constructor(sheets: readonly StyleSheet[], private readonly scope: StyleScope) {
    this.palette = Object.assign({}, ...sheets.map(sheet => sheet.palette ?? {}));
    let order = 0;
    this.rules = sheets.flatMap((sheet, layer) => sheet.rules.map(rule => ({ rule, layer, order: order++, weight: specificity(rule.select) })));
    // Lowest precedence first, so later assignments win.
    this.rules.sort((a, b) => a.layer - b.layer || a.weight - b.weight || a.order - b.order);
  }

  colour(value: string): string {
    return this.palette[value] ?? value;
  }

  private props(item: DisplayItem, state?: PlaybackState): StyleProps {
    const result: { -readonly [K in keyof StyleProps]: StyleProps[K] } = {};
    for (const { rule } of this.rules) if (matches(rule.select, item, this.scope, state)) Object.assign(result, rule.set);
    return result;
  }

  resolve(item: DisplayItem): ResolvedStyle {
    const base = this.props(item);
    const ink = this.colour(base.ink ?? 'currentColor');
    const glide = this.props(item, 'active').glide ?? base.glide ?? 'accent-brass';
    // A state's colour is its own property, else the ink a rule for that state sets, else the resting ink.
    const inState = (state: 'played' | 'upcoming') => {
      const props = this.props(item, state);
      return this.colour(props[state] ?? props.ink ?? ink);
    };
    return {
      ink,
      glide: typeof glide === 'string' ? this.colour(glide) : { from: this.colour(glide.from), to: this.colour(glide.to) },
      played: inState('played'),
      upcoming: inState('upcoming'),
      opacity: base.opacity ?? 1
    };
  }
}

/** Relative luminance of a #rgb or #rrggbb colour (WCAG). */
function luminance(hex: string): number | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const digits = match[1].length === 3 ? match[1].split('').map(d => d + d).join('') : match[1];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number | undefined {
  const la = luminance(a), lb = luminance(b);
  if (la === undefined || lb === undefined) return undefined;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Rules whose literal colours fall below 3:1 against the background (non-text contrast). */
export function contrastWarnings(sheet: StyleSheet, background: string): string[] {
  const warnings: string[] = [];
  const colour = (value: string) => sheet.palette?.[value] ?? value;
  sheet.rules.forEach((rule, position) => {
    for (const [name, raw] of Object.entries(rule.set)) {
      if (name === 'opacity' || raw === undefined) continue;
      const values = typeof raw === 'object' ? [raw.from, raw.to] : [String(raw)];
      for (const value of values) {
        const ratio = contrast(colour(value), background);
        if (ratio !== undefined && ratio < 3) warnings.push(`Rule ${position + 1} sets ${name} to ${value}: contrast ${ratio.toFixed(2)}:1 against ${background}`);
      }
    }
  });
  return warnings;
}
