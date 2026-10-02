import { Accidental, Beam, Clef, Dot, Formatter, GhostNote, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Stroke, Tuplet, Voice } from 'vexflow';
import { deriveTempoDirections } from './directions';
import type { TempoDirection } from './directions';
import { engravingScore, glideWindow, noteValueTicks } from './engravingModel';
import type { EngravingNote, EngravingScore } from './engravingModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BAR_TICKS = 1440;
const STAFF_Y = { 1: 94, 2: 222 } as const;
const HEAD_COLOR = '#9a9183';
const STEM_COLOR = '#686055';
const GLIDE_COLOR = { 1: '#de8adc', 2: '#6fccd9' } as const;

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
  clip: SVGRectElement;
  width: number;
  /** Media time at which the glide starts and finishes. */
  start: number;
  end: number;
}

export interface EngravingLayout {
  /** The narrowest a bar may be, in SVG units. */
  minBarWidth: number;
  /** When set, bars are widened in proportion until a full page reaches this width. */
  pageWidth?: number;
  /** 'opening' shows 3/4 only at the start of the piece instead of on every page. */
  timeSignature?: 'always' | 'opening';
}

export interface EngravingPage {
  /** Sorted by media time, then by x. */
  anchors: NoteAnchor[];
  highlights: HighlightTarget[];
  svg: SVGSVGElement;
  terminal?: { audioEnd: number; x: number };
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

function buildVoice(models: EngravingNote[], stave: Stave, displayVoice: number, clef: 'treble' | 'bass', lowerStave?: Stave): { voice: Voice; drawn: Drawn[]; tuplets: Tuplet[] } {
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
    if (model.crossStaffBassCount && lowerStave) {
      const bassKeys = model.pitches.slice(0, model.crossStaffBassCount).map(pitch => pitch.key);
      const bassProbe = new StaveNote({ keys: bassKeys, duration: model.writtenDuration, clef: 'bass' });
      const lineGap = (lowerStave.getYForNote(0) - stave.getYForNote(0)) / stave.getSpacingBetweenLines();
      bassKeys.forEach((_, index) => vex.setKeyLine(index, bassProbe.getKeyLine(index) - lineGap));
      vex.setLedgerLineStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' });
    }
    vex.setStyle({ fillStyle: HEAD_COLOR, strokeStyle: HEAD_COLOR });
    vex.setStemStyle({ fillStyle: STEM_COLOR, strokeStyle: STEM_COLOR });
    if (model.writtenDuration === '8' || model.writtenDuration === '16')
      vex.setFlagStyle({ fillStyle: STEM_COLOR, strokeStyle: STEM_COLOR });
    if (model.arpeggio) vex.addModifier(new Stroke(Stroke.Type.ARPEGGIO_DIRECTIONLESS), 0);
    for (let i = 0; i < model.dotCount; i++) Dot.buildAndAttach([vex], { all: true });
    tickables.push(vex); drawn.push({ model, vex });
    if (model.tupletGroup) {
      const group = tupletGroups.get(model.tupletGroup) || [];
      group.push(vex); tupletGroups.set(model.tupletGroup, group);
    }
    at = model.offsetTicks + noteValueTicks(model);
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

interface PreparedMeasure {
  measure: number; first: boolean; width: number; left: number;
  upper: Stave; lower: Stave;
  top: { voice: Voice; drawn: Drawn[]; tuplets: Tuplet[] }[];
  bottom: { voice: Voice; drawn: Drawn[]; tuplets: Tuplet[] }[];
  topVoices: Voice[]; bottomVoices: Voice[]; formatter: Formatter;
}

/** Builds one bar's staves and voices and works out the narrowest width it can be drawn at. */
function prepareMeasure(score: EngravingScore, measure: number, first: boolean, minBarWidth: number, timeSignature: boolean): PreparedMeasure {
  const upper = new Stave(0, STAFF_Y[1], 1000);
  const lower = new Stave(0, STAFF_Y[2], 1000);
  if (first) {
    upper.addClef('treble').addKeySignature('E');
    lower.addClef('bass').addKeySignature('E');
    if (timeSignature) {
      upper.addTimeSignature('3/4');
      lower.addTimeSignature('3/4');
    }
    upper.getModifiers(undefined, Clef.CATEGORY)[0]?.setStyle({ fillStyle: HEAD_COLOR, strokeStyle: HEAD_COLOR });
    lower.getModifiers(undefined, Clef.CATEGORY)[0]?.setStyle({ fillStyle: HEAD_COLOR, strokeStyle: HEAD_COLOR });
  }
  const top = [1, 2].map(displayVoice => buildVoice(
    score.notes.filter(note => note.measure === measure && note.staff === 1 && note.displayVoice === displayVoice), upper, displayVoice, 'treble', lower));
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
  const width = Math.max(minBarWidth, Math.ceil(left + minimum * 1.16 + 32));
  return { measure, first, width, left, upper, lower, top, bottom, topVoices, bottomVoices, formatter };
}

interface Box { x0: number; x1: number; y0: number; y1: number }

const MARK_COLOR = HEAD_COLOR;
const MARK_PAD = 4;
const directionCache = new WeakMap<EngravingScore, TempoDirection[]>();

function tempoDirections(score: EngravingScore): TempoDirection[] {
  let directions = directionCache.get(score);
  if (!directions) directionCache.set(score, directions = deriveTempoDirections(score));
  return directions;
}

function boxOf(element: SVGGraphicsElement): Box {
  const bounds = element.getBBox();
  return { x0: bounds.x, x1: bounds.x + bounds.width, y0: bounds.y, y1: bounds.y + bounds.height };
}

function union(boxes: Box[]): Box {
  return boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) }));
}

