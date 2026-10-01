import { Accidental, Beam, Dot, Renderer, Stave, StaveNote, StaveTie, TickContext } from 'vexflow';
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
interface MountedHead { note: ClassifiedNote; clipRect: SVGRectElement; headWidth: number }
const STAFFS = [
  { voice: 'main', label: 'MAIN', clef: 'treble', y: 14 },
  { voice: 'response', label: 'RESPONSE', clef: 'treble', y: 116 },
  { voice: 'leftHand', label: 'LEFT HAND', clef: 'bass', y: 218 }
] as const;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const pitchKey = (pitch: number) => `${PITCH_NAMES[pitch % 12]}/${Math.floor(pitch / 12) - 1}`;
const values: [number, string, boolean][] = [[3, 'h', true], [2, 'h', false], [1.5, 'q', true], [1, 'q', false], [.75, '8', true], [.5, '8', false], [.375, '16', true], [.25, '16', false]];
const restDurations: [number, string][] = [[2, 'h'], [1, 'q'], [.5, '8'], [.25, '16'], [.125, '32']];
const BEATS_PER_BAR = 3;
const SYSTEM_HEADER_WIDTH = 135;
const MIN_BAR_WIDTH = 112;
const MAX_BARS_PER_SYSTEM = 7;

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
function segments(events: EngravedEvent[], voice: SemanticVoice, start: number, end: number): Segment[] {
  return events.filter(e => e.semanticVoice === voice && e.scoreStart < end && e.scoreStart + e.scoreDuration > start)
    .map(event => ({ event, start: Math.max(start, event.scoreStart), end: Math.min(end, event.scoreStart + event.scoreDuration) }))
    .sort((a, b) => a.start - b.start || a.event.pitch - b.event.pitch);
}
function chordGroups(parts: Segment[]): Segment[][] {
  const groups: Segment[][] = [];
  for (const part of parts) {
    const previous = groups.at(-1);
    if (previous && previous[0].start === part.start && previous[0].end === part.end &&
        !previous.some(p => p.event.pitch === part.event.pitch)) previous.push(part);
    else groups.push([part]);
  }
  return groups;
}
function restValues(start: number, end: number): { start: number; duration: string; beats: number }[] {
  const rests: { start: number; duration: string; beats: number }[] = [];
  let at = start;
  while (at + .001 < end) {
    const remaining = end - at;
    // A half rest can cover two complete beats; shorter rests stay within
    // their beat so the missing rhythm remains legible in simple 3/4.
    const available = Number.isInteger(at) && remaining >= 2 - .001
      ? 2 : Math.min(remaining, Math.ceil(at + .001) - at);
    const chosen = restDurations.find(([beats]) => beats <= available + .001);
    if (!chosen) throw new Error(`Notation gap cannot be written as rests: ${at}–${end}`);
    const [beats, duration] = chosen;
    rests.push({ start: at, duration, beats });
    at += beats;
  }
  return rests;
}
interface RestPlacement { beat: number; duration: string; kind: 'measure' | 'partial' }
function plannedRests(parts: Segment[], barStart: number, barEnd: number): RestPlacement[] {
  if (!parts.length) return [{ beat: (barStart + barEnd) / 2, duration: 'w', kind: 'measure' }];
  const rests: RestPlacement[] = [];
  let occupied = barStart;
  const addGap = (end: number) => {
    if (end > occupied + .001) for (const rest of restValues(occupied, end)) {
      rests.push({ beat: rest.start + rest.beats / 2, duration: rest.duration, kind: 'partial' });
    }
  };
  for (const part of parts) {
    addGap(part.start);
    occupied = Math.max(occupied, part.end);
  }
  addGap(barEnd);
  return rests;
}
interface ScoreSystem { firstBar: number; widths: number[] }
function barSpacing(events: EngravedEvent[], bar: number): { width: number; xAt: (beat: number) => number } {
  const start = bar * BEATS_PER_BAR;
  const end = start + BEATS_PER_BAR;
  const voiceSymbols = STAFFS.map(staff => {
    const parts = segments(events, staff.voice, start, end);
    const clearance = new Map<number, number>();
    for (const part of parts) clearance.set(part.start, Math.max(clearance.get(part.start) || 0, part.event.dotted ? 32 : 22));
    for (const rest of plannedRests(parts, start, end)) clearance.set(rest.beat, Math.max(clearance.get(rest.beat) || 0, 22));
    return clearance;
  });
  const positions = [...new Set([start, end, ...voiceSymbols.flatMap(voice => [...voice.keys()])])].sort((a, b) => a - b);
  const coordinates = [0];
  const lastForVoice = voiceSymbols.map(() => -1);
  for (let i = 0; i < positions.length; i++) {
    if (i) coordinates[i] = coordinates[i - 1] + 5 + 8 * Math.sqrt(positions[i] - positions[i - 1]);
    voiceSymbols.forEach((voice, index) => {
      if (!voice.has(positions[i])) return;
      if (lastForVoice[index] >= 0) {
        const previous = lastForVoice[index];
        coordinates[i] = Math.max(coordinates[i], coordinates[previous] + (voice.get(positions[previous]) || 22));
      }
      lastForVoice[index] = i;
    });
  }
  const natural = coordinates.at(-1)!;
  const width = Math.max(MIN_BAR_WIDTH, natural + 16);
  const xAt = (beat: number) => {
    let distance = natural;
    for (let i = 0; i < positions.length - 1; i++) {
      if (beat <= positions[i + 1]) {
        distance = coordinates[i] + (coordinates[i + 1] - coordinates[i]) *
          Math.max(0, beat - positions[i]) / (positions[i + 1] - positions[i]);
        break;
      }
    }
    return 8 + distance * (width - 16) / Math.max(natural, 1);
  };
  return { width, xAt };
}
function scoreSystems(events: EngravedEvent[], width: number): ScoreSystem[] {
  const totalBars = Math.ceil(Math.max(0, ...events.map(event => event.scoreStart + event.scoreDuration)) / BEATS_PER_BAR);
  const systems: ScoreSystem[] = [];
  for (let bar = 0; bar < totalBars;) {
    const firstBar = bar;
    const widths: number[] = [];
    let used = SYSTEM_HEADER_WIDTH + 10;
    while (bar < totalBars && widths.length < MAX_BARS_PER_SYSTEM) {
      const measureWidth = barSpacing(events, bar).width;
      if (widths.length && used + measureWidth > width) break;
      widths.push(measureWidth);
      used += measureWidth;
      bar++;
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
  let mounted: MountedHead[] = [];
  let frame = 0;
  let destroyed = false;
  let drawId = 0;
  const pageForTime = (time: number) => {
    let lo = 0, hi = notes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].mediaStartTime <= time) lo = mid + 1; else hi = mid; }
    const last = notes[Math.max(0, lo - 1)];
    const event = notation.find(e => e.performanceId === last?.id);
    const bar = Math.floor((event?.scoreStart || 0) / BEATS_PER_BAR);
    return Math.max(0, systems.findIndex(system => bar >= system.firstBar && bar < system.firstBar + system.widths.length));
  };
  const drawPage = (index: number) => {
    page = index; drawId++; mounted = [];
    const system = systems[index];
    if (!system) return;
    const { firstBar, widths } = system;
    const lastBar = firstBar + widths.length;
    const uncertain = notation.filter(e => e.semanticVoice !== 'ignore' && e.performance.confidence < .75 && e.measure >= firstBar && e.measure < lastBar).length;
    container.innerHTML = `<div class="score-heading">PIANO SCORE <span>BARS ${firstBar + 1}–${lastBar} · NOTATION DRAFT${uncertain ? ` · ${uncertain} UNCERTAIN` : ''}</span></div><div class="score-engraving"></div>`;
    const target = container.querySelector('.score-engraving') as HTMLDivElement;
    const width = Math.max(300, target.clientWidth);
    const renderer = new Renderer(target, Renderer.Backends.SVG);
    renderer.resize(width, 320);
    const context = renderer.getContext();
    context.setFillStyle('#9a9183'); context.setStrokeStyle('#686055');
    const svg = target.querySelector('svg') as SVGSVGElement;
    const defs = document.createElementNS(SVG_NS, 'defs'); svg.insertBefore(defs, svg.firstChild);
    for (const staffInfo of STAFFS) {
      const voice = staffInfo.voice;
      if (!visible[voice]) continue;
      const header = new Stave(5, staffInfo.y, SYSTEM_HEADER_WIDTH);
      header.addClef(staffInfo.clef).addKeySignature(options.engravingKeySignature).addTimeSignature('3/4');
      header.setContext(context).draw();
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', '8'); label.setAttribute('y', String(staffInfo.y + 10));
      label.setAttribute('class', 'score-staff-label'); label.setAttribute('fill', '#9a9183'); label.setAttribute('stroke', 'none');
      label.textContent = staffInfo.label; svg.appendChild(label);
      let measureX = 5 + SYSTEM_HEADER_WIDTH;
      for (let barOnPage = 0; barOnPage < widths.length; barOnPage++) {
        const barNumber = firstBar + barOnPage;
        const barStart = barNumber * BEATS_PER_BAR, barEnd = barStart + BEATS_PER_BAR;
        const stave = new Stave(measureX, staffInfo.y, widths[barOnPage]);
        measureX += widths[barOnPage];
        stave.setContext(context).draw();
        const parts = segments(notation, voice, barStart, barEnd);
        const groups = chordGroups(parts);
        const spacing = barSpacing(notation, barNumber);
        const beatToX = (beat: number) => stave.getNoteStartX() + spacing.xAt(beat);
        const place = (note: StaveNote, beat: number) => {
          note.setStave(stave).setContext(context);
          new TickContext().addTickable(note).preFormat().setX(beatToX(beat) - stave.getNoteStartX());
        };
        const drawRest = (beat: number, duration: string, kind: 'measure' | 'partial') => {
          const rest = new StaveNote({ keys: [staffInfo.clef === 'bass' ? 'd/3' : 'b/4'], duration: `${duration}r`, clef: staffInfo.clef });
          place(rest, beat); rest.draw();
          const element = rest.getSVGElement();
          if (element) {
            element.dataset.restKind = kind;
            element.dataset.measure = String(barNumber);
            element.dataset.voice = voice;
            colorGroup(element, '#625b4f');
          }
        };
        // A whole rest marks a silent 3/4 measure; partial rests cover only
        // notation gaps in this staff, never raw MIDI release gaps.
        for (const rest of plannedRests(parts, barStart, barEnd)) drawRest(rest.beat, rest.duration, rest.kind);
        const engraved: { vex: StaveNote; group: Segment[] }[] = [];
        for (const group of groups) {
          const scoreDuration = group[0].end - group[0].start;
          const [_, duration, dotted] = values.reduce((best, item) => Math.abs(item[0] - scoreDuration) < Math.abs(best[0] - scoreDuration) ? item : best);
          const vex = new StaveNote({ keys: group.map(p => p.event.spelling || pitchKey(p.event.pitch)), duration, clef: staffInfo.clef, autoStem: true });
          if (dotted) Dot.buildAndAttach([vex], { all: true });
          group.forEach((part, keyIndex) => {
            const chromatic = part.event.pitch % 12;
            if ([0, 2, 5, 7].includes(chromatic)) vex.addModifier(new Accidental('n'), keyIndex);
            if (chromatic === 10) vex.addModifier(new Accidental('#'), keyIndex);
          });
          place(vex, group[0].start);
          engraved.push({ vex, group });
        }
        // Beaming follows the notated beat; it never follows MP4 milliseconds.
        let beamRun: StaveNote[] = [], beamBeat = -1;
        const beams: Beam[] = [];
        const flush = () => { if (beamRun.length >= 2) { try { beams.push(new Beam(beamRun)); } catch (_) {} } beamRun = []; };
        for (const item of engraved) {
          const duration = item.vex.getDuration();
          const beat = Math.floor(item.group[0].start);
          if (!['8', '16'].includes(duration) || beat !== beamBeat || beamRun.length >= 4) flush();
          if (['8', '16'].includes(duration)) beamRun.push(item.vex);
          beamBeat = beat;
        }
        flush();
        for (const item of engraved) {
          item.vex.draw();
          const base = item.vex.getSVGElement(); if (!base) continue;
          colorGroup(base, voice === 'leftHand' ? '#686055' : voice === 'response' ? '#9a9183' : '#b3a99a');
          item.group.forEach((part, keyIndex) => {
            const head = item.vex.noteHeads[keyIndex]; if (!head) return;
            const headElement = head.getSVGElement(); if (!headElement) return;
            const sourceId = part.event.performanceId;
            if (sourceId !== part.event.performance.id) throw new Error(`Rendered note source mismatch: ${sourceId}`);
            headElement.dataset.sourceId = sourceId;
            const bounds = head.getBoundingBox();
            if (part.event.scoreStart < barStart && part.event.scoreStart + part.event.scoreDuration > barStart) {
              const tie = new StaveTie({ lastNote: item.vex, lastIndexes: [keyIndex] }); tie.setContext(context).draw();
            }
            if (part.event.scoreStart + part.event.scoreDuration > barEnd) {
              const tie = new StaveTie({ firstNote: item.vex, firstIndexes: [keyIndex] }); tie.setContext(context).draw();
            }
            const clip = document.createElementNS(SVG_NS, 'clipPath');
            const clipId = `piano-${drawId}-${sourceId}-${barNumber}`;
            clip.setAttribute('id', clipId); clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(bounds.getX() - 1)); rect.setAttribute('y', String(bounds.getY() - 2));
            rect.setAttribute('height', String(bounds.getH() + 4)); rect.setAttribute('width', '0');
            rect.dataset.sourceId = sourceId; rect.dataset.noteId = sourceId; rect.dataset.headWidth = String(bounds.getW() + 2);
            clip.appendChild(rect); defs.appendChild(clip);
            const overlay = headElement.cloneNode(true) as SVGElement;
            overlay.removeAttribute('id'); overlay.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
            overlay.setAttribute('class', `score-note-highlight voice-${voice}`);
            overlay.dataset.sourceId = sourceId;
            overlay.setAttribute('clip-path', `url(#${clipId})`);
            colorGroup(overlay, '#e95420'); headElement.parentElement?.appendChild(overlay);
            mounted.push({ note: part.event.performance, clipRect: rect, headWidth: bounds.getW() + 2 });
          });
        }
        for (const beam of beams) { try { beam.setContext(context).draw(); const el = beam.getSVGElement(); if (el) colorGroup(el, '#9a9183'); } catch (_) {} }
      }
    }
  };
  const renderNow = () => {
    if (destroyed) return;
    const time = video.currentTime;
    const next = pageForTime(time); if (next !== page) drawPage(next);
    for (const { note, clipRect, headWidth } of mounted) {
      const progress = clampProgress(time, note.mediaStartTime, note.mediaSoundingEndTime);
      clipRect.setAttribute('width', String(progress * headWidth)); clipRect.dataset.progress = String(progress);
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
