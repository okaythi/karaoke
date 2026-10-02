/**
 * Moves rendered notes through their playback states, docs §10:
 * idle → upcoming → active (the glide fills the notehead over its written
 * value) → held lit while the sound lasts (pedal included) → played.
 * Only changed nodes are touched, so a frame costs little.
 */
import type { GlideTarget } from '../render/svg';
import type { TimingMap } from './timing';

export type NoteState = 'idle' | 'upcoming' | 'active' | 'played';

export interface GlideOptions {
  /** Seconds before a note sounds when it starts looking upcoming. */
  readonly lookahead?: number;
}

interface Tracked {
  readonly target: GlideTarget;
  readonly start: number;
  readonly glideEnd: number;
  readonly soundingEnd: number;
  width: number;
  state: NoteState;
}

export class GlideController {
  private readonly tracked: Tracked[];
  private readonly lookahead: number;

  constructor(targets: readonly GlideTarget[], timing: TimingMap, options: GlideOptions = {}) {
    this.lookahead = options.lookahead ?? 0.6;
    this.tracked = targets.flatMap(target => {
      const time = timing.notes.get(target.noteId);
      return time ? [{ target, ...time, width: -1, state: 'idle' as NoteState }] : [];
    });
  }

  update(time: number): void {
    for (const note of this.tracked) {
      let state: NoteState;
      let progress = 0;
      if (time < note.start - this.lookahead) state = 'idle';
      else if (time < note.start) state = 'upcoming';
      else if (time < Math.max(note.glideEnd, note.soundingEnd)) {
        state = 'active';
        const span = note.glideEnd - note.start;
        progress = span > 0 ? Math.min(1, (time - note.start) / span) : 1;
      } else state = 'played';
      const width = state === 'active' ? note.target.width * progress : 0;
      if (width !== note.width) {
        note.width = width;
        note.target.clip.setAttribute('width', String(Math.round(width * 1000) / 1000));
      }
      if (state !== note.state) {
        note.state = state;
        for (const node of [note.target.base, note.target.overlay]) {
          if (state === 'idle' || state === 'active') node.removeAttribute('data-state');
          else node.setAttribute('data-state', state);
        }
      }
    }
  }
}
