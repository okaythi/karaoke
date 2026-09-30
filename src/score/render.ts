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
function restValues(start: number, end: number): { start: number; duration: string; dotted: boolean; beats: number }[] {
  const rests = [];
  let at = start;
  while (at + .01 < end) {
    // Break on each beat before choosing the longest conventional rest.
    const toBeat = Math.ceil(at + .001) - at;
    const available = Math.min(end - at, toBeat);
    const [beats, duration, dotted] = values.find(v => v[0] <= available + .001) || values.at(-1)!;
    rests.push({ start: at, duration, dotted, beats });
    at += beats;
  }
  return rests;
}
export function createScoreRenderer(video: HTMLVideoElement, container: HTMLElement, initialNotes: ClassifiedNote[], options: RenderOptions): ScoreRenderController {
  let notes = initialNotes;
  let notation = options.notation;
  const visible: Record<SemanticVoice, boolean> = { main: true, response: true, leftHand: true, ignore: false };
  const beatsPerBar = 3;
  let barsPerPage = 2;
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
    return Math.floor((event?.scoreStart || 0) / (beatsPerBar * barsPerPage));
  };
  const drawPage = (index: number) => {
    page = index; drawId++; mounted = [];
    const firstBar = index * barsPerPage;
    const uncertain = notation.filter(e => e.semanticVoice !== 'ignore' && e.performance.confidence < .75 && e.measure >= firstBar && e.measure < firstBar + barsPerPage).length;
    container.innerHTML = `<div class="score-heading">PIANO SCORE <span>BARS ${firstBar + 1}–${firstBar + barsPerPage} · NOTATION DRAFT${uncertain ? ` · ${uncertain} UNCERTAIN` : ''}</span></div><div class="score-engraving"></div>`;
    const target = container.querySelector('.score-engraving') as HTMLDivElement;
    const width = Math.max(300, target.clientWidth);
    const renderer = new Renderer(target, Renderer.Backends.SVG);
    renderer.resize(width, 320);
    const context = renderer.getContext();
    context.setFillStyle('#9a9183'); context.setStrokeStyle('#686055');
    const svg = target.querySelector('svg') as SVGSVGElement;
    const defs = document.createElementNS(SVG_NS, 'defs'); svg.insertBefore(defs, svg.firstChild);
    const barWidth = (width - 10) / barsPerPage;
    for (const staffInfo of STAFFS) {
      const voice = staffInfo.voice;
      if (!visible[voice]) continue;
      for (let barOnPage = 0; barOnPage < barsPerPage; barOnPage++) {
        const barNumber = firstBar + barOnPage;
        const barStart = barNumber * beatsPerBar, barEnd = barStart + beatsPerBar;
        const stave = new Stave(5 + barOnPage * barWidth, staffInfo.y, barWidth);
        if (barOnPage === 0) { stave.addClef(staffInfo.clef); stave.addKeySignature(options.engravingKeySignature); stave.addTimeSignature('3/4'); }
        stave.setContext(context).draw();
        if (barOnPage === 0) {
          const label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('x', '8'); label.setAttribute('y', String(staffInfo.y + 10));
          label.setAttribute('class', 'score-staff-label'); label.setAttribute('fill', '#9a9183'); label.setAttribute('stroke', 'none');
          label.textContent = staffInfo.label; svg.appendChild(label);
        }
        const parts = segments(notation, voice, barStart, barEnd);
        const groups = chordGroups(parts);
        const startX = stave.getNoteStartX() + 12, endX = stave.getNoteEndX() - 22;
        const beatToX = (beat: number) => startX + Math.max(0, Math.min(1, (beat - barStart) / 3)) * Math.max(15, endX - startX);
        const place = (note: StaveNote, beat: number) => {
          note.setStave(stave).setContext(context);
          new TickContext().addTickable(note).preFormat().setX(beatToX(beat) - stave.getNoteStartX());
        };
        // Construct rests only in gaps of the visible semantic voice.
        let occupied = barStart;
        for (const group of groups) {
          if (group[0].start > occupied + .001) for (const gap of restValues(occupied, group[0].start)) {
            const rest = new StaveNote({ keys: [staffInfo.clef === 'bass' ? 'd/3' : 'b/4'], duration: `${gap.duration}r`, clef: staffInfo.clef });
            if (gap.dotted) Dot.buildAndAttach([rest], { all: true });
            place(rest, gap.start + gap.beats / 2); rest.draw();
            const element = rest.getSVGElement(); if (element) colorGroup(element, '#625b4f');
          }
          occupied = Math.max(occupied, ...group.map(p => p.end));
        }
        if (occupied < barEnd - .001) for (const gap of restValues(occupied, barEnd)) {
          const rest = new StaveNote({ keys: [staffInfo.clef === 'bass' ? 'd/3' : 'b/4'], duration: `${gap.duration}r`, clef: staffInfo.clef });
          if (gap.dotted) Dot.buildAndAttach([rest], { all: true });
          place(rest, gap.start + gap.beats / 2); rest.draw();
          const element = rest.getSVGElement(); if (element) colorGroup(element, '#625b4f');
        }
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
            const bounds = head.getBoundingBox();
            if (part.event.scoreStart < barStart && part.event.scoreStart + part.event.scoreDuration > barStart) {
              const tie = new StaveTie({ lastNote: item.vex, lastIndexes: [keyIndex] }); tie.setContext(context).draw();
            }
            if (part.event.scoreStart + part.event.scoreDuration > barEnd) {
              const tie = new StaveTie({ firstNote: item.vex, firstIndexes: [keyIndex] }); tie.setContext(context).draw();
            }
            const clip = document.createElementNS(SVG_NS, 'clipPath');
            const clipId = `piano-${drawId}-${part.event.performanceId}-${barNumber}`;
            clip.setAttribute('id', clipId); clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(bounds.getX() - 1)); rect.setAttribute('y', String(bounds.getY() - 2));
            rect.setAttribute('height', String(bounds.getH() + 4)); rect.setAttribute('width', '0');
            rect.dataset.noteId = part.event.performanceId; rect.dataset.headWidth = String(bounds.getW() + 2);
            clip.appendChild(rect); defs.appendChild(clip);
            const overlay = base.cloneNode(true) as SVGElement;
            overlay.removeAttribute('id'); overlay.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
            overlay.setAttribute('class', `score-note-highlight voice-${voice}`);
            overlay.setAttribute('clip-path', `url(#${clipId})`);
            colorGroup(overlay, '#e95420'); base.parentElement?.appendChild(overlay);
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
  const onResize = () => { barsPerPage = container.clientWidth < 610 ? 1 : 2; page = -1; renderNow(); };
  const observer = new ResizeObserver(onResize); observer.observe(container); onResize();
  frame = requestAnimationFrame(loop); video.addEventListener('seeked', renderNow);
  return {
    destroy() { destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); video.removeEventListener('seeked', renderNow); container.innerHTML = ''; },
    setNotes(next) { notes = next; notation = linkNotation(next); page = -1; renderNow(); },
    setVoiceVisible(voice, isVisible) { visible[voice] = isVisible; page = -1; renderNow(); },
    renderNow
  };
}
