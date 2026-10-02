import timingMap from '../data/score/itsumo-karaoke-map.json';
import { engravingScore } from './engravingModel';
import { measureBarWidths, onsetToX, renderEngravingPage } from './engravingView';
import type { EngravingPage } from './engravingView';

interface TimelineGroup { audioStart: number; noteIds: string[] }

/** A run of bars drawn as one SVG: a whole page (wide) or one half of the view (compact). */
interface Chunk { firstMeasure: number; bars: number; /** Bar count the chunk's width is scaled for. */ scaleBars: number }

interface Slot {
  element: HTMLDivElement;
  chunk: number;
  page?: EngravingPage;
  playhead?: SVGLineElement;
  glideWidths: number[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDE_BARS_PER_PAGE = 6;
// Phones in portrait show four larger bars as two halves. Once the playhead
// moves into one half, the half it left is replaced by the bars after the
// current half, so there are always bars to read ahead and no full-page flip.
// A pair of bars too dense for a half at full size gets a half of its own.
// Every half is stretched to the same width so the score keeps one scale, and
// the empty margins above, below and beside the grand staff are cropped away.
// The crop is centred on the grand staff and still holds 8va marks, ledger
// lines and ties.
const COMPACT = {
  minBarWidth: 150,
  halfWidth: 470,
  /** A bar pair may be this much wider than a half before it is split. */
  pairTolerance: 1.2,
  crop: { left: 6, right: 20, top: 70, height: 296 }
};
const COMPACT_QUERY = '(max-width: 768px) and (orientation: portrait)';
const groups = timingMap.timelineGroups as TimelineGroup[];

function groupAt(time: number): TimelineGroup | undefined {
  let low = 0, high = groups.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (groups[middle].audioStart <= time) low = middle + 1;
    else high = middle;
  }
  return groups[Math.max(0, low - 1)];
}

function measureAt(time: number): number {
  const group = groupAt(time);
  const source = group ? engravingScore.sources.get(group.noteIds[0]) : undefined;
  return source?.segments[0].measure || 1;
}

function chunkAt(chunks: readonly Chunk[], measure: number): number {
  let low = 0, high = chunks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (chunks[middle].firstMeasure <= measure) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function wideChunks(): Chunk[] {
  const chunks: Chunk[] = [];
  for (let first = 1; first <= engravingScore.measures; first += WIDE_BARS_PER_PAGE)
    chunks.push({ firstMeasure: first, bars: WIDE_BARS_PER_PAGE, scaleBars: WIDE_BARS_PER_PAGE });
  return chunks;
}

let compactChunkCache: Chunk[] | undefined;
function compactChunks(): Chunk[] {
  if (compactChunkCache) return compactChunkCache;
  const { widths, openingExtra } = measureBarWidths(engravingScore, COMPACT.minBarWidth);
  const limit = COMPACT.halfWidth * COMPACT.pairTolerance;
  const chunks: Chunk[] = [];
  for (let measure = 1; measure <= engravingScore.measures;) {
    const pairFits = measure < engravingScore.measures &&
      48 + openingExtra + widths[measure - 1] + widths[measure] <= limit;
    const finalBar = measure === engravingScore.measures;
    // A dense bar fills its half; a final lone bar keeps the normal bar scale.
    chunks.push({ firstMeasure: measure, bars: pairFits ? 2 : 1, scaleBars: pairFits || finalBar ? 2 : 1 });
    measure += pairFits ? 2 : 1;
  }
  // Widths measured before the music font loads are wrong; only keep a measurement taken after.
  if (typeof document === 'undefined' || document.fonts?.status === 'loaded') compactChunkCache = chunks;
  return chunks;
}

export interface MusicXmlScoreController { destroy(): void; renderNow(): void }

// The historic module name is retained for the player's import. The engraving
// itself is derived from the immutable audio transcription map.
export function createMusicXmlScoreRenderer(video: HTMLVideoElement, container: HTMLElement): MusicXmlScoreController {
  const compactQuery = typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : undefined;
  let compact = false;
  let chunks: Chunk[] = [];
  let slots: Slot[] = [];
  let lastTime = NaN;
  let frame = 0;
  let destroyed = false;

  function setLayout(): void {
    compact = !!compactQuery?.matches;
    chunks = compact ? compactChunks() : wideChunks();
    container.replaceChildren();
    container.classList.toggle('score-halves', compact);
    const { left, right, height } = COMPACT.crop;
    if (compact) container.style.setProperty('--score-half-aspect', `${COMPACT.halfWidth - left - right} / ${height}`);
    else container.style.removeProperty('--score-half-aspect');
    slots = Array.from({ length: compact ? 2 : 1 }, () => {
      const element = document.createElement('div');
      element.className = compact ? 'score-half' : 'score-page';
      if (!compact) element.style.display = 'contents';
      container.appendChild(element);
      return { element, chunk: -1, glideWidths: [] };
    });
    lastTime = NaN;
  }

  function draw(slot: Slot, index: number, animate: boolean): void {
    slot.chunk = index;
    slot.element.replaceChildren();
    slot.page = undefined;
    slot.playhead = undefined;
    slot.glideWidths = [];
    const chunk = chunks[index];
    if (!chunk) return;
    const engraving = document.createElement('div');
    engraving.className = 'score-engraving';
    slot.element.appendChild(engraving);
    const page = compact
      ? renderEngravingPage(engraving, chunk.firstMeasure, engravingScore, chunk.bars, {
        minBarWidth: COMPACT.minBarWidth,
        pageWidth: COMPACT.halfWidth * chunk.bars / chunk.scaleBars,
        timeSignature: 'opening'
      })
      : renderEngravingPage(engraving, chunk.firstMeasure, engravingScore, chunk.bars);
    if (compact) {
      const { left, right, top, height } = COMPACT.crop;
      const width = Number(page.svg.getAttribute('viewBox')!.split(' ')[2]);
      page.svg.setAttribute('viewBox', `${left} ${top} ${width - left - right} ${height}`);
    }
    const playhead = document.createElementNS(SVG_NS, 'line');
    playhead.setAttribute('y1', '78'); playhead.setAttribute('y2', '340');
    playhead.setAttribute('stroke', '#deb668');
    playhead.setAttribute('stroke-width', '1.5');
    playhead.setAttribute('opacity', '.45');
    playhead.setAttribute('pointer-events', 'none');
    page.svg.appendChild(playhead);
    slot.page = page;
    slot.playhead = playhead;
    slot.glideWidths = page.highlights.map(() => -1);
    if (animate) {
      // Restart the fade so a replaced half is noticed.
      slot.element.classList.remove('score-half-turned');
      void slot.element.offsetWidth;
      slot.element.classList.add('score-half-turned');
    }
  }

  function updateSlot(slot: Slot, time: number, active: boolean): void {
    const page = slot.page;
    if (!page || !slot.playhead) return;
    slot.playhead.setAttribute('visibility', active ? 'visible' : 'hidden');
    if (active) {
      const x = String(onsetToX(page.anchors, time, page.terminal));
      slot.playhead.setAttribute('x1', x);
      slot.playhead.setAttribute('x2', x);
    }
    page.highlights.forEach((target, index) => {
      // Each notehead glides for exactly its written value (see glideWindow).
      const span = target.end - target.start;
      const progress = span > 0
        ? Math.max(0, Math.min(1, (time - target.start) / span))
        : Number(time >= target.start);
      const width = target.width * progress;
      if (width === slot.glideWidths[index]) return;
      slot.glideWidths[index] = width;
      target.clip.setAttribute('width', String(width));
    });
  }

  function renderNow(): void {
    if (destroyed) return;
    const time = video.currentTime;
    const current = chunkAt(chunks, measureAt(time));
    let changed = false;
    slots.forEach((slot, position) => {
      // Compact: a chunk always occupies the half matching its parity, so the
      // current half and the one after it are both on screen.
      const wanted = compact ? (current % 2 === position ? current : current + 1) : current;
      if (wanted === slot.chunk) return;
      // Only a half replaced during play fades; a first draw or a seek does not.
      const turning = compact && slot.chunk !== -1 && Math.abs(wanted - slot.chunk) === 2 && !video.paused;
      draw(slot, wanted, turning);
      changed = true;
    });
    if (!changed && time === lastTime) return;
    lastTime = time;
    let fadeStart: number | undefined;
    for (const slot of slots) {
      updateSlot(slot, time, slot.chunk === current);
      fadeStart ??= slot.page?.terminal?.audioEnd;
    }
    container.style.opacity = fadeStart === undefined ? '1' :
      String(1 - Math.max(0, Math.min(1, time - fadeStart)));
  }

  const onLayoutChange = () => {
    setLayout();
    renderNow();
  };

  const loop = () => { renderNow(); if (!destroyed) frame = requestAnimationFrame(loop); };
  video.addEventListener('seeked', renderNow);
  compactQuery?.addEventListener('change', onLayoutChange);
  setLayout();
  if (typeof document !== 'undefined' && document.fonts?.status !== 'loaded') {
    document.fonts?.ready.then(() => { if (!destroyed && compact) onLayoutChange(); });
  }
  frame = requestAnimationFrame(loop);
  renderNow();
  return {
    renderNow,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      video.removeEventListener('seeked', renderNow);
      compactQuery?.removeEventListener('change', onLayoutChange);
      container.classList.remove('score-halves');
      container.style.removeProperty('--score-half-aspect');
      container.replaceChildren();
    }
  };
}
