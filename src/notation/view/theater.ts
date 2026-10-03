/**
 * The score under the video, following playback.
 *
 * Lines of music are engraved to fit the score area: on wide screens one
 * line fills it, and the page turns when playback reaches the next line. On
 * phones in portrait two full-width lines are stacked, as large as the room
 * between the video and the controls allows; when playback moves into one,
 * the one it left is replaced by the line after, so there is always music to
 * read ahead without a full page flip. Every line of a piece shares one
 * vertical frame, so the music keeps one size.
 *
 * Media time is the only clock: every frame reads `video.currentTime`, so
 * seeking and pausing never drift. The next frame is scheduled before
 * drawing, so a failed draw cannot stop the score following playback.
 */
import { engrave } from '../layout/engrave';
import type { Engraving } from '../layout/engrave';
import type { EngravedSystem } from '../layout/system';
import { GlideController } from '../playback/glide';
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
/** Staff spaces of height a wide score area is scaled to hold. */
const WIDE_FRAME = 30;
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

interface Anchor { readonly time: number; readonly x: number }

interface Shown {
  readonly system: number;
  readonly view: RenderedSystem;
  readonly glide: GlideController;
  readonly anchors: readonly Anchor[];
  readonly playhead: SVGLineElement;
  readonly end: { readonly time: number; readonly x: number };
}

interface Slot {
  readonly element: HTMLDivElement;
  shown?: Shown;
}

export function createScoreView(video: HTMLMediaElement, container: HTMLElement, song: SongScore): ScoreViewController {
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
  let finalEnd = 0;
  let frameRequest = 0;
  let destroyed = false;
  let lastTime = NaN;
  let laidOutFor = '';

  /** When a line starts sounding: its earliest note. */
  const systemStart = (system: EngravedSystem): number => {
    let earliest = Infinity;
    for (const item of system.items) for (const ref of item.refs) {
      const timing = song.timing.notes.get(ref);
      if (timing && timing.start < earliest) earliest = timing.start;
    }
    return earliest;
  };

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
      : Math.max(4, rect.height / WIDE_FRAME);
    width = Math.max(24, (slotWidth / spacePx - LEFT_ROOM - MARGIN) * (compact ? 1 : WIDE_SPACING_SCALE));
    engraving = engrave(song.score, { width, settings: song.layout });
    // Include all ink: clipping tall slurs hides a layout error and cuts off music.
    frame = {
      top: Math.min(...engraving.systems.map(system => system.box.y0)),
      bottom: Math.max(...engraving.systems.map(system => system.box.y1))
    };
    starts = engraving.systems.map(systemStart);
    for (let position = starts.length - 2; position >= 0; position--) if (!Number.isFinite(starts[position])) starts[position] = starts[position + 1];
    finalEnd = Math.max(...[...song.timing.notes.values()].map(note => note.soundingEnd));

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
      style, glides: true, margin: MARGIN, frame,
      // Centre the actual line, including its brace, rather than a wider
      // requested extent that may leave unused space on the right.
      extent: compact ? { left: -LEFT_ROOM, right: width } : {
        left: Math.min(engraved.box.x0, 0) - MARGIN,
        right: Math.max(engraved.box.x1, engraved.width)
      },
      title: `Score, bars ${song.score.measures[engraved.first].number}–${song.score.measures[engraved.last].number}`
    });
    view.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const anchors: Anchor[] = [];
    for (const target of view.glides) {
      const timing = song.timing.notes.get(target.noteId);
      if (timing) anchors.push({ time: timing.start, x: (target.box.x0 + target.box.x1) / 2 });
    }
    anchors.sort((a, b) => a.time - b.time || a.x - b.x);
    const next = starts[system + 1];
    const end = { time: Number.isFinite(next) ? next : finalEnd, x: engraved.width };
    const playhead = document.createElementNS(SVG_NS, 'line');
    playhead.setAttribute('class', 'score-playhead');
    playhead.setAttribute('y1', String(Math.min(...engraved.staffTops.values()) - 1.5));
    playhead.setAttribute('y2', String(Math.max(...engraved.staffTops.values()) + 5.5));
    view.svg.appendChild(playhead);
    slot.element.appendChild(view.svg);
    slot.shown = { system, view, glide: new GlideController(view.glides, song.timing), anchors, playhead, end };
    if (animate) {
      slot.element.classList.remove('score-half-turned');
      void slot.element.offsetWidth;
      slot.element.classList.add('score-half-turned');
    }
  }

  /** Playhead position: between the attacks around `time`, then on to the line's end. */
  function playheadX(shown: Shown, time: number): number {
    const points = shown.anchors;
    if (!points.length) return 0;
    if (time <= points[0].time) return points[0].x;
    let low = 1, high = points.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (points[middle].time < time) low = middle + 1; else high = middle;
    }
    if (low < points.length) {
      const before = points[low - 1], after = points[low];
      const span = after.time - before.time;
      return span > 0 ? before.x + (after.x - before.x) * (time - before.time) / span : after.x;
    }
    const last = points.at(-1)!;
    if (time >= shown.end.time || shown.end.time <= last.time) return Math.min(shown.end.x, last.x + (time >= shown.end.time ? shown.end.x - last.x : 0));
    return last.x + (shown.end.x - last.x) * (time - last.time) / (shown.end.time - last.time);
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
        const x = String(Math.round(playheadX(shown, time) * 1000) / 1000);
        shown.playhead.setAttribute('x1', x);
        shown.playhead.setAttribute('x2', x);
      }
    }
    container.style.opacity = String(1 - Math.max(0, Math.min(1, time - finalEnd)));
  }

  const loop = () => {
    if (!destroyed) frameRequest = requestAnimationFrame(loop);
    renderNow();
  };
  let resizeTimer = 0;
  const relayout = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { layout(); renderNow(); }, 120);
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : undefined;
  resizeObserver?.observe(container);
  compactQuery?.addEventListener('change', relayout);
  video.addEventListener('seeked', renderNow);
  layout();
  frameRequest = requestAnimationFrame(loop);
  renderNow();

  return {
    renderNow,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frameRequest);
      clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      compactQuery?.removeEventListener('change', relayout);
      video.removeEventListener('seeked', renderNow);
      container.classList.remove('score-halves');
      container.style.removeProperty('--score-half-aspect');
      container.style.removeProperty('opacity');
      container.replaceChildren();
    }
  };
}
