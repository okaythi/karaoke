import { state } from './state';
import { escapeHtml, lyricHtml } from '../core/html';
import { collectParts, isTimed, isVerseTimed, partIds, partColor } from '../core/parts';
import { matchesPart, phraseRecordingPart, recordingTarget, endWordCursor, type Cursor } from './timing';
import { armRecordingPart } from './recording';
import { formatTime } from './format';
import type { getStudioElements } from './dom';

type StudioElements = ReturnType<typeof getStudioElements>;

/**
 * Updates telemetry metrics (words timed %, total verses)
 */
export function updateTelemetry(els: StudioElements): void {
  let totalWords = 0;
  let timedWords = 0;

  state.localLyrics.forEach(v => {
    v.words.forEach(w => {
      totalWords++;
      if (isTimed(w)) {
        timedWords++;
      }
    });
  });

  const pct = totalWords > 0 ? Math.round((timedWords / totalWords) * 100) : 0;
  els.syncProgressFill.style.width = `${pct}%`;
  els.statsWordsTimed.textContent = `${timedWords} / ${totalWords} (${pct}%)`;
  els.statsVersesCount.textContent = String(state.localLyrics.length);
}

/**
 * Renders the matrix verse cards and interactive word chips
 */
export function renderMatrix(els: StudioElements, onRenderBlocks: () => void): void {
  const { versesContainer, matrixPane, vid } = els;
  state.parts = collectParts(state.localLyrics, state.parts);
  els.studioGrid.classList.toggle('ensemble-workspace', state.parts.length > 0);
  els.partSelector.innerHTML = '<option value="*">All parts</option><option value="">Unassigned</option>' + state.parts.map(part => `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)}</option>`).join('');
  els.partSelector.value = state.selectedPart;
  els.recordingPartSelector.innerHTML = '<option value="*">Choose singer…</option><option value="">Unassigned</option>' + state.parts.map(part => `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)}</option>`).join('');
  const selected = state.parts.find(part => part.id === state.recordingPart);
  els.partColor.disabled = !selected;
  els.partColor.value = selected?.color ?? '#deb668';
  updateTimingControls(els);

  if (state.localLyrics.length === 0) {
    versesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎵</div>
        <div style="font-weight: 700; font-size: 15px; color: var(--text-main);">No Lyrics Synced Yet</div>
        <p style="font-size: 12px; max-width: 320px;">This track has no lyrics file committed yet. Ingest raw lyrics from a paste/LRC or manually add your first verse.</p>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" id="btn-empty-paste">📋 Paste Raw / LRC</button>
          <button class="btn btn-primary" id="btn-empty-add">+ Add First Verse</button>
        </div>
      </div>
    `;

    document.getElementById('btn-empty-paste')?.addEventListener('click', () => {
      els.ingestModal.classList.add('open');
    });
    document.getElementById('btn-empty-add')?.addEventListener('click', () => {
      state.localLyrics.push({
        speaker: state.selectedPart !== '*' ? state.selectedPart || undefined : undefined,
        verseStart: 0,
        verseEnd: 0,
        words: [{ word: 'FirstWord ', start: 0, end: 0, timed: false }]
      });
      renderMatrix(els, onRenderBlocks);
      updateTelemetry(els);
      onRenderBlocks();
    });
    return;
  }

  versesContainer.innerHTML = state.localLyrics.map((verse, vIdx) => {
    if (!matchesPart(verse, state.selectedPart)) return '';
    const isCurrentVerse = vIdx === state.currentV && recordingTarget(state.parts.length, state.recordingPart) !== null;
    const rangeDisplay = isVerseTimed(verse)
      ? `${formatTime(verse.verseStart)} → ${formatTime(verse.verseEnd)}`
      : '--:--.---';

    return `
      <div class="verse-card ${isCurrentVerse ? 'active' : ''}" id="card-v-${vIdx}" style="--part-color:${partColor(verse, state.parts)}">
        <div class="verse-card-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="verse-id-badge">#${String(vIdx + 1).padStart(2, '0')}</span>
            <span class="verse-time-range">${rangeDisplay}</span>
            <details class="phrase-parts"><summary>${escapeHtml(partIds(verse).map(id => state.parts.find(part => part.id === id)?.name ?? id).join(' + ') || 'Unassigned')} ▾</summary>
              <div class="phrase-part-options" data-v="${vIdx}"></div>
            </details>
          </div>
          <div class="verse-actions">
            ${state.activeSong?.hasTranslation && !verse.translation ? `<button class="icon-btn" data-action="add-translation" data-v="${vIdx}" title="Add translation">+Tr</button>` : ''}
            <button class="micro-btn" data-action="record-verse" data-v="${vIdx}" aria-label="Time this phrase">Time</button>
            <button class="icon-btn" data-action="seek-verse" data-v="${vIdx}" title="Seek video to verse">▶</button>
            <button class="icon-btn" data-action="add-word-to-v" data-v="${vIdx}" title="Add word to verse">+</button>
            <button class="icon-btn danger" data-action="del-verse" data-v="${vIdx}" title="Delete verse">✕</button>
          </div>
        </div>

        <div class="words-grid">
          ${verse.words.map((w, wIdx) => {
            const wordTimed = isTimed(w);
            const isTargetNext = isCurrentVerse && wIdx === state.currentW;
            const displayWord = w.furigana
              ? `<span class="yomitan-ruby" data-furi="${escapeHtml(w.furigana)}">${lyricHtml(w.word)}</span>`
              : lyricHtml(w.word);

            return `
              <div class="word-chip ${wordTimed ? 'timed' : ''} ${isTargetNext ? 'target-next' : ''}"
                   data-v="${vIdx}" data-w="${wIdx}" id="chip-${vIdx}-${wIdx}">
                <span class="word-text">${displayWord}</span>
                <span class="word-timestamp">${wordTimed ? w.start.toFixed(2) + 's' : '--'}</span>
              </div>
            `;
          }).join('')}
        </div>

        ${verse.translation ? `
          <div class="verse-translation-subtitle" data-action="edit-translation" data-v="${vIdx}" title="Click to edit translation">
            <span style="opacity: 0.5; margin-right: 4px;">↳</span>${lyricHtml(verse.translation)}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Assignment checkboxes are built only when opened, rather than eleven controls on every row.
  versesContainer.querySelectorAll<HTMLDetailsElement>('.phrase-parts').forEach(details => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const options = details.querySelector<HTMLElement>('.phrase-part-options')!;
      const v = Number(options.dataset.v);
      const verse = state.localLyrics[v];
      if (!verse) return;
      options.innerHTML = state.parts.map(part => `<label><input type="checkbox" data-part="${escapeHtml(part.id)}" ${partIds(verse).includes(part.id) ? 'checked' : ''} />${escapeHtml(part.name)}</label>`).join('') + '<small>Select multiple only for identical words and timing.</small>';
      options.querySelectorAll<HTMLInputElement>('[data-part]').forEach(input => {
        input.addEventListener('change', () => {
          const assigned = new Set(partIds(verse));
          if (input.checked) assigned.add(input.dataset.part!); else assigned.delete(input.dataset.part!);
          const ids = [...assigned];
          verse.speaker = ids[0];
          verse.speakers = ids.length > 1 ? ids : undefined;
          state.partCursors = {}; state.recordingPart = null; state.lastStamped = null;
          renderMatrix(els, onRenderBlocks);
          onRenderBlocks();
        });
      });
    });
  });

  // Attach Word Chip Listeners
  versesContainer.querySelectorAll('.word-chip').forEach(el => {
    el.addEventListener('click', () => {
      const v = Number(el.getAttribute('data-v'));
      const w = Number(el.getAttribute('data-w'));
      const previous = { v: state.currentV, w: state.currentW };
      armRecordingPart(phraseRecordingPart(state.localLyrics[v], state.recordingPart), { v, w });
      const targetWord = state.localLyrics[v]?.words[w];
      const targetTime = targetWord && isTimed(targetWord) ? targetWord.start : state.localLyrics[v]?.verseStart || 0;
      // Switching voices during playback must not jump the video clock.
      if (vid.paused && ((targetWord && isTimed(targetWord)) || isVerseTimed(state.localLyrics[v]))) {
        vid.currentTime = Math.max(0, targetTime + state.globalOffset - 1.0);
      }
      updateTimingCursor(els, previous);

      matrixPane.focus({ preventScroll: true });
    });
  });

  // Attach Verse Actions
  versesContainer.querySelectorAll('[data-action="seek-verse"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = Number(btn.getAttribute('data-v'));
      const previous = { v: state.currentV, w: state.currentW };
      armRecordingPart(phraseRecordingPart(state.localLyrics[v], state.recordingPart), { v, w: 0 });
      const start = state.localLyrics[v]?.verseStart || 0;
      if (isVerseTimed(state.localLyrics[v])) vid.currentTime = Math.max(0, start + state.globalOffset - 1.0);
      updateTimingCursor(els, previous);
      matrixPane.focus({ preventScroll: true });
    });
  });

  // Time a phrase (or click its background) to arm its singer, leaving the overview visible.
  versesContainer.querySelectorAll<HTMLElement>('.verse-card').forEach(card => {
    card.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('.word-chip, details, [data-action]:not([data-action="record-verse"])')) return;
      const v = Number(card.id.slice('card-v-'.length));
      const previous = { v: state.currentV, w: state.currentW };
      armRecordingPart(phraseRecordingPart(state.localLyrics[v], state.recordingPart), { v, w: 0 });
      updateTimingCursor(els, previous);
      matrixPane.focus({ preventScroll: true });
    });
  });

  versesContainer.querySelectorAll('[data-action="add-word-to-v"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = Number(btn.getAttribute('data-v'));
      const wordText = prompt('Enter new word text:');
      if (wordText) {
        state.localLyrics[v].words.push({ word: wordText + ' ', start: 0, end: 0, timed: false });
        renderMatrix(els, onRenderBlocks);
        updateTelemetry(els);
        onRenderBlocks();
      }
    });
  });

  versesContainer.querySelectorAll('[data-action="del-verse"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = Number(btn.getAttribute('data-v'));
      if (confirm(`Delete verse #${v + 1}?`)) {
        state.localLyrics.splice(v, 1);
        if (state.currentV >= state.localLyrics.length) {
          state.currentV = Math.max(0, state.localLyrics.length - 1);
        }
        state.currentW = 0;
        state.partCursors = {}; state.lastStamped = null;
        renderMatrix(els, onRenderBlocks);
        updateTelemetry(els);
        onRenderBlocks();
      }
    });
  });

  versesContainer.querySelectorAll('[data-action="edit-translation"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = Number(el.getAttribute('data-v'));
      const current = state.localLyrics[v]?.translation || '';
      const updated = prompt('Edit verse translation (or leave empty to remove):', current);
      if (updated !== null) {
        state.localLyrics[v].translation = updated.trim() || undefined;
        renderMatrix(els, onRenderBlocks);
      }
    });
  });

  versesContainer.querySelectorAll('[data-action="add-translation"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = Number(btn.getAttribute('data-v'));
      const text = prompt('Enter verse translation:');
      if (text) {
        state.localLyrics[v].translation = text.trim();
        renderMatrix(els, onRenderBlocks);
      }
    });
  });

  // Smooth scroll active card vertically inside the verses container
  if (state.currentV !== lastScrolledVerse) {
    lastScrolledVerse = state.currentV;
    const activeCard = document.getElementById(`card-v-${state.currentV}`);
    if (activeCard && versesContainer) {
      const cardTop = activeCard.offsetTop;
      const containerTop = versesContainer.offsetTop;
      versesContainer.scrollTo({
        top: Math.max(0, cardTop - containerTop - 12),
        behavior: 'auto'
      });
    }
  }
}

