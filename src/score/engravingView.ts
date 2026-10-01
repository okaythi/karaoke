import { Accidental, Beam, Clef, Dot, Formatter, GhostNote, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Stroke, TextBracket, Tuplet, Voice } from 'vexflow';
import { engravingScore } from './engravingModel';
import type { EngravingNote, EngravingScore, SourceNote } from './engravingModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BAR_TICKS = 1440;
const STAFF_Y = { 1: 94, 2: 222 } as const;
const STAFF_COLOR = { 1: '#de8adc', 2: '#6fccd9' } as const;

interface Drawn {
  model: EngravingNote;
  vex: StaveNote;
}

export interface NoteAnchor {
  sourceId: string;
  audioStart: number;
  x: number;
  measure: number;
}

export interface HighlightTarget {
  source: SourceNote;
  clip: SVGRectElement;
  left: number;
  width: number;
  from: number;
  to: number;
}

export interface EngravingPage {
  anchors: NoteAnchor[];
  highlights: HighlightTarget[];
  svg: SVGSVGElement;
}

function ghostDuration(ticks: number): string {
  if (ticks >= 960) return 'h';
  if (ticks >= 480) return 'q';
  if (ticks >= 240) return '8';
  return '16';
}

function ghostTicks(duration: string): number {
  return duration === 'h' ? 960 : duration === 'q' ? 480 : duration === '8' ? 240 : 120;
}

function buildVoice(models: EngravingNote[], stave: Stave, displayVoice: number, clef: 'treble' | 'bass'): { voice: Voice; drawn: Drawn[]; tuplets: Tuplet[] } {
  const tickables: (StaveNote | GhostNote)[] = [];
  const drawn: Drawn[] = [];
  const tupletGroups = new Map<string, (StaveNote | GhostNote)[]>();
  let at = 0;
  for (const model of models.sort((a, b) => a.offsetTicks - b.offsetTicks)) {
    while (at < model.offsetTicks) {
      const tripletRest = model.tupletGroup && model.offsetTicks - at === 160 &&
        Math.floor(at / 480) === Math.floor(model.offsetTicks / 480);
      if (tripletRest) {
        // VexFlow's tuplet bracket needs a note with a stem direction at its
        // first position. Keep this transcription gap visually invisible.
        const rest = new StaveNote({ keys: ['b/4'], duration: '8r', clef });
        rest.setStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' });
        rest.setStave(stave);
        tickables.push(rest);
        const group = tupletGroups.get(model.tupletGroup!) || [];
        group.push(rest); tupletGroups.set(model.tupletGroup!, group);
        at += 160;
        continue;
      }
      const duration = ghostDuration(model.offsetTicks - at);
      const ghost = new GhostNote(duration);
      ghost.setStave(stave);
      tickables.push(ghost); at += ghostTicks(duration);
    }
    const vex = new StaveNote({
      keys: model.pitches.map(pitch => pitch.key),
      duration: model.writtenDuration,
      dots: model.dotCount,
      clef,
      autoStem: displayVoice === 1,
      stemDirection: displayVoice === 2 ? -1 : undefined
    });
    vex.setStave(stave);
    const color = STAFF_COLOR[model.staff as 1 | 2];
    vex.setStyle({ fillStyle: color, strokeStyle: color });
    vex.setStemStyle({ fillStyle: color, strokeStyle: color });
    if (model.writtenDuration === '8' || model.writtenDuration === '16')
      vex.setFlagStyle({ fillStyle: color, strokeStyle: color });
    if (model.arpeggio) vex.addModifier(new Stroke(Stroke.Type.ARPEGGIO_DIRECTIONLESS), 0);
    for (let i = 0; i < model.dotCount; i++) Dot.buildAndAttach([vex], { all: true });
    tickables.push(vex); drawn.push({ model, vex });
    if (model.tupletGroup) {
      const group = tupletGroups.get(model.tupletGroup) || [];
      group.push(vex); tupletGroups.set(model.tupletGroup, group);
    }
    const noteTicks = model.writtenDuration === 'h' ? 960 : model.writtenDuration === 'q' ? 480 :
      model.writtenDuration === '8' ? 240 : 120;
    at = model.offsetTicks + (model.tupletGroup ? 160 : noteTicks * (model.dotCount ? 1.5 : 1));
  }
  while (at < BAR_TICKS) {
    const duration = ghostDuration(BAR_TICKS - at);
    const ghost = new GhostNote(duration);
    ghost.setStave(stave);
    tickables.push(ghost); at += ghostTicks(duration);
  }
  const voice = new Voice({ numBeats: 3, beatValue: 4 });
  voice.setMode(Voice.Mode.SOFT);
  const tuplets = [...tupletGroups.values()].filter(group => group.length === 3)
    .map(group => new Tuplet(group, { numNotes: 3, notesOccupied: 2, bracketed: true }));
  voice.addTickables(tickables);
  return { voice, drawn, tuplets };
}

