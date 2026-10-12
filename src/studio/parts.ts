import { state } from './state';
import type { Verse } from '../types/karaoke';
import { collectParts, partKey, PART_COLORS } from '../core/parts';
import { matchesPart, recordingTarget } from './timing';
import { armRecordingPart } from './recording';
import { renderMatrix, updateTimingCursor } from './renderer';
import type { getStudioElements } from './dom';

type StudioElements = ReturnType<typeof getStudioElements>;

export function initParts(els: StudioElements, onChange: () => void) {
  const passStarts = new Map<string, { verse: Verse | undefined; w: number }>();
  const currentCursor = () => ({ v: state.currentV, w: state.currentW });
  const passCursor = () => ({ verse: state.localLyrics[state.currentV], w: state.currentW });
  const refresh = () => { renderMatrix(els, onChange); onChange(); };
  const passKey = () => recordingTarget(state.parts.length, state.recordingPart) ?? '*';
  const rememberPass = () => { if (!passStarts.has(passKey())) passStarts.set(passKey(), passCursor()); };
  els.partSelector.addEventListener('change', () => {
    state.selectedPart = els.partSelector.value;
    if (state.selectedPart !== '*') armRecordingPart(state.selectedPart);
    rememberPass();
    refresh();
    els.matrixPane.focus({ preventScroll: true });
  });
  const chooseVoice = (id: string) => {
    const previous = currentCursor();
    if (id === '*') { state.recordingPart = null; state.lastStamped = null; }
    else armRecordingPart(id);
    rememberPass();
    if (state.selectedPart !== '*' && state.selectedPart !== id) { state.selectedPart = '*'; refresh(); }
    else updateTimingCursor(els, previous);
    els.matrixPane.focus({ preventScroll: true });
  };
  els.recordingPartSelector.addEventListener('change', () => chooseVoice(els.recordingPartSelector.value));
  // Quick voice changes while the video keeps playing; Space remains the single timing key.
  els.matrixPane.addEventListener('keydown', (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, textarea, select, button') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const digit = /^Digit([1-9])$/.exec(event.code);
    const voice = digit ? state.parts[Number(digit[1]) - 1] : undefined;
    if (voice) { event.preventDefault(); chooseVoice(voice.id); }
  });
  els.versesContainer.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('.word-chip, [data-action="seek-verse"], [data-action="record-verse"]') || (target.closest('.verse-card') && !target.closest('details, [data-action]'))) {
      passStarts.set(passKey(), passCursor());
      state.partCursors[passKey()] = currentCursor();
    }
  });
  els.partColor.addEventListener('input', () => {
    const part = state.parts.find(part => part.id === state.recordingPart);
    if (part) part.color = els.partColor.value;
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
    passStarts.set(passKey(), passCursor());
  };
  els.loopStart.addEventListener('change', readLoop);
  els.loopEnd.addEventListener('change', readLoop);
  els.loopEnabled.addEventListener('change', readLoop);
  const restart = () => {
    const previous = currentCursor();
    const cursor = passStarts.get(passKey()) ?? passCursor();
    passStarts.set(passKey(), cursor);
    const index = cursor.verse ? state.localLyrics.indexOf(cursor.verse) : -1;
    state.currentV = index >= 0 && matchesPart(state.localLyrics[index], passKey()) ? index : state.localLyrics.findIndex(verse => matchesPart(verse, passKey()));
    state.currentW = Math.min(cursor.w, (state.localLyrics[state.currentV]?.words.length ?? 1) - 1);
    state.lastStamped = null;
    els.vid.currentTime = state.loopStart;
    updateTimingCursor(els, previous);
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
  return { reset() { passStarts.clear(); state.recordingPart = null; state.partCursors = {}; state.lastStamped = null; state.loopEnabled = false; els.loopEnabled.checked = false; } };
}
