import { createRenderEngine, type RenderEngineController } from '../renderer/renderEngine';
import { followPlayback } from '../playback/frames';
import { isTimed, isVerseTimed, partColor, partIds } from '../core/parts';
import { state } from './state';
import { formatTime } from './format';
import { matchesPart } from './timing';
import type { getStudioElements } from './dom';

type StudioElements = ReturnType<typeof getStudioElements>;

export function initPlayer(els: StudioElements) {
  const { vid, timelineTrack } = els;
  let preview: RenderEngineController | null = null;
  const togglePlay = () => {
    if (vid.paused) vid.play().catch(console.warn); else vid.pause();
  };
  vid.addEventListener('play', () => { els.playPauseLabel.textContent = 'Pause (K)'; });
  vid.addEventListener('pause', () => { els.playPauseLabel.textContent = 'Play (K)'; });
  els.btnPlayPause.addEventListener('click', togglePlay);
  els.btnSeekBack.addEventListener('click', () => { vid.currentTime = Math.max(0, vid.currentTime - 2); });
  els.btnSeekFwd.addEventListener('click', () => { if (Number.isFinite(vid.duration)) vid.currentTime = Math.min(vid.duration, vid.currentTime + 2); });
  timelineTrack.addEventListener('click', e => {
    const rect = timelineTrack.getBoundingClientRect();
    if (Number.isFinite(vid.duration) && vid.duration > 0) vid.currentTime = Math.max(0, Math.min(vid.duration, (e.clientX - rect.left) / rect.width * vid.duration));
  });
  let singing = new Set<string>();
  let lastTick = -1;
  const updatePlaybackFrame = () => {
    const time = vid.currentTime;
    const tick = Math.floor(time * 10);
    if (tick === lastTick) return;
    lastTick = tick;
    els.hudCurrentTime.textContent = formatTime(time);
    els.hudTotalTime.textContent = formatTime(vid.duration || 0);
    if (vid.duration > 0) els.timelinePlayhead.style.left = `${time / vid.duration * 100}%`;
    const adjusted = time - state.globalOffset;
    const next = new Set<string>();
    state.localLyrics.forEach((verse, v) => {
      if (verse.verseEnd <= verse.verseStart || adjusted < verse.verseStart || adjusted >= verse.verseEnd) return;
      verse.words.forEach((word, w) => {
        if (isTimed(word) && adjusted >= word.start && adjusted < word.end) next.add(`chip-${v}-${w}`);
      });
    });
    for (const id of singing) if (!next.has(id)) document.getElementById(id)?.classList.remove('active-singing');
    for (const id of next) if (!singing.has(id)) document.getElementById(id)?.classList.add('active-singing');
    singing = next;
  };
  const frames = followPlayback(vid, updatePlaybackFrame);
  const renderBlocks = () => {
    lastTick = -1; singing = new Set();
    renderTimelineBlocks(els.timelineBlocksContainer, vid.duration);
    preview?.destroy();
    preview = createRenderEngine({
      videoElement: vid,
      containerElement: els.activeHud,
      topLineElement: els.activeHudWords,
      bottomLineElement: els.activeHudTranslation,
      lyricsData: state.localLyrics,
      parts: state.parts.length ? state.parts : undefined,
      globalOffset: state.globalOffset
    });
    frames.draw();
  };
  vid.addEventListener('loadedmetadata', renderBlocks);
  const refreshTimings = (indices: number[]) => {
    updateTimelineTimings(els.timelineBlocksContainer, vid.duration, indices);
    preview?.refreshTimings();
    lastTick = -1;
    frames.draw();
  };
  return { togglePlay, renderBlocks, refreshTimings };
}

export function renderTimelineBlocks(container: HTMLElement, duration: number) {
  container.replaceChildren();
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const ids = state.selectedPart === '*' ? [...state.parts.map(part => part.id), ...(state.localLyrics.some(verse => !partIds(verse).length) ? [''] : [])] : [state.selectedPart];
  if (!ids.length) ids.push('');
  container.parentElement?.style.setProperty('--timeline-lanes', String(ids.length));
  ids.forEach((id, row) => {
    const lane = document.createElement('div');
    lane.className = 'timeline-lane';
    lane.dataset.part = id;
    lane.style.top = `${row * 24}px`;
    const label = document.createElement('span');
    label.className = 'timeline-lane-name';
    label.textContent = state.parts.find(part => part.id === id)?.name ?? 'Unassigned';
    lane.appendChild(label);
    for (const verse of state.localLyrics) {
      if (!matchesPart(verse, id)) continue;
      const block = document.createElement('div');
      block.className = 'timeline-verse-block';
      block.dataset.verse = String(state.localLyrics.indexOf(verse));
      writeTimelineTiming(block, verse, dur);
      block.style.borderColor = partColor(verse, state.parts);
      block.style.background = `${partColor(verse, state.parts)}33`;
      lane.appendChild(block);
    }
    container.appendChild(lane);
  });
}

function writeTimelineTiming(block: HTMLElement, verse: typeof state.localLyrics[number], duration: number): void {
  block.hidden = !isVerseTimed(verse);
  if (block.hidden) return;
  const start = Math.max(0, Math.min(100, (verse.verseStart + state.globalOffset) / duration * 100));
  const end = Math.max(0, Math.min(100, (verse.verseEnd + state.globalOffset) / duration * 100));
  block.style.left = `${start}%`;
  block.style.width = `${Math.max(.2, end - start)}%`;
}

/** Existing blocks, including untimed placeholders, survive individual timing taps. */
export function updateTimelineTimings(container: HTMLElement, duration: number, indices: number[]): void {
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 1;
  for (const index of new Set(indices)) {
    const verse = state.localLyrics[index];
    if (!verse) continue;
    container.querySelectorAll<HTMLElement>(`[data-verse="${index}"]`).forEach(block => writeTimelineTiming(block, verse, dur));
  }
}
