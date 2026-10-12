import { state } from './state';
import type { Verse } from '../types/karaoke';
import { collectParts, partKey, PART_COLORS } from '../core/parts';
import { matchesPart } from './timing';
import { renderMatrix } from './renderer';
import type { getStudioElements } from './dom';

type StudioElements = ReturnType<typeof getStudioElements>;

export function initParts(els: StudioElements, onChange: () => void) {
  const passStarts = new Map<string, { verse: Verse | undefined; w: number }>();
  const currentCursor = () => ({ v: state.currentV, w: state.currentW });
  const passCursor = () => ({ verse: state.localLyrics[state.currentV], w: state.currentW });
  const refresh = () => { renderMatrix(els, onChange); onChange(); };
  els.partSelector.addEventListener('change', () => {
    state.partCursors[state.selectedPart] = currentCursor();
    state.selectedPart = els.partSelector.value;
    const first = state.localLyrics.findIndex(verse => matchesPart(verse, state.selectedPart));
    const cursor = state.partCursors[state.selectedPart] ?? { v: first >= 0 ? first : state.localLyrics.length, w: 0 };
    state.currentV = cursor.v; state.currentW = cursor.w;
    state.lastStamped = null;
    if (!passStarts.has(state.selectedPart)) passStarts.set(state.selectedPart, passCursor());
    refresh();
    els.matrixPane.focus({ preventScroll: true });
  });
  // A manually chosen first word defines the start of this character's next loop pass.
  els.versesContainer.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('.word-chip, [data-action="seek-verse"]')) {
      passStarts.set(state.selectedPart, passCursor());
      state.partCursors[state.selectedPart] = currentCursor();
    }
  });
  els.partColor.addEventListener('input', () => {
    const part = state.parts.find(part => part.id === state.selectedPart);
    if (part) part.color = els.partColor.value;
    onChange();
  });
  els.partColor.addEventListener('change', refresh);
  els.btnAddPart.addEventListener('click', () => {
    const name = prompt('Character name (shown only in the editor):')?.trim();
    if (!name) return;
    const id = partKey(name);
    state.parts = collectParts(state.localLyrics, state.parts);
    if (!state.parts.some(part => part.id === id)) state.parts.push({ id, name, color: PART_COLORS[state.parts.length % PART_COLORS.length] });
    refresh();
  });

  const readLoop = () => {
    state.loopStart = Number(els.loopStart.value);
    state.loopEnd = Number(els.loopEnd.value);
    const valid = Number.isFinite(state.loopStart) && Number.isFinite(state.loopEnd) && state.loopStart >= 0 && state.loopEnd > state.loopStart && (!Number.isFinite(els.vid.duration) || state.loopEnd <= els.vid.duration);
    els.loopEnd.setCustomValidity(valid || !els.loopEnabled.checked ? '' : 'Loop end must be after start and within the video.');
    state.loopEnabled = els.loopEnabled.checked && valid;
    if (els.loopEnabled.checked && !valid) els.loopEnd.reportValidity();
    passStarts.clear();
    passStarts.set(state.selectedPart, passCursor());
  };
  els.loopStart.addEventListener('change', readLoop);
  els.loopEnd.addEventListener('change', readLoop);
  els.loopEnabled.addEventListener('change', readLoop);
  const restart = () => {
    const cursor = passStarts.get(state.selectedPart) ?? passCursor();
    passStarts.set(state.selectedPart, cursor);
    const index = cursor.verse ? state.localLyrics.indexOf(cursor.verse) : -1;
    state.currentV = index >= 0 && matchesPart(state.localLyrics[index], state.selectedPart) ? index : state.localLyrics.findIndex(verse => matchesPart(verse, state.selectedPart));
    state.currentW = Math.min(cursor.w, (state.localLyrics[state.currentV]?.words.length ?? 1) - 1);
    state.lastStamped = null;
    els.vid.currentTime = state.loopStart;
    refresh();
  };
  els.btnLoopRestart.addEventListener('click', () => {
    if (!(state.loopEnd > state.loopStart)) { els.loopEnd.setCustomValidity('Set a section start and end first.'); els.loopEnd.reportValidity(); return; }
    restart();
    els.matrixPane.focus({ preventScroll: true });
  });
  els.vid.addEventListener('timeupdate', () => {
    if (state.loopEnabled && !els.vid.paused && els.vid.currentTime >= state.loopEnd) restart();
  });
  els.vid.addEventListener('ended', () => {
    if (state.loopEnabled) { restart(); els.vid.play().catch(console.warn); }
  });
  return { reset() { passStarts.clear(); state.partCursors = {}; state.lastStamped = null; state.loopEnabled = false; els.loopEnabled.checked = false; } };
}
