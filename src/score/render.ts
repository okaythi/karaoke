import { Accidental, Beam, Dot, Formatter, Renderer, Stave, StaveNote, StaveTie, Voice } from 'vexflow';
import { clampProgress } from './model';
import { linkNotation } from './notation';
import type { EngravedEvent } from './notation';
import type { ClassifiedNote, SemanticVoice } from './model';

interface RenderOptions {
  notation: EngravedEvent[];
  engravingKeySignature: string;
  timeSignature: { numerator: number; denominator: number };
}
interface Segment { event: EngravedEvent; start: number; end: number }
interface MountedEvent { note: ClassifiedNote; clipRect: SVGRectElement; width: number }
interface DrawnNote { vex: StaveNote; group: Segment[] }
interface ScoreSystem { firstBar: number; widths: number[] }

const SVG_NS = 'http://www.w3.org/2000/svg';
const BEATS_PER_BAR = 3;
const HEADER_WIDTH = 130;
const MAX_BARS_PER_SYSTEM = 6;
const STAFF_Y = { treble: 10, bass: 150 } as const;
const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const pitchKey = (pitch: number) => `${PITCH_NAMES[pitch % 12]}/${Math.floor(pitch / 12) - 1}`;
const durations: [number, string, boolean][] = [[3, 'h', true], [2, 'h', false], [1.5, 'q', true], [1, 'q', false], [.75, '8', true], [.5, '8', false], [.25, '16', false]];
const restDurations: [number, string][] = [[2, 'h'], [1, 'q'], [.5, '8'], [.25, '16']];

export interface ScoreRenderController {
  destroy(): void;
  setNotes(notes: ClassifiedNote[]): void;
  setVoiceVisible(voice: SemanticVoice, visible: boolean): void;
  renderNow(): void;
}

function colorGroup(group: SVGElement, color: string): void {
  group.setAttribute('fill', color);
  group.setAttribute('stroke', color);
  group.querySelectorAll<SVGElement>('path,ellipse,circle,line,polygon,polyline,text').forEach(shape => {
    if (shape.getAttribute('fill') !== 'none') shape.setAttribute('fill', color);
    if (shape.getAttribute('stroke') !== 'none') shape.setAttribute('stroke', color);
  });
}

function segments(events: EngravedEvent[], staff: 'treble' | 'bass', start: number, end: number, visible: Record<SemanticVoice, boolean>): Segment[] {
  return events.filter(event => event.semanticVoice !== 'ignore' && visible[event.semanticVoice] &&
    (staff === 'bass' ? event.semanticVoice === 'leftHand' : event.semanticVoice !== 'leftHand') &&
    event.scoreStart < end && event.scoreStart + event.scoreDuration > start)
    .flatMap(event => {
      const parts: Segment[] = [];
      let at = Math.max(start, event.scoreStart);
      const stop = Math.min(end, event.scoreStart + event.scoreDuration);
      while (at < stop - .001) {
        const duration = durations.find(([beats]) => beats <= stop - at + .001);
        if (!duration) throw new Error(`Unwritable note fragment at ${at}`);
        parts.push({ event, start: at, end: at + duration[0] });
        at += duration[0];
      }
      return parts;
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.event.pitch - b.event.pitch);
}

// Simultaneous notes with the same written duration form a chord, regardless
// of whether the MIDI classifier calls them main or response.
function chordGroups(parts: Segment[]): Segment[][] {
  const groups: Segment[][] = [];
  for (const part of parts) {
    const group = groups.at(-1);
    if (group && group[0].start === part.start && group[0].end === part.end &&
      !group.some(other => other.event.pitch === part.event.pitch)) group.push(part);
    else groups.push([part]);
  }
  return groups;
}

// VexFlow formats the voices. This partition only expresses overlapping
// rhythmic lines, which a single VexFlow Voice cannot contain.
function partitionVoices(groups: Segment[][]): Segment[][][] {
  const lanes: Segment[][][] = [];
  const ends: number[] = [];
  for (const group of groups) {
    let lane = ends.findIndex(end => end <= group[0].start + .001);
    if (lane < 0) { lane = lanes.length; lanes.push([]); ends.push(-Infinity); }
    lanes[lane].push(group);
    ends[lane] = group[0].end;
  }
  return lanes.length ? lanes : [[]];
}

function addRests(tickables: StaveNote[], from: number, to: number, clef: 'treble' | 'bass'): void {
  let beat = from;
  while (beat < to - .001) {
    const remaining = to - beat;
    const withinBeat = Math.ceil(beat + .001) - beat;
    const available = Number.isInteger(beat) && remaining >= 2 - .001 ? 2 : Math.min(remaining, withinBeat);
    const choice = restDurations.find(([length]) => length <= available + .001);
    if (!choice) throw new Error(`Unwritable notation gap ${from}–${to}`);
    tickables.push(new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: `${choice[1]}r`, clef }));
    beat += choice[0];
  }
}

