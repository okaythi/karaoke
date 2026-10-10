/**
 * The score under the video, following playback.
 *
 * Lines of music are engraved to fit the score area: on wide screens one
 * line fills it, and the page turns when playback reaches the next line. On
 * phones in portrait two full-width lines are stacked, as large as the room
 * between the video and the controls allows; when playback moves into one,
 * the one it left is replaced by the line after, so there is always music to
 * read ahead without a full page flip. Portrait lines share one vertical frame.
 * Desktop lines fit their own ink bounds so distant ornaments cannot shrink
 * the current music.
 *
 * Media time is the only clock: every frame reads `video.currentTime`, so
 * seeking and pausing never drift. Frames are drawn while the media plays and
 * on each seek; a paused score is left alone.
 */
import { engrave } from '../layout/engrave';
import type { Engraving } from '../layout/engrave';
import * as F from '../core/fraction';
import { ScoreIndex } from '../model/query';
import { GlideController } from '../playback/glide';
import { playheadAnchors, playheadX } from '../playback/playhead';
import type { PlayheadAnchor } from '../playback/playhead';
import { followPlayback } from '../../playback/frames';
import { renderSystemView } from '../render/svg';
import type { RenderedSystem } from '../render/svg';
import type { SongScore } from '../songs';
import { DEFAULT_SHEET, StyleResolver } from '../style/style';

export interface ScoreViewController {
  renderNow(): void;
  destroy(): void;
}

const COMPACT_QUERY = '(max-width: 768px) and (orientation: portrait)';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Reference height in staff spaces for sizing paired portrait lines. */
const WIDE_FRAME = 30;
/** Desktop lines use their own ink bounds; do not reserve room for distant slurs. */
const DESKTOP_FRAME = 20;
/** Tighten desktop horizontal layout by 4.32%, keeping the glyph size unchanged. */
const WIDE_SPACING_SCALE = 0.9568;
/** On a phone a line is at least this many staff spaces wide (two bars) and at most this many. */
const COMPACT_MIN_SPACES = 46;
const COMPACT_MAX_SPACES = 80;
/** Gap between the two lines on a phone, in pixels. */
const COMPACT_GAP = 10;
/** Space kept around the music inside its frame, and room for the brace on the left. */
const MARGIN = 1.2;
const LEFT_ROOM = 3;

interface Shown {
  readonly system: number;
  readonly view: RenderedSystem;
  readonly glide: GlideController;
  readonly anchors: readonly PlayheadAnchor[];
  readonly playhead: SVGLineElement;
}

interface Slot {
  readonly element: HTMLDivElement;
  shown?: Shown;
}

