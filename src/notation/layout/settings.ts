/**
 * Engraving constants and layout settings, in staff spaces.
 *
 * `ENGRAVING` holds the line thicknesses and distances of the music font
 * (Bravura's published engraving defaults) and the conventions of plate
 * engraving that every song shares. `LayoutSettings` holds the choices a song
 * may change; `DEFAULT_SETTINGS` are the engine's defaults.
 */
import type { SizeClass } from '../catalogue/types';
import type { CourtesyPolicy } from '../rules/accidentals';
import type { StemDirection } from '../rules/stems';

export const ENGRAVING = {
  staffLineThickness: 0.13,
  stemThickness: 0.12,
  beamThickness: 0.5,
  beamSpacing: 0.25,
  legerLineThickness: 0.16,
  legerLineExtension: 0.4,
  thinBarlineThickness: 0.16,
  thickBarlineThickness: 0.5,
  barlineSeparation: 0.4,
  thinThickBarlineSeparation: 0.4,
  repeatBarlineDotSeparation: 0.16,
  dashedBarlineDashLength: 0.5,
  dashedBarlineGapLength: 0.25,
  slurEndpointThickness: 0.1,
  slurMidpointThickness: 0.22,
  tieEndpointThickness: 0.1,
  tieMidpointThickness: 0.22,
  hairpinThickness: 0.16,
  octaveLineThickness: 0.16,
  pedalLineThickness: 0.16,
  repeatEndingLineThickness: 0.16,
  tupletBracketThickness: 0.16,
  textEnclosureThickness: 0.16,
  /** Normal stem length from the notehead centre. */
  stemLength: 3.5,
  /** Shortest a beamed stem may be from the notehead to its primary beam. */
  minBeamedStem: 2.75,
  /** Largest rise or fall of a beam over its group. */
  maxBeamSlant: 1,
  /** Gap between a notehead and its accidental. */
  accidentalGap: 0.2,
  /** Gap between accidental columns. */
  accidentalColumnGap: 0.1,
  dotGap: 0.25,
  dotSpacing: 0.5,
  /** Room between a mark and what it clears. */
  markPadding: 0.4,
  /** Ledger lines sit outside the staff; a mark keeps this far from the staff lines. */
  staffClearance: 0.5
} as const;

export const SIZE_SCALE: Record<SizeClass, number> = { full: 1, change: 0.75, cue: 0.75, grace: 0.6, 'small-text': 0.7 };

export interface SpacingSettings {
  /** Space given to the shortest duration in the score. */
  readonly shortestSpace: number;
  /** How much more space each doubling of duration gets, as a fraction of `shortestSpace`. */
  readonly doublingIncrement: number;
  /** Least gap between the ink of neighbouring columns. */
  readonly minimumGap: number;
  /** Space after a grace note. */
  readonly graceGap: number;
  /** Space after the barline before the first event. */
  readonly afterBarline: number;
  /** Space after the last event before the barline. */
  readonly beforeBarline: number;
  /** Space after a clef, key or time signature. */
  readonly afterSignature: number;
  /** How far a line may tighten below ideal spacing to fit another measure (1: never). */
  readonly compression: number;
}

export interface LayoutSettings {
  readonly spacing: SpacingSettings;
  /** Distance between the bottom line of one staff and the top line of the next, within a group. */
  readonly staffGap: number;
  /** Most the gap may grow to fit what lies between the staves. */
  readonly maxStaffGap: number;
  /** Distance between staves of different groups. */
  readonly groupGap: number;
  /** Indent of the first system (room for nothing yet; kept for instrument names). */
  readonly firstIndent: number;
  readonly balancedStem: StemDirection;
  readonly keyCancellation: 'traditional' | 'modern';
  readonly courtesyAccidentals: CourtesyPolicy;
  readonly beamOverRests: boolean;
  readonly pedalStyle: 'text' | 'bracket';
  /** A last line no fuller than this fraction of the width is left unjustified. */
  readonly raggedLastLine: number;
}

export const DEFAULT_SETTINGS: LayoutSettings = {
  spacing: {
    shortestSpace: 2.8,
    doublingIncrement: 0.55,
    minimumGap: 0.5,
    graceGap: 0.35,
    afterBarline: 1.2,
    beforeBarline: 1.0,
    afterSignature: 1.4,
    compression: 0.7
  },
  staffGap: 7,
  maxStaffGap: 14,
  groupGap: 9,
  firstIndent: 0,
  balancedStem: 'down',
  keyCancellation: 'traditional',
  courtesyAccidentals: 'none',
  beamOverRests: false,
  pedalStyle: 'text',
  raggedLastLine: 0.6
};

export function withSettings(overrides: Partial<LayoutSettings> = {}): LayoutSettings {
  return { ...DEFAULT_SETTINGS, ...overrides, spacing: { ...DEFAULT_SETTINGS.spacing, ...overrides.spacing } };
}
