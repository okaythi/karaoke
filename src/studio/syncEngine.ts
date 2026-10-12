import { state } from './state';
import { renderMatrix, updateTelemetry, updateTimingCursor, updateTimingControls } from './renderer';
import { formatTime } from './format';
import { autoHealTimings } from '../core/contracts';
import { isTimed } from '../core/parts';
import { armRecordingPart } from './recording';
import { nextCursor, stampStart, stampEnd, matchesPart, recordingTarget, phraseRecordingPart, type Cursor } from './timing';
import type { getStudioElements } from './dom';

type StudioElements = ReturnType<typeof getStudioElements>;

/**
 * Initializes the keyboard-first tap-to-sync engine and studio transport modifiers
 */
export function initSyncEngine(
  els: StudioElements,
  onSaveMaster: () => void,
  onRenderBlocks: () => void,
  togglePlay: () => void,
  onTimingsChanged: (indices: number[]) => void
) {
  const { matrixPane, vid, offsetDisplay } = els;

  const refresh = (previous: Cursor, changed: number[] = []) => {
    const target = recordingTarget(state.parts.length, state.recordingPart);
    if (target !== null) state.partCursors[target] = { v: state.currentV, w: state.currentW };
    updateTimingCursor(els, previous, changed);
    if (changed.length) { onTimingsChanged(changed); updateTelemetry(els); }
  };

  matrixPane.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    if (e.repeat && ['Space', 'KeyE', 'Backspace'].includes(e.code)) { e.preventDefault(); return; }
    const cursor = { v: state.currentV, w: state.currentW };
    const verse = state.localLyrics[cursor.v];
    const time = vid.currentTime - state.globalOffset;
    const part = recordingTarget(state.parts.length, state.recordingPart);
    if (part === null) { if (['Space', 'KeyE', 'Backspace', 'Tab'].includes(e.code)) { e.preventDefault(); updateTimingControls(els); } return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!verse || !matchesPart(verse, part)) return;
      stampStart(verse, cursor.w, time);
      state.lastStamped = cursor;
      const next = nextCursor(state.localLyrics, cursor, part);
      state.currentV = next?.v ?? state.localLyrics.length;
      state.currentW = next?.w ?? 0;
      refresh(cursor, [cursor.v]);
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      const target = state.lastStamped ?? cursor;
      const targetVerse = state.localLyrics[target.v];
      if (targetVerse && matchesPart(targetVerse, part)) stampEnd(targetVerse, target.w, time);
      refresh(cursor, [target.v]);
    } else if (e.code === 'Backspace') {
      e.preventDefault();
      if (e.shiftKey && verse) {
        state.localLyrics.splice(cursor.v, 1);
        state.partCursors = {};
        const next = nextCursor(state.localLyrics, { v: cursor.v - 1, w: Number.MAX_SAFE_INTEGER }, part);
        state.currentV = next?.v ?? state.localLyrics.length;
        state.currentW = next?.w ?? 0;
        state.lastStamped = null;
        renderMatrix(els, onRenderBlocks); onRenderBlocks(); updateTelemetry(els);
      } else {
        const previous = nextCursor(state.localLyrics, cursor, part, -1);
        if (previous) {
          state.currentV = previous.v; state.currentW = previous.w;
          const target = state.localLyrics[previous.v];
          const word = target.words[previous.w];
          word.start = word.end = 0; word.timed = false; word.endLocked = false;
          autoHealTimings([target]);
          if (!target.words.some(isTimed)) target.verseStart = target.verseEnd = 0;
          state.lastStamped = null;
          refresh(cursor, [previous.v]);
        }
      }
    } else if (e.code === 'Tab') {
      e.preventDefault();
      const next = nextCursor(state.localLyrics, cursor, part, e.shiftKey ? -1 : 1);
      if (next) { state.currentV = next.v; state.currentW = next.w; }
      state.lastStamped = null;
      refresh(cursor);
    } else if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      const word = verse?.words[cursor.w];
      if (word && isTimed(word)) {
        const delta = e.key === ']' ? 0.05 : -0.05;
        word.start = Math.max(0, Number((word.start + delta).toFixed(3)));
        word.end = Math.max(word.start, Number((word.end + delta).toFixed(3)));
        autoHealTimings([verse]);
        refresh(cursor, [cursor.v]);
      }
    }
  });

  els.btnSetWordTimes.addEventListener('click', () => {
    const verse = state.localLyrics[state.currentV];
    const start = Number(els.wordStart.value);
    const end = Number(els.wordEnd.value);
    if (!verse || !els.wordStart.value || !els.wordEnd.value || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return;
    const cursor = { v: state.currentV, w: state.currentW };
    armRecordingPart(phraseRecordingPart(verse, state.recordingPart), cursor);
    stampStart(verse, state.currentW, start);
    stampEnd(verse, state.currentW, end);
    state.lastStamped = null;
    refresh(cursor, [cursor.v]);
    matrixPane.focus({ preventScroll: true });
  });

  // Global Transport Keydown
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select') && !(e.code === 'KeyS' && (e.ctrlKey || e.metaKey))) {
      return;
    }

    if (e.code === 'KeyK') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'KeyJ') {
      e.preventDefault();
      vid.currentTime = Math.max(0, vid.currentTime - 2);
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      vid.currentTime = Math.min(vid.duration, vid.currentTime + 2);
    } else if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSaveMaster();
    } else if (e.key === '?') {
      els.shortcutsModal.classList.add('open');
    }
  });

  // Offset Steppers
  const adjustOffset = (delta: number) => {
    const updated = parseFloat((state.globalOffset + delta).toFixed(3));
    state.globalOffset = updated;
    onRenderBlocks();
    offsetDisplay.textContent = `${updated >= 0 ? '+' : ''}${updated.toFixed(2)}s`;
  };

  document.getElementById('btn-offset-m100')?.addEventListener('click', () => adjustOffset(-0.1));
  document.getElementById('btn-offset-m50')?.addEventListener('click', () => adjustOffset(-0.05));
  document.getElementById('btn-offset-p50')?.addEventListener('click', () => adjustOffset(0.05));
  document.getElementById('btn-offset-p100')?.addEventListener('click', () => adjustOffset(0.1));

  // Playback Rate Selector
  document.querySelectorAll('[data-rate]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-rate]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const rate = parseFloat(btn.getAttribute('data-rate') || '1.0');
      state.playbackRate = rate;
      vid.playbackRate = rate;
    });
  });
}