let lastScrolledVerse = -1;

export function resetScrollTrack(): void {
  lastScrolledVerse = -1;
}

/** Small control update, independent of rebuilding the phrase list. */
export function updateTimingControls(els: StudioElements): void {
  const target = recordingTarget(state.parts.length, state.recordingPart);
  els.recordingPartSelector.value = state.recordingPart ?? '*';
  els.recordingPartSelector.disabled = state.parts.length === 0;
  const selected = state.parts.find(part => part.id === state.recordingPart);
  els.partColor.disabled = !selected;
  els.partColor.value = selected?.color ?? '#deb668';
  const word = state.localLyrics[state.currentV]?.words[state.currentW];
  els.wordStart.value = word && isTimed(word) ? String(word.start) : '';
  els.wordEnd.value = word && isTimed(word) ? String(word.end) : '';
  els.btnSetWordTimes.disabled = !word;
  const endTarget = endWordCursor(state.localLyrics, { v: state.currentV, w: state.currentW }, state.lastStamped, target);
  els.btnEndWord.disabled = endTarget === null;
  const endingWord = endTarget ? state.localLyrics[endTarget.v].words[endTarget.w] : null;
  els.endWordTarget.textContent = endingWord
    ? `Ends “${endingWord.word.replace(/<[^>]*>/g, '').trim()}” at the current video time.${endingWord.endLocked ? ' End is locked.' : ''}`
    : 'Tap a word to mark its end.';
  if (target === null) {
    els.partStatus.textContent = 'Choose a singer or click their phrase to record.';
    return;
  }
  const name = selected?.name ?? (target === '*' ? 'this song' : 'Unassigned');
  const complete = !state.localLyrics[state.currentV] || !matchesPart(state.localLyrics[state.currentV], target);
  els.partStatus.textContent = complete ? `${name}: end of part. Click a phrase to continue or choose another voice.` : `Recording ${name} · phrase ${state.currentV + 1}, word ${state.currentW + 1}.`;
}