function buildVoices(parts: Segment[], barStart: number, stave: Stave, clef: 'treble' | 'bass'): { voices: Voice[]; drawn: DrawnNote[]; beams: Beam[] } {
  const drawn: DrawnNote[] = [];
  const beams: Beam[] = [];
  const voices = partitionVoices(chordGroups(parts)).map((lane, laneIndex) => {
    const tickables: StaveNote[] = [];
    const laneNotes: DrawnNote[] = [];
    let beat = barStart;
    for (const group of lane) {
      addRests(tickables, beat, group[0].start, clef);
      const length = group[0].end - group[0].start;
      const notation = durations.find(([value]) => Math.abs(value - length) < .001);
      if (!notation) throw new Error(`Unwritable note duration ${length}`);
      const vex = new StaveNote({
        keys: group.map(part => part.event.spelling || pitchKey(part.event.pitch)),
        duration: notation[1], clef, autoStem: false,
        stemDirection: laneIndex % 2 ? -1 : 1
      });
      if (notation[2]) Dot.buildAndAttach([vex], { all: true });
      group.forEach((part, index) => {
        const chromatic = part.event.pitch % 12;
        if ([0, 2, 5, 7].includes(chromatic)) vex.addModifier(new Accidental('n'), index);
        if (chromatic === 10) vex.addModifier(new Accidental('#'), index);
      });
      tickables.push(vex);
      const item = { vex, group };
      drawn.push(item); laneNotes.push(item);
      beat = group[0].end;
    }
    addRests(tickables, beat, barStart + BEATS_PER_BAR, clef);
    let run: StaveNote[] = [], runBeat = -1, previousEnd = -Infinity;
    const flush = () => { if (run.length > 1) beams.push(new Beam(run)); run = []; };
    for (const item of laneNotes) {
      const currentBeat = Math.floor(item.group[0].start);
      if (!['8', '16'].includes(item.vex.getDuration()) || currentBeat !== runBeat ||
        item.group[0].start > previousEnd + .001) flush();
      if (['8', '16'].includes(item.vex.getDuration())) run.push(item.vex);
      runBeat = currentBeat;
      previousEnd = item.group[0].end;
    }
    flush();
    return new Voice({ numBeats: BEATS_PER_BAR, beatValue: 4 }).addTickables(tickables).setStave(stave);
  });
  return { voices, drawn, beams };
}

function measureWidth(events: EngravedEvent[], bar: number): number {
  const start = bar * BEATS_PER_BAR;
  const parts = events.filter(event => event.semanticVoice !== 'ignore' && event.scoreStart < start + BEATS_PER_BAR && event.scoreStart + event.scoreDuration > start);
  const attacks = new Set(parts.map(event => Math.max(start, event.scoreStart)));
  return Math.max(132, 38 + attacks.size * 35 + Math.min(70, parts.length * 6));
}

function scoreSystems(events: EngravedEvent[], width: number): ScoreSystem[] {
  const totalBars = Math.ceil(Math.max(0, ...events.map(event => event.scoreStart + event.scoreDuration)) / BEATS_PER_BAR);
  const systems: ScoreSystem[] = [];
  for (let bar = 0; bar < totalBars;) {
    const firstBar = bar;
    const widths: number[] = [];
    let used = HEADER_WIDTH + 12;
    while (bar < totalBars && widths.length < MAX_BARS_PER_SYSTEM) {
      const measure = measureWidth(events, bar);
      if (widths.length && used + measure > width) break;
      widths.push(measure); used += measure; bar++;
    }
    systems.push({ firstBar, widths });
  }
  return systems;
}

