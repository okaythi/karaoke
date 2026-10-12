import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../state';
import { armRecordingPart } from '../recording';
import { phraseRecordingPart, recordingTarget } from '../timing';
import { initParts } from '../parts';
import { initSyncEngine } from '../syncEngine';
import { parseLyricImport } from '../../core/lyricImport';
import type { getStudioElements } from '../dom';

class Control {
  value = ''; disabled = false; textContent = ''; checked = false;
  scrollTop = 0; clientHeight = 100; offsetTop = 0;
  style = { width: '', setProperty() {} };
  classList = { add() {}, remove() {}, toggle() {} };
  listeners = new Map<string, ((event: any) => void)[]>();
  addEventListener(type: string, callback: (event: any) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
  dispatch(type: string, event: any) { for (const callback of this.listeners.get(type) ?? []) callback(event); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  scrollTo() {}
  setCustomValidity() {}
  reportValidity() {}
  // If a timing action regresses to replacing the matrix, this test fails.
  set innerHTML(_value: string) { throw new Error('Timing action rebuilt the matrix'); }
}

function setup(t: { after(fn: () => void): void }, text = '@A\nFirst two\n@B\nOther words\n@A\nLater phrase') {
  const original = { ...state };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const parsed = parseLyricImport(text);
  Object.assign(state, { localLyrics: parsed.verses, parts: parsed.parts, selectedPart: '*', recordingPart: null, currentV: 0, currentW: 0, partCursors: {}, lastStamped: null, globalOffset: 0 });
  const controls = Object.fromEntries(['matrixPane', 'wordStart', 'wordEnd', 'btnSetWordTimes', 'btnEndWord', 'endWordTarget', 'partStatus', 'partColor', 'recordingPartSelector', 'syncProgressFill', 'statsWordsTimed', 'statsVersesCount', 'offsetDisplay', 'versesContainer', 'partSelector', 'btnAddPart', 'loopStart', 'loopEnd', 'loopEnabled', 'btnLoopRestart'].map(name => [name, new Control()]));
  const media = { currentTime: 1, duration: 30, paused: false, listeners: new Map<string, ((event: any) => void)[]>(), addEventListener: Control.prototype.addEventListener, dispatch: Control.prototype.dispatch };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => null, querySelectorAll: () => [] } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {} } });
  let rebuilds = 0;
  const changed: number[][] = [];
  initSyncEngine({ ...controls, vid: media } as unknown as ReturnType<typeof getStudioElements>, () => {}, () => { rebuilds++; }, () => {}, indices => changed.push(indices));
  t.after(() => {
    Object.assign(state, original);
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete (globalThis as any).document;
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete (globalThis as any).window;
  });
  const press = (code: string, extra = {}) => controls.matrixPane.dispatch('keydown', { code, key: code, repeat: false, target: controls.matrixPane, preventDefault() {}, ...extra });
  return { controls, media, press, changed, rebuilds: () => rebuilds, parts: () => initParts({ ...controls, vid: media } as unknown as ReturnType<typeof getStudioElements>, () => { rebuilds++; }) };
}

test('ensemble overview refuses to stamp an arbitrary first voice until one is chosen', t => {
  const app = setup(t);
  app.press('Space');
  assert.equal(state.localLyrics[0].words[0].timed, false);
  assert.equal(app.changed.length, 0);
  assert.match(app.controls.partStatus.textContent, /Choose a singer/);
  assert.equal(recordingTarget(0, null), '*');
});

test('clicking a B phrase in All parts arms B; Space skips interleaved A lines without rebuilding', t => {
  const app = setup(t, '@A\nFirst\n@B\nResponse\n@A\nLater\n@B\nSecond');
  armRecordingPart(phraseRecordingPart(state.localLyrics[1], state.recordingPart), { v: 1, w: 0 });
  app.press('Space');
  assert.equal(state.recordingPart, 'b');
  assert.equal(state.selectedPart, '*');
  assert.equal(state.currentV, 3);
  assert.equal(state.localLyrics[0].words[0].timed, false);
  assert.equal(state.localLyrics[2].words[0].timed, false);
  assert.deepEqual(app.changed, [[1]]);
  assert.equal(app.rebuilds(), 0);
  app.media.currentTime = 2;
  app.press('Space');
  assert.equal(state.currentV, state.localLyrics.length);
  app.media.currentTime = 3;
  app.press('Space');
  assert.deepEqual(app.changed, [[1], [3]]);
});