/** Timing taps never replace the matrix DOM or its event listeners. */
export function updateTimingCursor(els: StudioElements, previous: Cursor, changed: number[] = []): void {
  document.getElementById(`chip-${previous.v}-${previous.w}`)?.classList.remove('target-next');
  document.getElementById(`card-v-${previous.v}`)?.classList.remove('active');
  const armed = recordingTarget(state.parts.length, state.recordingPart) !== null;
  const card = document.getElementById(`card-v-${state.currentV}`);
  if (armed) {
    document.getElementById(`chip-${state.currentV}-${state.currentW}`)?.classList.add('target-next');
    card?.classList.add('active');
  }
  for (const v of new Set(changed)) {
    const verse = state.localLyrics[v];
    if (!verse) continue;
    const range = document.getElementById(`card-v-${v}`)?.querySelector('.verse-time-range');
    if (range) range.textContent = isVerseTimed(verse) ? `${formatTime(verse.verseStart)} → ${formatTime(verse.verseEnd)}` : '--:--.---';
    verse.words.forEach((word, w) => {
      const chip = document.getElementById(`chip-${v}-${w}`);
      chip?.classList.toggle('timed', isTimed(word));
      const timestamp = chip?.querySelector('.word-timestamp');
      const text = isTimed(word) ? `${word.start.toFixed(2)}s` : '--';
      if (timestamp && timestamp.textContent !== text) timestamp.textContent = text;
    });
  }
  updateTimingControls(els);
  if (card && previous.v !== state.currentV) {
    const pane = els.versesContainer;
    const top = card.offsetTop - pane.offsetTop;
    if (top < pane.scrollTop || top + card.offsetHeight > pane.scrollTop + pane.clientHeight) pane.scrollTo({ top: Math.max(0, top - 12), behavior: 'auto' });
  }
}
