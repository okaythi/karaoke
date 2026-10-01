import musicXml from '../data/score/itsumo-final.musicxml?raw';
import timingMap from '../data/score/itsumo-karaoke-map.json';

interface Fragment { measure: number; offsetTicks: number; durationTicks: number; voice: number; staff: number; tie: string | null }
interface MapNote { id: string; midi: number; audioStart: number; audioEnd: number; staff: number; segments: Fragment[] }
interface Group { audioStart: number; noteIds: string[] }
interface WrittenNote { pitch: number; measure: number; offset: number; duration: number; voice: number; staff: number; type: string; dotted: boolean; tied: boolean }
interface WrittenRest { measure: number; offset: number; duration: number; staff: number; type: string }
interface Mounted { rect: SVGRectElement; x: number; width: number; note: MapNote; from: number; to: number }

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
const writtenRests: WrittenRest[] = [];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function parseScore(): WrittenNote[] {
  const doc = new DOMParser().parseFromString(musicXml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid Itsumo MusicXML');
  const result: WrittenNote[] = [];
  doc.querySelectorAll('part').forEach((part, partIndex) => {
    part.querySelectorAll(':scope > measure').forEach(measure => {
      let cursor = 0;
      let previous = 0;
      const number = Number(measure.getAttribute('number'));
      for (const child of Array.from(measure.children)) {
        if (child.tagName === 'backup') { cursor -= Number(child.querySelector('duration')?.textContent || 0); continue; }
        if (child.tagName === 'forward') { cursor += Number(child.querySelector('duration')?.textContent || 0); continue; }
        if (child.tagName !== 'note') continue;
        const duration = Number(child.querySelector(':scope > duration')?.textContent || 0);
        const chord = child.querySelector(':scope > chord') !== null;
        const offset = chord ? previous : cursor;
        if (!chord) previous = cursor;
        if (child.querySelector(':scope > rest')) {
          writtenRests.push({ measure: number, offset, duration, staff: partIndex + 1,
            type: child.querySelector(':scope > type')?.textContent || 'quarter' });
        } else {
          const pitch = child.querySelector(':scope > pitch');
          const step = pitch?.querySelector('step')?.textContent || 'C';
          const alter = Number(pitch?.querySelector('alter')?.textContent || 0);
          const octave = Number(pitch?.querySelector('octave')?.textContent || 4);
          const semitone = [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(step)] + alter;
          result.push({ pitch: (octave + 1) * 12 + semitone, measure: number, offset, duration,
            voice: Number(child.querySelector(':scope > voice')?.textContent || 1),
            staff: Number(child.querySelector(':scope > staff')?.textContent || partIndex + 1),
            type: child.querySelector(':scope > type')?.textContent || 'quarter',
            dotted: child.querySelector(':scope > dot') !== null,
            tied: child.querySelector(':scope > tie[type="start"]') !== null });
        }
        if (!chord) cursor += duration;
      }
    });
  });
  return result;
}

function matchScore(): Map<string, WrittenNote[]> {
  const lookup = new Map<string, WrittenNote[]>();
  for (const written of parseScore()) {
    const key = [written.measure, written.offset, written.duration, written.voice, written.staff, written.pitch].join(':');
    const bucket = lookup.get(key) || [];
    bucket.push(written); lookup.set(key, bucket);
  }
  const matched = new Map<string, WrittenNote[]>();
  for (const note of notes) {
    matched.set(note.id, note.segments.map(segment => {
      const key = [segment.measure, segment.offsetTicks, segment.durationTicks, segment.voice, segment.staff, note.midi].join(':');
      const written = lookup.get(key)?.shift();
      if (!written) throw new Error(`MusicXML fragment missing for ${note.id}: ${key}`);
      return written;
    }));
  }
  if ([...lookup.values()].some(bucket => bucket.length)) throw new Error('MusicXML has notes absent from the karaoke map');
  return matched;
}

const writtenById = matchScore();

function groupAt(time: number): Group | undefined {
  let lo = 0, hi = groups.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (groups[mid].audioStart <= time) lo = mid + 1; else hi = mid; }
  return groups[Math.max(0, lo - 1)];
}

function yForPitch(pitch: number, staff: number): number {
  // Diatonic steps preserve the staff position of sharps and flats.
  const semitone = pitch % 12;
  const letter = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][semitone];
  const octave = Math.floor(pitch / 12) - 1;
  const steps = octave * 7 + letter;
  const topLine = staff === 1 ? 5 * 7 + 3 : 3 * 7 + 5; // F5 / A3
  return STAFF_TOP[staff] + (topLine - steps) * 5;
}

