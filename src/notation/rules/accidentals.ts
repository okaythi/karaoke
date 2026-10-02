/**
 * The accidental rule, docs §6.2: which notes show an accidental.
 *
 * An accidental holds for the same letter and octave on the same staff until
 * the barline. The key signature applies everywhere it is not overridden. A
 * note tied over a barline needs none, and does not carry its alteration
 * into the new bar. Grace notes show what they need but do not change what
 * later full-size notes need.
 */
import { keyAlteration } from '../core/pitch';
import type { Pitch } from '../core/pitch';
import type { ScoreIndex } from '../model/query';
import type { ChordEvent, StaffId } from '../model/types';

export type CourtesyPolicy = 'none' | 'after-barline-tie' | 'next-bar';

export interface AccidentalSettings {
  /** When to add parenthesised reminders on top of explicit `courtesy` notes. */
  readonly courtesy: CourtesyPolicy;
}

export interface ShownAccidental {
  readonly alter: number;
  readonly courtesy: boolean;
}

const GLYPHS: Record<number, string> = {
  [-2]: 'accidentalDoubleFlat', [-1]: 'accidentalFlat', 0: 'accidentalNatural', 1: 'accidentalSharp', 2: 'accidentalDoubleSharp'
};

export function accidentalGlyph(alter: number): string {
  return GLYPHS[alter];
}

/**
 * Decides the accidental of every note in the score. `writtenPitch` gives a
 * note's written pitch (ottavas change the octave) and `drawnStaff` the staff
 * it appears on (cross-staff notes follow that staff's accidentals).
 */
export function resolveAccidentals(
  index: ScoreIndex,
  writtenPitch: (noteId: string) => Pitch,
  drawnStaff: (event: ChordEvent, noteId: string) => StaffId,
  settings: AccidentalSettings = { courtesy: 'none' }
): Map<string, ShownAccidental> {
  const shown = new Map<string, ShownAccidental>();
  const tiedInto = new Set(index.spanners('tie').map(spanner => ('note' in spanner.end ? spanner.end.note : '')));
  // Alterations shown in the previous bar, for the next-bar courtesy policy.
  let previousBar = new Map<string, number>();

  for (let measure = 0; measure < index.measureCount; measure++) {
    const key = index.keyAt(measure);
    const state = new Map<string, number>();
    const thisBar = new Map<string, number>();
    const at = (staff: StaffId, pitch: Pitch) => `${staff}:${pitch.step}${pitch.octave}`;
    for (const event of index.eventsIn(measure)) {
      if (event.kind !== 'chord') continue;
      const isGrace = !!event.grace;
      for (const note of event.notes) {
        const pitch = writtenPitch(note.id);
        const staff = drawnStaff(event, note.id);
        const position = at(staff, pitch);
        const current = state.get(position) ?? keyAlteration(key, pitch.step);
        if (tiedInto.has(note.id) && !isGrace) {
          if (settings.courtesy === 'after-barline-tie' && measure > 0 && pitch.alter !== keyAlteration(key, pitch.step) && !state.has(position))
            shown.set(note.id, { alter: pitch.alter, courtesy: true });
          continue;
        }
        const needed = current !== pitch.alter;
        if (note.accidental === 'hide') { /* never drawn */ }
        else if (note.accidental === 'show' || needed) shown.set(note.id, { alter: pitch.alter, courtesy: false });
        else if (note.accidental === 'courtesy') shown.set(note.id, { alter: pitch.alter, courtesy: true });
        else if (settings.courtesy === 'next-bar' && previousBar.has(position) && previousBar.get(position) !== pitch.alter)
          shown.set(note.id, { alter: pitch.alter, courtesy: true });
        if (!isGrace) {
          state.set(position, pitch.alter);
          if (needed || note.accidental === 'show') thisBar.set(position, pitch.alter);
        }
      }
    }
    previousBar = thisBar;
  }
  return shown;
}
