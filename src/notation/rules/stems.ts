/**
 * Stem direction, docs §6.3.
 *
 * With several voices on a staff, odd voices point up and even voices down.
 * Otherwise the note farthest from the middle line decides, across a whole
 * beam group: above the middle line the stem points down, below it up, and
 * an even balance points down (unless the song prefers otherwise).
 */
export type StemDirection = 'up' | 'down';

export interface StemContext {
  /** Several voices draw on the staff in this measure. */
  readonly multiVoice: boolean;
  readonly voice: number;
  /** Direction when the farthest notes above and below are equally far. */
  readonly balanced?: StemDirection;
}

/**
 * `heights` are each note's distance from the middle line in steps, positive
 * above it, for every note that shares the stem or beam.
 */
export function stemDirection(heights: readonly number[], context: StemContext): StemDirection {
  if (context.multiVoice) return context.voice % 2 === 1 ? 'up' : 'down';
  const highest = Math.max(...heights), lowest = Math.min(...heights);
  const above = Math.max(0, highest), below = Math.max(0, -lowest);
  if (above > below) return 'down';
  if (below > above) return 'up';
  return context.balanced ?? 'down';
}