let measuring: CanvasRenderingContext2D | null | undefined;
/**
 * The inked extent of an SVG text element. getBBox reports the font's
 * ascent and descent instead, which for music fonts is several staff
 * spaces taller than the glyph and would push marks far from the staff.
 */
function inkBox(text: SVGTextElement): Box {
  measuring ??= document.createElement('canvas').getContext('2d');
  const style = getComputedStyle(text);
  const fallback = boxOf(text);
  if (!measuring) return fallback;
  measuring.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  measuring.textAlign = (text.getAttribute('text-anchor') === 'middle' ? 'center' : 'left');
  const metrics = measuring.measureText(text.textContent || '');
  const x = Number(text.getAttribute('x')), y = Number(text.getAttribute('y'));
  return { x0: x - metrics.actualBoundingBoxLeft, x1: x + metrics.actualBoundingBoxRight,
    y0: y - metrics.actualBoundingBoxAscent, y1: y + metrics.actualBoundingBoxDescent };
}

/**
 * A note's heads, stem and flag. StaveNote.getBoundingBox also merges its
 * modifiers, and an arpeggio stroke reports a box reaching the top of the
 * SVG, which would push every mark above it off the page.
 */
function noteBox(note: StaveNote): Box | undefined {
  const heads = note.noteHeads.map(head => vexBox(head)).filter((box): box is Box => !!box);
  if (!heads.length) return undefined;
  const box = union(heads);
  if (note.hasStem()) {
    const { topY, baseY } = note.getStemExtents();
    box.y0 = Math.min(box.y0, topY, baseY) - (note.hasFlag() ? 4 : 0);
    box.y1 = Math.max(box.y1, topY, baseY) + (note.hasFlag() ? 4 : 0);
  }
  return box;
}

/** A note's inked extent (heads, stem, flag, modifiers) from VexFlow's own metrics. */
function vexBox(element: { getBoundingBox(): { getX(): number; getY(): number; getW(): number; getH(): number } | undefined }): Box | undefined {
  const bounds = element.getBoundingBox();
  return bounds && { x0: bounds.getX(), x1: bounds.getX() + bounds.getW(), y0: bounds.getY(), y1: bounds.getY() + bounds.getH() };
}