test('switching between voices keeps their cursors and supports held ends after advancing', t => {
  const app = setup(t);
  armRecordingPart('a', { v: 0, w: 0 });
  app.press('Space');
  armRecordingPart('b', { v: 1, w: 0 });
  app.media.currentTime = 1.5;
  app.press('Space');
  armRecordingPart('a');
  assert.deepEqual({ v: state.currentV, w: state.currentW }, { v: 0, w: 1 });
  app.media.currentTime = 2;
  app.press('Space');
  assert.equal(state.currentV, 2);
  app.media.currentTime = 4;
  app.press('KeyE');
  assert.equal(state.localLyrics[0].words[1].end, 4);
  assert.equal(state.localLyrics[0].words[1].endLocked, true);
  assert.equal(state.localLyrics[1].words[0].start, 1.5);
  assert.equal(app.rebuilds(), 0);
});

test('shared phrases keep the armed singer and undo/Tab stay on that voice', t => {
  const app = setup(t, '@A\nFirst\n@B\nOther\n@A + B\nShared\n@A\nLast');
  armRecordingPart('b', { v: 1, w: 0 });
  assert.equal(phraseRecordingPart(state.localLyrics[2], state.recordingPart), 'b');
  app.press('Space');
  assert.equal(state.currentV, 2);
  app.press('Space');
  app.press('Backspace');
  assert.equal(state.currentV, 2);
  assert.equal(state.localLyrics[2].words[0].timed, false);
  app.press('Tab', { shiftKey: true });
  assert.equal(state.currentV, 1);
  assert.equal(app.rebuilds(), 0);
});

test('a held Space does not duplicate timestamps or advance twice', t => {
  const app = setup(t);
  armRecordingPart('a', { v: 0, w: 0 });
  app.press('Space');
  app.press('Space', { repeat: true });
  assert.equal(state.currentW, 1);
  assert.deepEqual(app.changed, [[0]]);
});

test('timing many words across a large ensemble does not replace the matrix or preview', t => {
  const text = Array.from({ length: 280 }, (_, index) => `@Voice ${index % 7}\nOne two three four five six`).join('\n');
  const app = setup(t, text);
  armRecordingPart('voice 3');
  for (let i = 0; i < 120; i++) { app.media.currentTime = i / 3; app.press('Space'); }
  assert.equal(app.changed.length, 120);
  assert.equal(app.rebuilds(), 0);
  assert.equal(state.localLyrics.filter(v => v.speaker !== 'Voice 3').some(v => v.words.some(w => w.timed)), false);
});

test('voice hotkeys work in the overview without seeking or rebuilding', t => {
  const app = setup(t);
  app.parts();
  app.media.currentTime = 20;
  app.press('Digit2');
  assert.equal(state.recordingPart, 'b');
  assert.equal(state.currentV, 1);
  assert.equal(state.selectedPart, '*');
  assert.equal(app.media.currentTime, 20);
  app.press('Space');
  assert.equal(state.localLyrics[1].words[0].start, 20);
  assert.equal(app.rebuilds(), 0);
});

test('loop restart restores the recording voice cursor without a matrix or preview rebuild', t => {
  const app = setup(t);
  app.parts();
  app.controls.recordingPartSelector.value = 'b';
  app.controls.recordingPartSelector.dispatch('change', {});
  app.controls.loopStart.value = '10';
  app.controls.loopEnd.value = '15';
  app.controls.loopEnabled.checked = true;
  app.controls.loopEnabled.dispatch('change', {});
  app.media.currentTime = 11;
  app.press('Space');
  assert.equal(state.currentW, 1);
  app.media.currentTime = 15.1;
  app.media.dispatch('timeupdate', {});
  assert.equal(state.currentV, 1);
  assert.equal(state.currentW, 0);
  assert.equal(state.recordingPart, 'b');
  assert.equal(app.media.currentTime, 10);
  assert.equal(app.rebuilds(), 0);
});

test('visible End word button ends the last tap after the cursor advances to another phrase', t => {
  const app = setup(t, '@A\nHeld\n@B\nOther\n@A\nNext');
  armRecordingPart('a', { v: 0, w: 0 });
  app.press('Space');
  assert.equal(state.currentV, 2);
  assert.equal(app.controls.btnEndWord.disabled, false);
  assert.match(app.controls.endWordTarget.textContent, /Held/);
  app.media.currentTime = 4;
  app.controls.btnEndWord.dispatch('click', {});
  assert.equal(state.localLyrics[0].words[0].end, 4);
  assert.equal(state.localLyrics[0].words[0].endLocked, true);
  assert.equal(state.localLyrics[1].words[0].timed, false);
  assert.match(app.controls.endWordTarget.textContent, /End is locked/);
  assert.equal(app.rebuilds(), 0);
});

test('End word cannot stamp an unselected voice or an untimed word', t => {
  const app = setup(t);
  app.controls.btnEndWord.dispatch('click', {});
  assert.equal(app.changed.length, 0);
  assert.equal(app.controls.btnEndWord.disabled, true);
  armRecordingPart('b', { v: 1, w: 0 });
  app.press('KeyE');
  assert.equal(app.changed.length, 0);
  assert.equal(app.controls.btnEndWord.disabled, true);
  assert.equal(state.localLyrics[1].words[0].endLocked, undefined);
});
