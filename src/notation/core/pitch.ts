/**
 * Spelled pitch: a letter, an alteration and an octave. Two spellings of the
 * same key on the piano (B♯3 and C4) are different pitches here, because they
 * are written differently. Octaves follow scientific pitch notation (C4 is
 * middle C) and belong to the letter, so B♯3 sounds as MIDI 60.
 */
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
/** Position of each natural step on the line of fifths, with C at 0. */
const STEP_FIFTHS = [0, 2, 4, -1, 1, 3, 5];

export interface Pitch {
  readonly step: Step;
  /** −2 double flat … +2 double sharp. */
  readonly alter: number;
  readonly octave: number;
}

export function pitch(step: Step, alter: number, octave: number): Pitch {
  if (!STEPS.includes(step)) throw new RangeError(`Unknown step ${step}`);
  if (!Number.isInteger(alter) || Math.abs(alter) > 2) throw new RangeError(`Unsupported alteration ${alter}`);
  return Object.freeze({ step, alter, octave });
}

export const stepIndex = (step: Step): number => STEPS.indexOf(step);

export function midi(p: Pitch): number {
  return 12 * (p.octave + 1) + STEP_SEMITONES[stepIndex(p.step)] + p.alter;
}

/** Diatonic steps above C0; one per staff line or space. */
export function diatonic(p: Pitch): number {
  return p.octave * 7 + stepIndex(p.step);
}

/** Position on the line of fifths (C = 0, G = 1, F = −1, F♯ = 6, B♭ = −2). */
export function fifths(p: Pitch): number {
  return STEP_FIFTHS[stepIndex(p.step)] + 7 * p.alter;
}

export function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

/** Every spelling of a MIDI note number with at most a double accidental, simplest first. */
export function spellings(midiNumber: number): Pitch[] {
  const result: Pitch[] = [];
  for (const alter of [0, 1, -1, 2, -2]) {
    const natural = midiNumber - alter;
    const pitchClass = ((natural % 12) + 12) % 12;
    const index = STEP_SEMITONES.indexOf(pitchClass);
    if (index < 0) continue;
    result.push(pitch(STEPS[index], alter, Math.floor(natural / 12) - 1));
  }
  return result;
}

const ACCIDENTAL_TEXT: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' };

export function formatPitch(p: Pitch): string {
  return `${p.step}${ACCIDENTAL_TEXT[p.alter]}${p.octave}`;
}

/** Parses "C4", "F#5", "Bb3", "G##2", "Ebb4" (also "x" for a double sharp). */
export function parsePitch(text: string): Pitch {
  const match = /^([A-Ga-g])(##|x|#|bb|b|n)?(-?\d+)$/.exec(text.trim());
  if (!match) throw new SyntaxError(`Not a pitch: "${text}"`);
  const alter = { '##': 2, x: 2, '#': 1, bb: -2, b: -1, n: 0 }[match[2] ?? 'n'] ?? 0;
  return pitch(match[1].toUpperCase() as Step, alter, Number(match[3]));
}

/** Key signature as a count of fifths: +4 is four sharps, −3 three flats. */
export interface KeySignature {
  readonly fifths: number;
  readonly mode: 'major' | 'minor';
}

export const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** The alteration the key signature gives a step. */
export function keyAlteration(key: KeySignature, step: Step): number {
  if (key.fifths > 0) return SHARP_ORDER.indexOf(step) < key.fifths ? 1 : 0;
  if (key.fifths < 0) return FLAT_ORDER.indexOf(step) < -key.fifths ? -1 : 0;
  return 0;
}

/** The steps a key signature alters, in the order they are written. */
export function keySteps(key: KeySignature): Step[] {
  return key.fifths >= 0 ? SHARP_ORDER.slice(0, key.fifths) : FLAT_ORDER.slice(0, -key.fifths);
}

const MAJOR_TONICS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR_TONICS = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];

export function keyName(key: KeySignature): string {
  const tonic = (key.mode === 'major' ? MAJOR_TONICS : MINOR_TONICS)[key.fifths + 7];
  return `${tonic} ${key.mode}`;
}