/**
 * Stacks marks outside a staff without collisions. Each side keeps the
 * outline of everything already drawn there; a mark is placed just beyond
 * the outline across its own width, then becomes part of it. Callers place
 * marks from the staff outward in the conventional order (Gould, Behind
 * Bars): fermatas, then octave lines, then tempo words.
 */
class Skyline {
  private readonly boxes: Box[];
  constructor(boxes: Box[], private readonly limit: number, private readonly side: 'above' | 'below') {
    this.boxes = [...boxes];
  }

  /** How far `box` must move to clear the outline, keeping `clearance` from the staff. */
  shiftFor(box: Box, clearance = 0): number {
    const hits = this.boxes.filter(item => item.x1 > box.x0 - MARK_PAD && item.x0 < box.x1 + MARK_PAD);
    return this.side === 'above'
      ? Math.min(this.limit - clearance, ...hits.map(item => item.y0 - MARK_PAD)) - box.y1
      : Math.max(this.limit + clearance, ...hits.map(item => item.y1 + MARK_PAD)) - box.y0;
  }

  /** Moves `element`, whose inked extent is `box`, so it clears the outline, and records it. */
  place(element: SVGGraphicsElement, box: Box, shift = this.shiftFor(box)): Box {
    element.setAttribute('transform', `translate(0 ${shift})`);
    const placed = { ...box, y0: box.y0 + shift, y1: box.y1 + shift };
    this.boxes.push(placed);
    return placed;
  }
}

function svgElement<K extends keyof SVGElementTagNameMap>(parent: Element, name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  parent.appendChild(element);
  return element;
}

/** Italic expression text in the engraving's text face. */
function markText(parent: Element, x: number, content: string, extra: Record<string, string | number> = {}): SVGTextElement {
  const text = svgElement(parent, 'text', { x, y: 0, fill: MARK_COLOR, stroke: 'none', 'font-family': 'Academico, Georgia, serif',
    'font-style': 'italic', 'font-size': 18, ...extra });
  text.textContent = content;
  return text;
}

/**
 * Natural width of every bar when it continues a line, plus the extra width
 * the clef and key signature add when a bar opens one. Index 0 is bar 1.
 */
export function measureBarWidths(score: EngravingScore = engravingScore, minBarWidth = 160): { widths: number[]; openingExtra: number } {
  const widths: number[] = [];
  for (let measure = 1; measure <= score.measures; measure++)
    widths.push(prepareMeasure(score, measure, false, minBarWidth, false).width);
  const opening = prepareMeasure(score, 2, true, 0, false).width - prepareMeasure(score, 2, false, 0, false).width;
  return { widths, openingExtra: Math.max(0, opening) };
}