export function createScoreRenderer(video: HTMLVideoElement, container: HTMLElement, initialNotes: ClassifiedNote[], options: RenderOptions): ScoreRenderController {
  let notes = initialNotes;
  let notation = options.notation;
  const visible: Record<SemanticVoice, boolean> = { main: true, response: true, leftHand: true, ignore: false };
  let systems: ScoreSystem[] = [];
  let page = -1;
  let mounted: MountedEvent[] = [];
  let frame = 0;
  let destroyed = false;
  let drawId = 0;

  const pageForTime = (time: number) => {
    let lo = 0, hi = notes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].mediaStartTime <= time) lo = mid + 1; else hi = mid; }
    const event = notation.find(item => item.performanceId === notes[Math.max(0, lo - 1)]?.id);
    const bar = Math.floor((event?.scoreStart || 0) / BEATS_PER_BAR);
    return Math.max(0, systems.findIndex(system => bar >= system.firstBar && bar < system.firstBar + system.widths.length));
  };

  const drawPage = (index: number) => {
    page = index; drawId++; mounted = [];
    const system = systems[index]; if (!system) return;
    const { firstBar, widths } = system;
    const lastBar = firstBar + widths.length;
    const uncertain = notation.filter(event => event.semanticVoice !== 'ignore' && event.performance.confidence < .75 && event.measure >= firstBar && event.measure < lastBar).length;
    container.innerHTML = `<div class="score-heading">PIANO SCORE <span>BARS ${firstBar + 1}–${lastBar} · NOTATION DRAFT${uncertain ? ` · ${uncertain} UNCERTAIN` : ''}</span></div><div class="score-engraving"></div>`;
    const target = container.querySelector('.score-engraving') as HTMLDivElement;
    const viewportWidth = Math.max(300, target.clientWidth);
    const contentWidth = HEADER_WIDTH + widths.reduce((sum, width) => sum + width, 0) + 12;
    const renderer = new Renderer(target, Renderer.Backends.SVG);
    renderer.resize(Math.max(viewportWidth, contentWidth), 270);
    const context = renderer.getContext();
    context.setFillStyle('#9a9183'); context.setStrokeStyle('#686055');
    const svg = target.querySelector('svg') as SVGSVGElement;
    svg.setAttribute('viewBox', `0 0 ${Math.max(viewportWidth, contentWidth)} 270`);
    const defs = document.createElementNS(SVG_NS, 'defs'); svg.insertBefore(defs, svg.firstChild);
    const tiedFragments = new Map<string, { note: StaveNote; index: number; start: number; end: number; bar: number; event: EngravedEvent }[]>();

    let x = 5;
    for (let offset = 0; offset < widths.length; offset++) {
      const bar = firstBar + offset;
      const barStart = bar * BEATS_PER_BAR;
      const first = offset === 0;
      const measureW = widths[offset] + (first ? HEADER_WIDTH : 0);
      const treble = new Stave(x, STAFF_Y.treble, measureW);
      const bass = new Stave(x, STAFF_Y.bass, measureW);
      if (first) {
        treble.addClef('treble').addKeySignature(options.engravingKeySignature).addTimeSignature(`${options.timeSignature.numerator}/${options.timeSignature.denominator}`);
        bass.addClef('bass').addKeySignature(options.engravingKeySignature).addTimeSignature(`${options.timeSignature.numerator}/${options.timeSignature.denominator}`);
      }
      treble.setContext(context).draw(); bass.setContext(context).draw();
      bass.setNoteStartX(treble.getNoteStartX());
      const upper = buildVoices(segments(notation, 'treble', barStart, barStart + BEATS_PER_BAR, visible), barStart, treble, 'treble');
      const lower = buildVoices(segments(notation, 'bass', barStart, barStart + BEATS_PER_BAR, visible), barStart, bass, 'bass');
      const voices = [...upper.voices, ...lower.voices];
      voices.forEach(voice => voice.preFormat());
      const formatter = new Formatter();
      formatter.joinVoices(upper.voices).joinVoices(lower.voices);
      formatter.format(voices, treble.getNoteEndX() - treble.getNoteStartX() - Stave.defaultPadding, { alignRests: true, context });
      formatter.postFormat();
      voices.forEach(voice => voice.draw(context));

      for (const { vex, group } of [...upper.drawn, ...lower.drawn]) {
        const base = vex.getSVGElement(); if (!base) continue;
        const voice = group[0].event.semanticVoice;
        colorGroup(base, voice === 'leftHand' ? '#686055' : voice === 'response' ? '#9a9183' : '#b3a99a');
        group.forEach((part, keyIndex) => {
          const head = vex.noteHeads[keyIndex];
          const headElement = head?.getSVGElement(); if (!head || !headElement) return;
          const sourceId = part.event.performanceId;
          if (sourceId !== part.event.performance.id) throw new Error(`Rendered note source mismatch: ${sourceId}`);
          headElement.dataset.sourceId = sourceId;
          colorGroup(headElement, part.event.semanticVoice === 'leftHand' ? '#686055' : part.event.semanticVoice === 'response' ? '#9a9183' : '#b3a99a');
          const source = group.length === 1 ? base : headElement;
          const bounds = (source as SVGGraphicsElement).getBBox();
          const clip = document.createElementNS(SVG_NS, 'clipPath');
          const clipId = `piano-${drawId}-${sourceId}-${bar}`;
          clip.setAttribute('id', clipId); clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
          const rect = document.createElementNS(SVG_NS, 'rect');
          rect.setAttribute('x', String(bounds.x - 1)); rect.setAttribute('y', String(bounds.y - 2));
          rect.setAttribute('height', String(bounds.height + 4)); rect.setAttribute('width', '0');
          rect.dataset.sourceId = sourceId; rect.dataset.noteId = sourceId;
          clip.appendChild(rect); defs.appendChild(clip);
          const overlay = source.cloneNode(true) as SVGElement;
          overlay.removeAttribute('id'); overlay.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
          overlay.setAttribute('class', `score-note-highlight voice-${part.event.semanticVoice}`);
          overlay.dataset.sourceId = sourceId;
          overlay.setAttribute('clip-path', `url(#${clipId})`);
          colorGroup(overlay, '#e95420'); base.parentElement?.appendChild(overlay);
          mounted.push({ note: part.event.performance, clipRect: rect, width: bounds.width + 2 });
          const fragments = tiedFragments.get(sourceId) || [];
          fragments.push({ note: vex, index: keyIndex, start: part.start, end: part.end, bar, event: part.event });
          tiedFragments.set(sourceId, fragments);
        });
      }
      for (const beam of [...upper.beams, ...lower.beams]) {
        beam.setContext(context).draw();
        const element = beam.getSVGElement(); if (element) colorGroup(element, '#9a9183');
      }
      x += measureW;
    }
    for (const fragments of tiedFragments.values()) {
      fragments.sort((a, b) => a.start - b.start);
      for (let i = 0; i < fragments.length; i++) {
        const current = fragments[i];
        const previous = fragments[i - 1];
        const next = fragments[i + 1];
        if (!previous && current.event.scoreStart < current.start) {
          new StaveTie({ lastNote: current.note, lastIndexes: [current.index] }).setContext(context).draw();
        }
        if (next) {
          new StaveTie({ firstNote: current.note, lastNote: next.note, firstIndexes: [current.index], lastIndexes: [next.index] }).setContext(context).draw();
        } else if (current.event.scoreStart + current.event.scoreDuration > current.end) {
          new StaveTie({ firstNote: current.note, firstIndexes: [current.index] }).setContext(context).draw();
        }
      }
    }
  };

  const renderNow = () => {
    if (destroyed) return;
    const time = video.currentTime;
    const next = pageForTime(time); if (next !== page) drawPage(next);
    for (const { note, clipRect, width } of mounted) {
      const progress = clampProgress(time, note.mediaStartTime, note.mediaSoundingEndTime);
      clipRect.setAttribute('width', String(progress * width)); clipRect.dataset.progress = String(progress);
    }
  };
  const loop = () => { renderNow(); if (!destroyed) frame = requestAnimationFrame(loop); };
  const onResize = () => {
    const target = container.querySelector('.score-engraving') as HTMLElement | null;
    systems = scoreSystems(notation, Math.max(300, target?.clientWidth || container.clientWidth - 32));
    page = -1; renderNow();
  };
  const observer = new ResizeObserver(onResize); observer.observe(container); onResize();
  frame = requestAnimationFrame(loop); video.addEventListener('seeked', renderNow);
  return {
    destroy() { destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); video.removeEventListener('seeked', renderNow); container.innerHTML = ''; },
    setNotes(next) { notes = next; notation = linkNotation(next); onResize(); },
    setVoiceVisible(voice, isVisible) { visible[voice] = isVisible; page = -1; renderNow(); },
    renderNow
  };
}
