import { state } from './state';
import { matchesPart, recordingTarget, type Cursor } from './timing';

/** Save each voice's cursor separately; selecting a phrase overrides only that voice's cursor. */
export function armRecordingPart(part: string, explicit?: Cursor): void {
  const previous = recordingTarget(state.parts.length, state.recordingPart);
  if (previous !== null) state.partCursors[previous] = { v: state.currentV, w: state.currentW };
  state.recordingPart = part;
  const saved = state.partCursors[part];
  const validSaved = saved && (saved.v === state.localLyrics.length || (state.localLyrics[saved.v] && matchesPart(state.localLyrics[saved.v], part) && state.localLyrics[saved.v].words[saved.w]));
  const first = state.localLyrics.findIndex(verse => matchesPart(verse, part));
  const cursor = explicit ?? (validSaved ? saved : { v: first < 0 ? state.localLyrics.length : first, w: 0 });
  state.currentV = cursor.v;
  state.currentW = cursor.w;
  state.lastStamped = null;
}
