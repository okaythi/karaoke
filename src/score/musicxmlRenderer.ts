import { Accidental, Beam, Dot, Formatter, Renderer, Stave, StaveNote, TextBracket, Tuplet, Voice } from 'vexflow';
import musicXml from '../data/score/itsumo-final.musicxml?raw';
import timingMap from '../data/score/itsumo-karaoke-map.json';

interface Fragment { measure: number; offsetTicks: number; durationTicks: number; voice: number; staff: number; tie: string | null }
interface MapNote { id: string; midi: number; audioStart: number; audioEnd: number; staff: number; segments: Fragment[] }
interface Group { audioStart: number; noteIds: string[] }
interface WrittenEvent {
  measure: number; offset: number; duration: number; voice: number; staff: number;
  type: string; dots: number; tuplet?: { actual: number; normal: number };
  rest: boolean; pitches: { sounding: number; key: string; id?: string }[];
}
interface OctaveSpan { staff: number; start: number; end: number; shift: number }
interface Mounted { rect: SVGRectElement; x: number; width: number; note: MapNote; from: number; to: number }
interface Drawn { event: WrittenEvent; vex: StaveNote }

const NS = 'http://www.w3.org/2000/svg';
const notes = timingMap.notes as MapNote[];
const groups = timingMap.timelineGroups as Group[];
const byId = new Map(notes.map(note => [note.id, note]));
const BAR_TICKS = timingMap.score.measureTicks;
const BARS_PER_PAGE = 4;
const LEFT = 86;
const BAR_WIDTH = 215;
const STAFF_TOP = [0, 76, 202];
const PASTEL_PINK = '#ffe0ed';
const PASTEL_BLUE = '#dcefff';
const DURATION: Record<string, string> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32' };
const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function childText(parent: Element, selector: string): string | null {
  return parent.querySelector(selector)?.textContent ?? null;
}