export function createScoreView(video: HTMLMediaElement, container: HTMLElement, song: SongScore): ScoreViewController {
  const index = new ScoreIndex(song.score);
  const style = new StyleResolver(song.style ? [DEFAULT_SHEET, song.style] : [DEFAULT_SHEET], {
    measureNumber: measure => song.score.measures[measure].number,
    sectionOf: measure => {
      for (let search = measure; search >= 0; search--) if (song.score.measures[search].section) return song.score.measures[search].section;
      return undefined;
    }
  });
  const compactQuery = typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : undefined;
  let compact = false;
  let engraving: Engraving | undefined;
  let frame = { top: -6, bottom: 21 };
  let width = 0;
  let starts: number[] = [];
  let slots: Slot[] = [];
  const finalEnd = Math.max(...[...song.timing.notes.values()].map(note => note.soundingEnd));
  /** Engravings by line width, so turning a phone back does not engrave the piece again. */
  const engravings = new Map<number, Engraving>();
  let destroyed = false;
  let lastTime = NaN;
  let laidOutFor = '';

  function layout(): void {
    const rect = container.getBoundingClientRect();
    compact = !!compactQuery?.matches;
    // On phones the area's own height follows the music, so the room comes from its parent.
    const room = compact ? container.parentElement?.clientHeight ?? 0 : rect.height;
    const key = `${Math.round(rect.width)}x${Math.round(room)}:${compact}`;
    if (!rect.width || key === laidOutFor) return;
    laidOutFor = key;
    const slotCount = compact ? 2 : 1;
    const slotWidth = rect.width;
    // Phones: two stacked lines as tall as the room allows, never wider than two bars need.
    const byHeight = (room - COMPACT_GAP) / (2 * WIDE_FRAME);
    const spacePx = compact
      ? Math.max(slotWidth / COMPACT_MAX_SPACES, Math.min(slotWidth / COMPACT_MIN_SPACES, byHeight))
      : Math.max(4, rect.height / DESKTOP_FRAME);
    width = Math.max(24, (slotWidth / spacePx - LEFT_ROOM - MARGIN) * (compact ? 1 : WIDE_SPACING_SCALE));
    const widthKey = Math.round(width * 100);
    engraving = engravings.get(widthKey) ?? engrave(song.score, { width, settings: song.layout });
    engravings.set(widthKey, engraving);
    // Include all ink: clipping tall slurs hides a layout error and cuts off music.
    frame = {
      top: Math.min(...engraving.systems.map(system => system.box.y0)),
      bottom: Math.max(...engraving.systems.map(system => system.box.y1))
    };
    starts = engraving.systems.map(system => song.timing.timeAt(F.toNumber(index.measureStarts[system.first])));

    container.replaceChildren();
    container.classList.toggle('score-halves', compact);
    const aspect = `${width + LEFT_ROOM + MARGIN} / ${frame.bottom - frame.top + 2 * MARGIN}`;
    container.style.setProperty('--score-half-aspect', aspect);
    slots = Array.from({ length: slotCount }, () => {
      const element = document.createElement('div');
      element.className = compact ? 'score-half' : 'score-page';
      container.appendChild(element);
      return { element };
    });
    lastTime = NaN;
  }

  function show(slot: Slot, system: number, animate: boolean): void {
    slot.element.replaceChildren();
    slot.shown = undefined;
    const engraved = engraving?.systems[system];
    if (!engraved) return;
    const view = renderSystemView(engraved, {
      style, glides: true, margin: MARGIN,
      frame: compact ? frame : { top: engraved.box.y0, bottom: engraved.box.y1 },
      // Centre the actual line, including its brace, rather than a wider
      // requested extent that may leave unused space on the right.
      extent: compact ? { left: -LEFT_ROOM, right: width } : {
        left: Math.min(engraved.box.x0, 0) - MARGIN,
        right: Math.max(engraved.box.x1, engraved.width)
      },
      title: `Score, bars ${song.score.measures[engraved.first].number}–${song.score.measures[engraved.last].number}`
    });
    view.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const anchors = playheadAnchors(engraved, index, song.timing);
    const playhead = document.createElementNS(SVG_NS, 'line');
    playhead.setAttribute('class', 'score-playhead');
    playhead.setAttribute('y1', String(Math.min(...engraved.staffTops.values()) - 1.5));
    playhead.setAttribute('y2', String(Math.max(...engraved.staffTops.values()) + 5.5));
    view.svg.appendChild(playhead);
    slot.element.appendChild(view.svg);
    slot.shown = { system, view, glide: new GlideController(view.glides, song.timing), anchors, playhead };
    if (animate) {
      slot.element.classList.remove('score-half-turned');
      void slot.element.offsetWidth;
      slot.element.classList.add('score-half-turned');
    }
  }

  function currentSystem(time: number): number {
    let low = 0, high = starts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (starts[middle] <= time) low = middle + 1; else high = middle;
    }
    return Math.max(0, low - 1);
  }

  function renderNow(): void {
    if (destroyed || !engraving) return;
    const time = video.currentTime;
    const current = currentSystem(time);
    let changed = false;
    slots.forEach((slot, position) => {
      // On phones a line always occupies the half matching its parity.
      const wanted = compact ? (current % 2 === position ? current : current + 1) : current;
      if (slot.shown?.system === wanted) return;
      const turning = compact && slot.shown !== undefined && Math.abs(wanted - slot.shown.system) === 2 && !video.paused;
      show(slot, wanted, turning);
      changed = true;
    });
    if (!changed && time === lastTime) return;
    lastTime = time;
    for (const slot of slots) {
      const shown = slot.shown;
      if (!shown) continue;
      shown.glide.update(time);
      const active = shown.system === current;
      shown.playhead.setAttribute('visibility', active ? 'visible' : 'hidden');
      if (active) {
        const x = String(Math.round(playheadX(shown.anchors, time) * 1000) / 1000);
        shown.playhead.setAttribute('x1', x);
        shown.playhead.setAttribute('x2', x);
      }
    }
    container.style.opacity = String(1 - Math.max(0, Math.min(1, time - finalEnd)));
  }

  let resizeTimer = 0;
  const relayout = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { layout(); renderNow(); }, 120);
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : undefined;
  resizeObserver?.observe(container);
  compactQuery?.addEventListener('change', relayout);
  layout();
  const frames = followPlayback(video, renderNow);
  renderNow();

  return {
    renderNow,
    destroy() {
      destroyed = true;
      frames.stop();
      clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      compactQuery?.removeEventListener('change', relayout);
      container.classList.remove('score-halves');
      container.style.removeProperty('--score-half-aspect');
      container.style.removeProperty('opacity');
      container.replaceChildren();
    }
  };
}