function noteGlyph(x: number, y: number, written: WrittenNote, color: string): SVGGElement {
  const group = svg('g', { fill: color, stroke: color });
  const top = STAFF_TOP[written.staff];
  if (y < top || y > top + 40) {
    const first = y < top ? top + Math.floor((y - top) / 10) * 10 : top + 50;
    const last = y < top ? top - 10 : Math.floor((y - top) / 10) * 10 + top;
    for (let ledger = first; ledger <= last; ledger += 10) {
      if (ledger >= top && ledger <= top + 40) continue;
      group.appendChild(svg('line', { x1: x - 10, y1: ledger, x2: x + 10, y2: ledger, 'stroke-width': 1 }));
    }
  }
  const open = written.type === 'half' || written.type === 'whole';
  group.appendChild(svg('ellipse', { cx: x, cy: y, rx: 6.6, ry: 4.4, transform: `rotate(-20 ${x} ${y})`,
    fill: open ? '#181614' : color, stroke: color, 'stroke-width': 1.6 }));
  if (written.type !== 'whole') {
    const down = y < STAFF_TOP[written.staff] + 20;
    const stemX = x + (down ? -5.8 : 5.8);
    const stemEnd = y + (down ? 29 : -29);
    group.appendChild(svg('line', { x1: stemX, y1: y, x2: stemX, y2: stemEnd, 'stroke-width': 1.6 }));
    if (written.type === 'eighth' || written.type === '16th' || written.type === '32nd') {
      const flags = written.type === 'eighth' ? 1 : written.type === '16th' ? 2 : 3;
      for (let i = 0; i < flags; i++) group.appendChild(svg('path', {
        d: down ? `M ${stemX} ${stemEnd - i * 6} q -13 5 -8 13` : `M ${stemX} ${stemEnd + i * 6} q 13 5 8 13`,
        fill: 'none', 'stroke-width': 1.5
      }));
    }
  }
  if (written.dotted) group.appendChild(svg('circle', { cx: x + 11, cy: y - 2, r: 1.7 }));
  if (written.tied) group.appendChild(svg('path', { d: `M ${x + 6} ${y + 7} Q ${x + 16} ${y + 14} ${x + 26} ${y + 7}`, fill: 'none', 'stroke-width': 1.2 }));
  return group;
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
    const root = svg('svg', { viewBox: `0 0 ${width} 340`, role: 'img', 'aria-label': 'Itsumo Nando Demo two staff music score' });
    const defs = svg('defs'); root.appendChild(defs);
    for (const staff of [1, 2]) {
      for (let line = 0; line < 5; line++) root.appendChild(svg('line', { x1: 12, y1: STAFF_TOP[staff] + line * 10,
        x2: width - 12, y2: STAFF_TOP[staff] + line * 10, stroke: '#686055', 'stroke-width': .8 }));
      const clef = svg('text', { x: 19, y: STAFF_TOP[staff] + 34, fill: '#9a9183', 'font-size': staff === 1 ? 39 : 31,
        'font-family': 'serif' }); clef.textContent = staff === 1 ? '𝄞' : '𝄢'; root.appendChild(clef);
    }
    for (const staff of [1, 2]) {
      const key = svg('text', { x: 48, y: STAFF_TOP[staff] + 28, fill: '#9a9183', 'font-size': 20, 'font-family': 'serif' });
      key.textContent = '♯♯♯♯'; root.appendChild(key);
    }
    for (let bar = 0; bar <= BARS_PER_PAGE; bar++) root.appendChild(svg('line', { x1: LEFT + bar * BAR_WIDTH, y1: STAFF_TOP[1],
      x2: LEFT + bar * BAR_WIDTH, y2: STAFF_TOP[2] + 40, stroke: '#686055', 'stroke-width': 1 }));
    for (const rest of writtenRests) {
      const bar = rest.measure - 1 - page * BARS_PER_PAGE;
      if (bar < 0 || bar >= BARS_PER_PAGE) continue;
      const x = LEFT + bar * BAR_WIDTH + 16 + rest.offset / BAR_TICKS * (BAR_WIDTH - 32);
      const y = STAFF_TOP[rest.staff] + 20;
      if (rest.type === 'half' || rest.type === 'whole') root.appendChild(svg('rect', { x: x - 6, y: y - 2, width: 12, height: 4, fill: '#686055' }));
      else root.appendChild(svg('path', { d: `M ${x + 2} ${y - 13} l -5 9 7 3 -6 8 5 7`, fill: 'none', stroke: '#686055', 'stroke-width': 2 }));
    }
    for (const note of notes) {
      const written = writtenById.get(note.id)!;
      let preceding = 0;
      const total = note.segments.reduce((sum, fragment) => sum + fragment.durationTicks, 0);
      note.segments.forEach((fragment, index) => {
        const from = preceding / total; preceding += fragment.durationTicks;
        const to = preceding / total;
        const bar = fragment.measure - 1 - page * BARS_PER_PAGE;
        if (bar < 0 || bar >= BARS_PER_PAGE) return;
        const x = LEFT + bar * BAR_WIDTH + 16 + fragment.offsetTicks / BAR_TICKS * (BAR_WIDTH - 32);
        const y = yForPitch(note.midi, fragment.staff);
        const base = noteGlyph(x, y, written[index], '#b3a99a');
        root.appendChild(base);
        const overlay = noteGlyph(x, y, written[index], fragment.staff === 1 ? PASTEL_PINK : PASTEL_BLUE);
        overlay.classList.add('score-note-highlight');
        const clipId = `itsumo-${page}-${note.id}-${index}`;
        const clip = svg('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
        const rect = svg('rect', { x: x - 11, y: y - 38, width: 0, height: 80 });
        clip.appendChild(rect); defs.appendChild(clip);
        overlay.setAttribute('clip-path', `url(#${clipId})`);
        root.appendChild(overlay);
        mounted.push({ rect, x: x - 11, width: 43, note, from, to });
      });
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