function parseScore(): { events: WrittenEvent[]; octaves: OctaveSpan[] } {
  const doc = new DOMParser().parseFromString(musicXml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid Itsumo MusicXML');
  const events: WrittenEvent[] = [];
  const octaves: OctaveSpan[] = [];
  doc.querySelectorAll('part').forEach((part, partIndex) => {
    const active = new Map<string, { staff: number; start: number; shift: number }>();
    part.querySelectorAll(':scope > measure').forEach(measure => {
      let cursor = 0;
      let previous = 0;
      const number = Number(measure.getAttribute('number'));
      for (const child of Array.from(measure.children)) {
        if (child.tagName === 'backup') { cursor -= Number(childText(child, ':scope > duration') || 0); continue; }
        if (child.tagName === 'forward') { cursor += Number(childText(child, ':scope > duration') || 0); continue; }
        if (child.tagName === 'direction') {
          const staff = Number(childText(child, ':scope > staff') || partIndex + 1);
          const at = (number - 1) * BAR_TICKS + cursor + Number(childText(child, ':scope > offset') || 0);
          child.querySelectorAll(':scope > direction-type > octave-shift').forEach(shift => {
            const key = `${staff}:${shift.getAttribute('number') || '1'}`;
            const kind = shift.getAttribute('type');
            if (kind === 'stop') {
              const open = active.get(key);
              if (open) octaves.push({ ...open, end: at });
              active.delete(key);
            } else if (kind === 'down' || kind === 'up') {
              const size = Number(shift.getAttribute('size') || 8);
              const octavesCount = size === 15 ? 2 : 1;
              active.set(key, { staff, start: at, shift: (kind === 'down' ? -1 : 1) * 12 * octavesCount });
            }
          });
          continue;
        }
        if (child.tagName !== 'note') continue;
        const duration = Number(childText(child, ':scope > duration') || 0);
        const chord = child.querySelector(':scope > chord') !== null;
        const offset = chord ? previous : cursor;
        if (!chord) previous = cursor;
        const type = childText(child, ':scope > type');
        if (!type || !DURATION[type]) throw new Error(`Unsupported MusicXML note type ${type} in measure ${number}`);
        const voice = Number(childText(child, ':scope > voice') || 1);
        const staff = Number(childText(child, ':scope > staff') || partIndex + 1);
        const dots = child.querySelectorAll(':scope > dot').length;
        const modification = child.querySelector(':scope > time-modification');
        const tuplet = modification ? {
          actual: Number(childText(modification, ':scope > actual-notes')),
          normal: Number(childText(modification, ':scope > normal-notes'))
        } : undefined;
        const rest = child.querySelector(':scope > rest') !== null;
        const event = chord ? events.findLast(item => item.measure === number && item.offset === offset && item.voice === voice && item.staff === staff && !item.rest) : undefined;
        if (chord && (!event || event.duration !== duration || event.type !== type)) throw new Error(`Invalid MusicXML chord in measure ${number}`);
        const target = event || { measure: number, offset, duration, voice, staff, type, dots, tuplet, rest, pitches: [] };
        if (!rest) {
          const pitch = child.querySelector(':scope > pitch');
          const step = childText(pitch!, ':scope > step')?.toUpperCase();
          const alter = Number(childText(pitch!, ':scope > alter') || 0);
          const octave = Number(childText(pitch!, ':scope > octave'));
          if (!step || STEP_SEMITONES[step] === undefined || !Number.isInteger(octave)) throw new Error(`Invalid pitch in measure ${number}`);
          const sounding = (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
          const at = (number - 1) * BAR_TICKS + offset;
          const shift = [...active.values()].filter(item => item.staff === staff && item.start <= at).reduce((sum, item) => sum + item.shift, 0);
          const writtenOctave = octave + shift / 12;
          const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
          target.pitches.push({ sounding, key: `${step.toLowerCase()}${accidental}/${writtenOctave}` });
        }
        if (!event) events.push(target);
        if (!chord) cursor += duration;
      }
    });
    for (const open of active.values()) octaves.push({ ...open, end: timingMap.score.measures * BAR_TICKS });
  });
  return { events, octaves };
}

const score = parseScore();
function matchScore(): void {
  const lookup = new Map<string, { event: WrittenEvent; index: number }[]>();
  for (const event of score.events) event.pitches.forEach((pitch, index) => {
    const key = [event.measure, event.offset, event.duration, event.voice, event.staff, pitch.sounding].join(':');
    const bucket = lookup.get(key) || [];
    bucket.push({ event, index }); lookup.set(key, bucket);
  });
  for (const note of notes) for (const segment of note.segments) {
    const key = [segment.measure, segment.offsetTicks, segment.durationTicks, segment.voice, segment.staff, note.midi].join(':');
    const match = lookup.get(key)?.shift();
    if (!match) throw new Error(`MusicXML fragment missing for ${note.id}: ${key}`);
    match.event.pitches[match.index].id = note.id;
  }
  if ([...lookup.values()].some(bucket => bucket.length)) throw new Error('MusicXML has notes absent from the karaoke map');
}
matchScore();

function groupAt(time: number): Group | undefined {
  let lo = 0, hi = groups.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (groups[mid].audioStart <= time) lo = mid + 1; else hi = mid; }
  return groups[Math.max(0, lo - 1)];
}

function colorGroup(group: SVGElement, color: string): void {
  group.setAttribute('fill', color); group.setAttribute('stroke', color);
  group.querySelectorAll<SVGElement>('path,ellipse,circle,line,polygon,polyline,text').forEach(shape => {
    if (shape.getAttribute('fill') !== 'none') shape.setAttribute('fill', color);
    if (shape.getAttribute('stroke') !== 'none') shape.setAttribute('stroke', color);
  });
}

function buildMeasure(events: WrittenEvent[], stave: Stave): { voices: Voice[]; drawn: Drawn[]; beams: Beam[]; tuplets: Tuplet[] } {
  const drawn: Drawn[] = [];
  const beams: Beam[] = [];
  const tuplets: Tuplet[] = [];
  const byVoice = new Map<number, WrittenEvent[]>();
  for (const event of events) {
    const voice = byVoice.get(event.voice) || [];
    voice.push(event); byVoice.set(event.voice, voice);
  }
  const voices = [...byVoice.values()].map(line => {
    line.sort((a, b) => a.offset - b.offset);
    const tickables: StaveNote[] = [];
    let beamRun: { note: StaveNote; end: number; beat: number }[] = [];
    let tupletRun: { note: StaveNote; event: WrittenEvent }[] = [];
    const flushBeam = () => { if (beamRun.length > 1) beams.push(new Beam(beamRun.map(item => item.note))); beamRun = []; };
    const flushTuplet = () => {
      if (tupletRun.length) {
        const first = tupletRun[0].event.tuplet!;
        tuplets.push(new Tuplet(tupletRun.map(item => item.note), { numNotes: first.actual, notesOccupied: first.normal }));
        tupletRun = [];
      }
    };
    for (const event of line) {
      const duration = DURATION[event.type] + (event.rest ? 'r' : '');
      const vex = new StaveNote({ keys: event.rest ? [event.staff === 1 ? 'b/4' : 'd/3'] : event.pitches.map(p => p.key), duration,
        dots: event.dots, clef: event.staff === 1 ? 'treble' : 'bass', autoStem: true });
      vex.setStave(stave);
      if (event.dots) for (let i = 0; i < event.dots; i++) Dot.buildAndAttach([vex], { all: true });
      tickables.push(vex); drawn.push({ event, vex });
      if (event.tuplet) {
        if (tupletRun.length && (tupletRun[0].event.tuplet!.actual !== event.tuplet.actual ||
          tupletRun[0].event.tuplet!.normal !== event.tuplet.normal ||
          tupletRun.at(-1)!.event.offset + tupletRun.at(-1)!.event.duration !== event.offset)) flushTuplet();
        tupletRun.push({ note: vex, event });
        if (tupletRun.length >= event.tuplet.actual) flushTuplet();
      } else flushTuplet();
      const short = ['eighth', '16th', '32nd'].includes(event.type) && !event.rest;
      const beat = Math.floor(event.offset / (BAR_TICKS / 3));
      if (!short || (beamRun.length && (beamRun.at(-1)!.end !== event.offset || beamRun.at(-1)!.beat !== beat))) flushBeam();
      if (short) beamRun.push({ note: vex, end: event.offset + event.duration, beat });
    }
    flushBeam(); flushTuplet();
    const voice = new Voice({ numBeats: 3, beatValue: 4 });
    voice.setMode(Voice.Mode.SOFT);
    voice.addTickables(tickables);
    return voice;
  });
  return { voices, drawn, beams, tuplets };
}

export interface MusicXmlScoreController { destroy(): void; renderNow(): void }

export function createMusicXmlScoreRenderer(video: HTMLVideoElement, container: HTMLElement): MusicXmlScoreController {
  let page = -1;
  let mounted: Mounted[] = [];
  let frame = 0;
  let destroyed = false;

  function draw(nextPage: number): void {
    page = nextPage; mounted = [];
    container.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'score-heading';
    heading.innerHTML = `ITSUMO NANDO DEMO <span>BARS ${page * BARS_PER_PAGE + 1}–${Math.min((page + 1) * BARS_PER_PAGE, timingMap.score.measures)} · MUSICXML</span>`;
    const engraving = document.createElement('div'); engraving.className = 'score-engraving';
    const width = LEFT + BAR_WIDTH * BARS_PER_PAGE + 12;
    const renderer = new Renderer(engraving, Renderer.Backends.SVG);
    renderer.resize(width, 340);
    const context = renderer.getContext();
    context.setFillStyle('#9a9183'); context.setStrokeStyle('#686055');
    const root = engraving.querySelector('svg') as SVGSVGElement;
    root.setAttribute('viewBox', `0 0 ${width} 340`);
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', 'Itsumo Nando Demo two staff music score');
    const defs = document.createElementNS(NS, 'defs'); root.insertBefore(defs, root.firstChild);
    const staves = new Map<number, Stave>();
    for (const staff of [1, 2]) {
      const stave = new Stave(12, STAFF_TOP[staff], width - 24);
      stave.addClef(staff === 1 ? 'treble' : 'bass').addKeySignature('E');
      stave.setContext(context).draw(); staves.set(staff, stave);
    }
    // Keep the score's established linear tick-to-x placement. Formatting is
    // used for musical geometry, then every tick context is fixed to this grid.
    for (let bar = 0; bar <= BARS_PER_PAGE; bar++) {
      context.setStrokeStyle('#686055'); context.setLineWidth(1);
      context.beginPath(); context.moveTo(LEFT + bar * BAR_WIDTH, STAFF_TOP[1]);
      context.lineTo(LEFT + bar * BAR_WIDTH, STAFF_TOP[2] + 40); context.stroke();
    }
    const drawn: Drawn[] = [];
    const beams: Beam[] = [];
    const tuplets: Tuplet[] = [];
    for (let bar = 0; bar < BARS_PER_PAGE; bar++) {
      const measure = page * BARS_PER_PAGE + bar + 1;
      const allVoices: Voice[] = [];
      for (const staff of [1, 2]) {
        const material = buildMeasure(score.events.filter(event => event.measure === measure && event.staff === staff), staves.get(staff)!);
        if (material.voices.length) Accidental.applyAccidentals(material.voices, 'E');
        allVoices.push(...material.voices); drawn.push(...material.drawn); beams.push(...material.beams); tuplets.push(...material.tuplets);
      }
      if (!allVoices.length) continue;
      const formatter = new Formatter();
      formatter.joinVoices(allVoices);
      formatter.format(allVoices, BAR_WIDTH - 32);
      for (const item of drawn.filter(item => item.event.measure === measure)) {
        const x = LEFT + bar * BAR_WIDTH + 16 + item.event.offset / BAR_TICKS * (BAR_WIDTH - 32);
        item.vex.checkTickContext().setX(x);
      }
    }
    for (const { event, vex } of drawn) {
      vex.setContext(context).draw();
      const base = vex.getSVGElement(); if (!base) continue;
      colorGroup(base, event.rest ? '#686055' : '#b3a99a');
      if (event.rest) continue;
      event.pitches.forEach((pitch, index) => {
        const note = pitch.id ? byId.get(pitch.id) : undefined;
        if (!note) throw new Error(`Missing karaoke note for measure ${event.measure}`);
        const head = vex.noteHeads[index]?.getSVGElement();
        if (!head) return;
        const source = event.pitches.length === 1 ? base : head;
        const bounds = (source as SVGGraphicsElement).getBBox();
        const x = LEFT + (event.measure - 1 - page * BARS_PER_PAGE) * BAR_WIDTH + 16 + event.offset / BAR_TICKS * (BAR_WIDTH - 32);
        const clip = document.createElementNS(NS, 'clipPath');
        const clipId = `itsumo-${page}-${pitch.id}-${event.measure}-${index}`;
        clip.setAttribute('id', clipId); clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', String(x - 11)); rect.setAttribute('y', String(bounds.y - 2));
        rect.setAttribute('width', '0'); rect.setAttribute('height', String(bounds.height + 4));
        clip.appendChild(rect); defs.appendChild(clip);
        const overlay = source.cloneNode(true) as SVGElement;
        overlay.removeAttribute('id'); overlay.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
        overlay.classList.add('score-note-highlight'); overlay.setAttribute('clip-path', `url(#${clipId})`);
        colorGroup(overlay, event.staff === 1 ? PASTEL_PINK : PASTEL_BLUE);
        source.parentElement?.appendChild(overlay);
        let preceding = 0;
        const total = note.segments.reduce((sum, fragment) => sum + fragment.durationTicks, 0);
        for (const fragment of note.segments) {
          const from = preceding / total; preceding += fragment.durationTicks;
          if (fragment.measure === event.measure && fragment.offsetTicks === event.offset) {
            mounted.push({ rect, x: x - 11, width: 43, note, from, to: preceding / total });
            break;
          }
        }
      });
    }
    for (const beam of beams) { beam.setContext(context).draw(); const element = beam.getSVGElement(); if (element) colorGroup(element, '#b3a99a'); }
    for (const tuplet of tuplets) { tuplet.setContext(context).draw(); const element = tuplet.getSVGElement(); if (element) colorGroup(element, '#b3a99a'); }
    for (const span of score.octaves) {
      const startMeasure = Math.floor(span.start / BAR_TICKS) + 1;
      const endMeasure = Math.floor(Math.max(span.start, span.end - 1) / BAR_TICKS) + 1;
      if (endMeasure < page * BARS_PER_PAGE + 1 || startMeasure > (page + 1) * BARS_PER_PAGE) continue;
      const affected = drawn.filter(item => item.event.staff === span.staff &&
        (item.event.measure - 1) * BAR_TICKS + item.event.offset >= span.start &&
        (item.event.measure - 1) * BAR_TICKS + item.event.offset < span.end && !item.event.rest);
      if (!affected.length) continue;
      const bracket = new TextBracket({ start: affected[0].vex, stop: affected.at(-1)!.vex,
        text: span.shift < 0 ? '8' : '8', superscript: span.shift < 0 ? 'va' : 'vb',
        position: span.shift < 0 ? TextBracket.Position.TOP : TextBracket.Position.BOTTOM });
      bracket.setContext(context).draw();
    }
    engraving.appendChild(root); container.appendChild(heading); container.appendChild(engraving);
  }

  function renderNow(): void {
    if (destroyed) return;
    const time = video.currentTime;
    const group = groupAt(time);
    const measure = group ? byId.get(group.noteIds[0])?.segments[0].measure || 1 : 1;
    const nextPage = Math.floor((measure - 1) / BARS_PER_PAGE);
    if (nextPage !== page) draw(nextPage);
    for (const item of mounted) {
      const duration = item.note.audioEnd - item.note.audioStart;
      const progress = duration > 0 ? Math.max(0, Math.min(1, (time - item.note.audioStart) / duration)) : Number(time >= item.note.audioStart);
      const fragmentProgress = Math.max(0, Math.min(1, (progress - item.from) / (item.to - item.from)));
      item.rect.setAttribute('width', String(item.width * fragmentProgress));
    }
  }
  const loop = () => { renderNow(); if (!destroyed) frame = requestAnimationFrame(loop); };
  video.addEventListener('seeked', renderNow);
  frame = requestAnimationFrame(loop);
  renderNow();
  return { renderNow, destroy() { destroyed = true; cancelAnimationFrame(frame); video.removeEventListener('seeked', renderNow); container.replaceChildren(); } };
}