export function renderEngravingPage(container: HTMLDivElement, firstMeasure: number, score: EngravingScore = engravingScore,
  barCount = 4, layout: Partial<EngravingLayout> = {}): EngravingPage {
  container.replaceChildren();
  const minBarWidth = layout.minBarWidth ?? (barCount > 4 ? 175 : 205);
  const timeSignature = layout.timeSignature !== 'opening' || firstMeasure === 1;
  const lastMeasure = Math.min(firstMeasure + barCount - 1, score.measures);
  const prepared: PreparedMeasure[] = [];
  for (let measure = firstMeasure; measure <= lastMeasure; measure++)
    prepared.push(prepareMeasure(score, measure, measure === firstMeasure, minBarWidth, timeSignature));
  if (layout.pageWidth) {
    // A short final page keeps the same bar scale as the full pages.
    const target = layout.pageWidth * prepared.length / barCount - 48;
    const natural = prepared.reduce((sum, item) => sum + item.width, 0);
    if (natural < target) for (const item of prepared) item.width = Math.floor(item.width * target / natural);
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
  const measureEndX = new Map<number, number>();
  const tuplets: Tuplet[] = [];
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
          .setStyle({ fillStyle: STEM_COLOR, strokeStyle: STEM_COLOR });
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
        const original = head;
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
        overlay.setAttribute('fill', GLIDE_COLOR[pitch.displayStaff as 1 | 2]);
        overlay.setAttribute('stroke', GLIDE_COLOR[pitch.displayStaff as 1 | 2]);
        original.parentElement?.appendChild(overlay);
        highlights.push({ clip: rect, width: bounds.width + 4, ...glideWindow(score, item.model, source) });
      });
    }
    beams.forEach(beam => beam.setContext(context).draw());
    const measureTuplets = [...top, ...bottom].flatMap(voice => voice.tuplets);
    measureTuplets.forEach(tuplet => tuplet.setContext(context).draw());
    tuplets.push(...measureTuplets);
    measureEndX.set(measure, x + item.width);
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
  // Marks outside the staves are placed after every note, beam, tuplet and
  // tie is drawn, so each one can clear what is already there.
  const upperTop = prepared[0].upper.getYForLine(0), upperBottom = prepared[0].upper.getYForLine(4);
  const lowerTop = prepared[0].lower.getYForLine(0), lowerBottom = prepared[0].lower.getYForLine(4);
  const split = (upperBottom + lowerTop) / 2;
  // Beams and ties are plain paths, so their SVG bounds are exact; notes and
  // tuplets contain music-font text and use VexFlow's glyph metrics instead.
  const drawnBoxes = [
    ...allDrawn.map(item => noteBox(item.vex)),
    ...tuplets.map(tuplet => vexBox(tuplet)),
    ...[...svg.querySelectorAll<SVGGraphicsElement>('.vf-beam, .vf-stavetie')].map(boxOf)
  ].filter((box): box is Box => !!box && box.x1 > box.x0);
  const upperBoxes = drawnBoxes.filter(box => (box.y0 + box.y1) / 2 < split);
  const lowerBoxes = drawnBoxes.filter(box => (box.y0 + box.y1) / 2 >= split);
  const sides = {
    1: new Skyline(upperBoxes, upperTop, 'above'),
    2: new Skyline(lowerBoxes, lowerTop, 'above'),
    below: new Skyline(lowerBoxes, lowerBottom, 'below')
  };
  const marks = svgElement(svg, 'g', { class: 'score-marks' });
  const directions = tempoDirections(score).filter(item => item.measure >= firstMeasure && item.measure <= lastMeasure);
  const noteAt = (direction: TempoDirection, anyStaff: boolean) => allDrawn
    .filter(item => item.model.measure === direction.measure && item.model.offsetTicks === direction.offsetTicks &&
      (anyStaff || item.model.staff === direction.staff))
    .sort((a, b) => a.model.staff - b.model.staff || a.model.displayVoice - b.model.displayVoice)[0];
  const headBox = (item: Drawn) => {
    const heads = item.vex.noteHeads.map(head => vexBox(head)).filter((box): box is Box => !!box);
    return heads.length ? union(heads) : { x0: item.vex.getAbsoluteX(), x1: item.vex.getAbsoluteX() + 10, y0: 0, y1: 0 };
  };

  // 1. Fermatas sit nearest the note: above the upper staff, inverted below the lower.
  for (const direction of directions.filter(item => item.kind === 'fermata')) {
    const item = noteAt(direction, false);
    if (!item) continue;
    const head = headBox(item);
    const above = direction.staff === 1;
    const glyph = svgElement(marks, 'text', { x: (head.x0 + head.x1) / 2, y: 0, 'text-anchor': 'middle', fill: MARK_COLOR,
      stroke: 'none', 'font-family': 'Bravura', 'font-size': '30pt' });
    glyph.textContent = above ? '\uE4C0' : '\uE4C1'; // SMuFL fermataAbove, fermataBelow
    glyph.setAttribute('class', 'score-fermata');
    (above ? sides[1] : sides.below).place(glyph, inkBox(glyph));
  }

  // 2. Octave lines: "8va" (or "(8)" when continued from an earlier page),
  // a dashed extension, and a closing hook where the shift ends.
  for (const span of score.ottavas) {
    if (span.lastMeasure < firstMeasure || span.firstMeasure > lastMeasure) continue;
    const members = allDrawn.filter(item => item.model.ottavaSpan === span.id && item.model.staff === span.staff);
    if (!members.length) continue;
    const start = headBox(members[0]).x0;
    const ends = span.lastMeasure <= lastMeasure;
    const stop = ends ? headBox(members.at(-1)!).x1 + 4 : measureEndX.get(lastMeasure)! - 4;
    const group = svgElement(marks, 'g', { class: 'score-ottava' });
    const continued = span.firstMeasure < firstMeasure;
    const label = markText(group, start, continued ? '(8)' : '8', { 'font-weight': 'bold', 'font-size': 14 });
    if (!continued) {
      const suffix = svgElement(label, 'tspan', { dy: -5, 'font-size': 10 });
      suffix.textContent = span.octaveShift < 0 ? 'va' : 'vb';
    }
    // Measured as one run of text; the raised suffix adds its lift on top.
    const ink = inkBox(label);
    const labelBox = continued ? ink : { ...ink, y0: ink.y0 - 5 };
    const lineY = labelBox.y0 + 5;
    if (stop > labelBox.x1 + 6) {
      svgElement(group, 'path', { d: `M ${labelBox.x1 + 3} ${lineY} H ${stop}` + (ends ? ` V ${lineY + 7}` : ''),
        fill: 'none', stroke: MARK_COLOR, 'stroke-width': 1, 'stroke-dasharray': '4 3' });
    }
    sides[span.staff as 1 | 2].place(group, { ...labelBox, x1: Math.max(stop, labelBox.x1), y1: Math.max(labelBox.y1, lineY + (ends ? 7 : 0)) });
  }

  // 3. Tempo words above the system, aligned with the beat they start on.
  // They share one baseline per page and keep two spaces from the staff.
  const words = directions.filter(item => item.kind === 'text').map(direction => {
    const item = noteAt(direction, false) || noteAt(direction, true);
    const x = item ? headBox(item).x0 : (measureEndX.get(direction.measure - 1) ?? 24) + 12;
    const text = markText(marks, x, direction.text!);
    text.setAttribute('class', 'score-tempo');
    return { text, box: inkBox(text) };
  });
  const wordShift = Math.min(...words.map(word => sides[1].shiftFor(word.box, 20)));
  for (const word of words) sides[1].place(word.text, word.box, wordShift);

  let terminal: EngravingPage['terminal'];
  if (lastMeasure === score.measures) {
    const finalSource = [...score.sources.values()].reduce((latest, source) =>
      source.audioEnd > latest.audioEnd ? source : latest);
    const finalMeasure = finalSource.segments.at(-1)!.measure;
    terminal = { audioEnd: finalSource.audioEnd, x: measureEndX.get(finalMeasure) || x };
  }
  anchors.sort((a, b) => a.audioStart - b.audioStart || a.x - b.x);
  return { anchors, highlights, svg, terminal };
}

/** Interpolates the playhead between anchors, which must be sorted as an EngravingPage returns them. */
export function onsetToX(points: readonly NoteAnchor[], time: number, terminal?: EngravingPage['terminal']): number {
  if (!points.length) return 0;
  if (time <= points[0].audioStart) return points[0].x;
  // First anchor at or after `time`.
  let low = 1, high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].audioStart < time) low = middle + 1;
    else high = middle;
  }
  if (low < points.length) {
    const before = points[low - 1], after = points[low];
    const span = after.audioStart - before.audioStart;
    return span > 0 ? before.x + (after.x - before.x) * (time - before.audioStart) / span : after.x;
  }
  const last = points.at(-1)!;
  if (terminal && time < terminal.audioEnd && terminal.audioEnd > last.audioStart)
    return last.x + (terminal.x - last.x) * (time - last.audioStart) / (terminal.audioEnd - last.audioStart);
  return terminal && time >= terminal.audioEnd ? terminal.x : last.x;
}
