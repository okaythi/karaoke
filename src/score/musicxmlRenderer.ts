import timingMap from '../data/score/itsumo-karaoke-map.json';
import { engravingScore } from './engravingModel';
import { onsetToX, renderEngravingPage } from './engravingView';
import type { EngravingPage } from './engravingView';

interface TimelineGroup { audioStart: number; noteIds: string[] }

const SVG_NS = 'http://www.w3.org/2000/svg';
const BARS_PER_PAGE = 6;
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

export interface MusicXmlScoreController { destroy(): void; renderNow(): void }

// The historic module name is retained for the player's import. The engraving
// itself is derived from the immutable audio transcription map.
export function createMusicXmlScoreRenderer(video: HTMLVideoElement, container: HTMLElement): MusicXmlScoreController {
  let pageNumber = -1;
  let page: EngravingPage | undefined;
  let playhead: SVGLineElement | undefined;
  let frame = 0;
  let destroyed = false;

  function draw(nextPage: number): void {
    pageNumber = nextPage;
    container.replaceChildren();
    const firstMeasure = nextPage * BARS_PER_PAGE + 1;
    const engraving = document.createElement('div');
    engraving.className = 'score-engraving';
    container.appendChild(engraving);
    page = renderEngravingPage(engraving, firstMeasure, engravingScore, BARS_PER_PAGE);
    playhead = document.createElementNS(SVG_NS, 'line');
    playhead.setAttribute('y1', '78'); playhead.setAttribute('y2', '340');
    playhead.setAttribute('stroke', '#deb668');
    playhead.setAttribute('stroke-width', '1.5');
    playhead.setAttribute('opacity', '.45');
    playhead.setAttribute('pointer-events', 'none');
    page.svg.appendChild(playhead);
  }

  function renderNow(): void {
    if (destroyed) return;
    const time = video.currentTime;
    const group = groupAt(time);
    const source = group ? engravingScore.sources.get(group.noteIds[0]) : undefined;
    const measure = source?.segments[0].measure || 1;
    const nextPage = Math.floor((measure - 1) / BARS_PER_PAGE);
    if (nextPage !== pageNumber) draw(nextPage);
    if (!page) return;
    const x = onsetToX(page.anchors, time);
    playhead?.setAttribute('x1', String(x));
    playhead?.setAttribute('x2', String(x));
    for (const target of page.highlights) {
      const duration = target.source.audioEnd - target.source.audioStart;
      const progress = duration > 0
        ? Math.max(0, Math.min(1, (time - target.source.audioStart) / duration))
        : Number(time >= target.source.audioStart);
      const span = target.to - target.from;
      const fragmentProgress = span > 0 ? Math.max(0, Math.min(1, (progress - target.from) / span)) : 0;
      target.clip.setAttribute('width', String(target.width * fragmentProgress));
    }
  }

  const loop = () => { renderNow(); if (!destroyed) frame = requestAnimationFrame(loop); };
  video.addEventListener('seeked', renderNow);
  frame = requestAnimationFrame(loop);
  renderNow();
  return {
    renderNow,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      video.removeEventListener('seeked', renderNow);
      container.replaceChildren();
    }
  };
}