export function renderEngravingPage(container: HTMLDivElement, firstMeasure: number, score: EngravingScore = engravingScore, barCount = 4): EngravingPage {
  container.replaceChildren();
  const lastMeasure = Math.min(firstMeasure + barCount - 1, score.measures);
  const prepared = [] as {
    measure: number; first: boolean; width: number; left: number;
    upper: Stave; lower: Stave;
    top: { voice: Voice; drawn: Drawn[]; tuplets: Tuplet[] }[];
    bottom: { voice: Voice; drawn: Drawn[]; tuplets: Tuplet[] }[];
    topVoices: Voice[]; bottomVoices: Voice[]; formatter: Formatter;
  }[];
  for (let measure = firstMeasure; measure <= lastMeasure; measure++) {
    const first = measure === firstMeasure;
    const upper = new Stave(0, STAFF_Y[1], 1000);
    const lower = new Stave(0, STAFF_Y[2], 1000);
    if (first) {
      upper.addClef('treble').addKeySignature('E').addTimeSignature('3/4');
      lower.addClef('bass').addKeySignature('E').addTimeSignature('3/4');
      upper.getModifiers(undefined, Clef.CATEGORY)[0]?.setStyle({ fillStyle: STAFF_COLOR[1], strokeStyle: STAFF_COLOR[1] });
      lower.getModifiers(undefined, Clef.CATEGORY)[0]?.setStyle({ fillStyle: STAFF_COLOR[2], strokeStyle: STAFF_COLOR[2] });
    }
    if (measure === 121) upper.setTempo({ duration: 'q', bpm: 84 }, 0);
    if (measure === 123) upper.setTempo({ duration: 'q', bpm: 112 }, 0);
    const top = [1, 2].map(displayVoice => buildVoice(
      score.notes.filter(note => note.measure === measure && note.staff === 1 && note.displayVoice === displayVoice), upper, displayVoice, 'treble'));
    const bottom = [1, 2].map(displayVoice => buildVoice(
      score.notes.filter(note => note.measure === measure && note.staff === 2 && note.displayVoice === displayVoice), lower, displayVoice, 'bass'));
    const topVoices = top.filter(item => item.drawn.length).map(item => item.voice);
    const bottomVoices = bottom.filter(item => item.drawn.length).map(item => item.voice);
    Accidental.applyAccidentals(topVoices, 'E');
    Accidental.applyAccidentals(bottomVoices, 'E');
    const formatter = new Formatter();
    formatter.joinVoices(topVoices).joinVoices(bottomVoices);
    const voices = [...topVoices, ...bottomVoices];
    const left = Math.max(upper.getNoteStartX(), lower.getNoteStartX());
    const minimum = voices.length ? formatter.preCalculateMinTotalWidth(voices) : 0;
    const width = Math.max(barCount > 4 ? 175 : 205, Math.ceil(left + minimum * 1.16 + 32));
    prepared.push({ measure, first, width, left, upper, lower, top, bottom, topVoices, bottomVoices, formatter });
  }
  const width = 48 + prepared.reduce((sum, item) => sum + item.width, 0);
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(width, 390);
  const context = renderer.getContext();
  context.setFillStyle('#b3a99a'); context.setStrokeStyle('#686055');
  const svg = container.querySelector('svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${width} 390`);
  // Renderer.resize writes a pixel width inline, which overrides the theater's
  // responsive CSS and clips the later bars. Keep the intrinsic viewBox while
  // fitting all six measures inside the available theater width.
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Piano notation, bars ${firstMeasure}–${lastMeasure}`);
  const defs = document.createElementNS(SVG_NS, 'defs'); svg.insertBefore(defs, svg.firstChild);
  const anchors: NoteAnchor[] = [];
  const highlights: HighlightTarget[] = [];
  const allDrawn: Drawn[] = [];
  const bySource = new Map<string, { vex: StaveNote; index: number; measure: number }[]>();
  let x = 24;
  for (const item of prepared) {
    const { measure, first, upper, lower, top, bottom, topVoices, bottomVoices, formatter } = item;
    upper.setX(x).setWidth(item.width);
    lower.setX(x).setWidth(item.width);
    upper.setNoteStartX(x + item.left);
    lower.setNoteStartX(x + item.left);
    upper.setContext(context).draw(); lower.setContext(context).draw();
    if (first) {
      new StaveConnector(upper, lower).setType('brace').setContext(context).draw();
      new StaveConnector(upper, lower).setType('singleLeft').setContext(context).draw();
    }
    new StaveConnector(upper, lower).setType('singleRight').setContext(context).draw();
    const drawn = [...top.flatMap(item => item.drawn), ...bottom.flatMap(item => item.drawn)];
    const beamGroups = new Map<string, StaveNote[]>();
    for (const note of drawn) if (note.model.beamGroup) {
      const group = beamGroups.get(note.model.beamGroup) || [];
      group.push(note.vex); beamGroups.set(note.model.beamGroup, group);
    }
    // Beams must exist before StaveNote.draw(), otherwise VexFlow draws flags
    // underneath them and each beamed note appears to have two symbols.
    const beams = [...beamGroups.values()].filter(group => group.length > 1)
      .map(group => {
        const model = drawn.find(item => item.vex === group[0])!.model;
        return new Beam(group, model.displayVoice === 1)
          .setStyle({ fillStyle: STAFF_COLOR[model.staff as 1 | 2], strokeStyle: STAFF_COLOR[model.staff as 1 | 2] });
      });
    formatter.format([...topVoices, ...bottomVoices], upper.getNoteEndX() - upper.getNoteStartX() - 12, { context });
    topVoices.forEach(voice => voice.draw(context, upper));
    bottomVoices.forEach(voice => voice.draw(context, lower));
    allDrawn.push(...drawn);
    for (const item of drawn) {
      item.model.pitches.forEach((pitch, index) => {
        const source = score.sources.get(pitch.sourceId)!;
        if (source.segments[0].measure === measure)
          anchors.push({ sourceId: source.id, audioStart: source.audioStart, x: item.vex.getAbsoluteX(), measure });
        const occurrences = bySource.get(source.id) || [];
        occurrences.push({ vex: item.vex, index, measure }); bySource.set(source.id, occurrences);
        const head = item.vex.noteHeads[index]?.getSVGElement();
        if (!head) return;
        const original = item.model.pitches.length === 1 ? item.vex.getSVGElement() : head;
        if (!original) return;
        const bounds = (original as SVGGraphicsElement).getBBox();
        const clip = document.createElementNS(SVG_NS, 'clipPath');
        const id = `engraving-${firstMeasure}-${measure}-${source.id}-${index}`;
        clip.setAttribute('id', id); clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(bounds.x - 2)); rect.setAttribute('y', String(bounds.y - 2));
        rect.setAttribute('width', '0'); rect.setAttribute('height', String(bounds.height + 4));
        clip.appendChild(rect); defs.appendChild(clip);
        const overlay = original.cloneNode(true) as SVGElement;
        overlay.removeAttribute('id'); overlay.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
        overlay.setAttribute('class', 'score-note-highlight');
        overlay.setAttribute('clip-path', `url(#${id})`);
        overlay.setAttribute('fill', STAFF_COLOR[item.model.staff as 1 | 2]);
        overlay.setAttribute('stroke', STAFF_COLOR[item.model.staff as 1 | 2]);
        original.parentElement?.appendChild(overlay);
        const total = source.segments.reduce((sum, segment) => sum + segment.durationTicks, 0);
        let preceding = 0;
        let inMeasure = 0;
        for (const segment of source.segments) {
          if (segment.measure < measure) preceding += segment.durationTicks;
          else if (segment.measure === measure) inMeasure += segment.durationTicks;
        }
        highlights.push({ source, clip: rect, left: bounds.x - 2, width: bounds.width + 4,
          from: preceding / total, to: (preceding + inMeasure) / total });
      });
    }
    beams.forEach(beam => beam.setContext(context).draw());
    [...top, ...bottom].flatMap(voice => voice.tuplets).forEach(tuplet => tuplet.setContext(context).draw());
    x += item.width;
  }
  for (const occurrences of bySource.values()) {
    occurrences.sort((a, b) => a.measure - b.measure);
    for (let index = 1; index < occurrences.length; index++) {
      const before = occurrences[index - 1], after = occurrences[index];
      if (after.measure !== before.measure + 1) continue;
      new StaveTie({ firstNote: before.vex, lastNote: after.vex,
        firstIndexes: [before.index], lastIndexes: [after.index] }).setContext(context).draw();
    }
  }
  for (const span of score.ottavas) {
    if (span.lastMeasure < firstMeasure || span.firstMeasure > lastMeasure) continue;
    const members = allDrawn.filter(item => item.model.ottavaSpan === span.id && item.model.staff === span.staff);
    if (!members.length) continue;
    new TextBracket({ start: members[0].vex, stop: members.at(-1)!.vex,
      text: '8', superscript: span.octaveShift < 0 ? 'va' : 'vb',
      position: span.octaveShift < 0 ? TextBracket.Position.TOP : TextBracket.Position.BOTTOM })
      .setLine(span.staff === 1 && members.some(item => item.model.tupletGroup) ? 5 : 1)
      .setContext(context).draw();
  }
  return { anchors, highlights, svg };
}

export function onsetToX(anchors: readonly NoteAnchor[], time: number): number {
  const points = [...anchors].sort((a, b) => a.audioStart - b.audioStart || a.x - b.x);
  if (!points.length) return 0;
  if (time <= points[0].audioStart) return points[0].x;
  for (let index = 1; index < points.length; index++) {
    if (time > points[index].audioStart) continue;
    const before = points[index - 1], after = points[index];
    const span = after.audioStart - before.audioStart;
    return span > 0 ? before.x + (after.x - before.x) * (time - before.audioStart) / span : after.x;
  }
  return points.at(-1)!.x;
}
