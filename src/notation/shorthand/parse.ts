/**
 * Score shorthand: a compact text form of a score, used for catalogue
 * examples and tests. It is not an import format for real pieces.
 *
 * ```
 * staves: upper treble, lower bass      (the default; `group: bracket|none`)
 * key: 4 minor                          (fifths; default 0 major)
 * time: 2/2 cut                         (default 4/4)
 * upper: C5/4 D5 <E5 G5>/2 | r/2 F#5/4. G5/8 |
 * upper.2: …                            (voice 2 of a staff; `//` starts a comment)
 * lower: C3/1 | G2/1 |
 * ```
 *
 * Events: a pitch (`C5`, `F#4`, `Bbb3`), a chord `<C4 E4 G4>`, a rest `r`, a
 * full-bar rest `R` or a space `s`, then an optional value (`/4`, `/8.`, `/1`;
 * the previous value when absent) and `~` to tie into the next event. Note
 * suffixes: `!` force an accidental, `?` courtesy accidental, `@lower` draw
 * on another staff.
 *
 * Marks follow their event in brackets: `C5/4[artic.staccato dyn.p]`. `^` or
 * `_` force a side, `="text"` gives text, `name=value` after a mark sets one of
 * its parameters, and `+kind` / `-kind` start and end spanners. Brackets after
 * a barline attach to that barline. Bare `role=`, `tag=`, `stem=` and
 * `size=cue` set event properties.
 *
 * Groups: `3:2{ … }` tuplet, `acc{ … }` acciaccaturas and `grace{ … }`
 * appoggiaturas before the next event, `after{ … }` after-graces.
 * Directives: `clef=bass`, `key=-5`, `time=3/4` (or `time=2/2:cut`).
 * Barlines: `|`, `|double`, `|final`, `|dashed`, `|:`, `:|`, `:|:`.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { midi, parsePitch } from '../core/pitch';
import type { KeySignature } from '../core/pitch';
import { entry, isNotation } from '../catalogue/registry';
import type { NotationId } from '../catalogue/ids';
import { durationOf, meterLength } from '../model/time';
import type {
  Anchor, Attachment, ChordEvent, ClefChange, ClefKind, DurationBase, EndBarline, Grace, Labels, Measure, Note,
  NoteValue, Score, ScoreEvent, Spanner, StaffDef, StaffGroup, TimeSignature, Tuplet
} from '../model/types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const VALUES: Record<string, DurationBase> = {
  '0': 'breve', '1': 'whole', '2': 'half', '4': 'quarter', '8': 'eighth', '16': '16th', '32': '32nd', '64': '64th', '128': '128th'
};
const CLEFS: readonly ClefKind[] = ['treble', 'bass', 'alto', 'tenor', 'treble-8vb', 'treble-8va', 'bass-8vb'];
const BARLINES: Record<string, { end: EndBarline; repeatStart?: boolean }> = {
  '|': { end: 'barline.single' }, '|double': { end: 'barline.double' }, '|final': { end: 'barline.final' },
  '|dashed': { end: 'barline.dashed' }, ':|': { end: 'nav.repeat-end' },
  '|:': { end: 'barline.single', repeatStart: true }, ':|:': { end: 'nav.repeat-end', repeatStart: true }
};
const EVENT_PROPERTIES = new Set(['role', 'tag', 'stem', 'size']);

export class ShorthandError extends Error {}

interface MarkItem {
  kind: string;
  role: 'mark' | 'start' | 'end';
  side?: 'above' | 'below';
  text?: string;
  params: Record<string, string | number | boolean>;
}

interface Property { name: string; value: string | number | boolean }

interface PendingSpan { item: MarkItem; anchor: Anchor; at: number; order: number }

/** What a bracket group attaches to. */
type Target =
  | { type: 'event'; event: Mutable<ScoreEvent> }
  | { type: 'barline'; before: number; after: number };

function parseTime(text: string): TimeSignature {
  const match = /^(\d+)\/(\d+)(?:[\s:]+(common|cut|numeric))?$/.exec(text.trim());
  if (!match) throw new ShorthandError(`Not a time signature: "${text}"`);
  return { beats: Number(match[1]), beatType: Number(match[2]), symbol: (match[3] as TimeSignature['symbol']) ?? 'numeric' };
}

function parseKey(text: string): KeySignature {
  const match = /^(-?\d+)(?:[\s:]+(major|minor))?$/.exec(text.trim());
  if (!match) throw new ShorthandError(`Not a key: "${text}"`);
  return { fifths: Number(match[1]), mode: (match[2] as KeySignature['mode']) ?? 'major' };
}

/** Splits a staff line into tokens, keeping bracket groups, chords and quoted text whole. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  const readUntil = (close: string): number => {
    let end = index + 1, quoted = false;
    while (end < text.length && (quoted || text[end] !== close)) { if (text[end] === '"') quoted = !quoted; end++; }
    if (end >= text.length) throw new ShorthandError(`Missing ${close}`);
    return end + 1;
  };
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index++; continue; }
    let end: number;
    if (char === '[') end = readUntil(']');
    else if (char === '{' || char === '}') end = index + 1;
    else {
      end = char === '<' ? readUntil('>') : index;
      while (end < text.length && !/[\s[\]{}]/.test(text[end])) end++;
      if (text[end] === '{') end++;
    }
    tokens.push(text.slice(index, end));
    index = end;
  }
  return tokens;
}

function parseMarks(body: string): { marks: MarkItem[]; properties: Property[] } {
  const marks: MarkItem[] = [];
  const properties: Property[] = [];
  for (const match of body.matchAll(/([+\-^_]*)([\w.-]+)(?:=("([^"]*)"|\S+))?/g)) {
    const [, prefixes, name, raw, quoted] = match;
    const value = quoted ?? (raw === undefined ? undefined : raw === 'true' ? true : raw === 'false' ? false
      : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw);
    if (isNotation(name)) {
      marks.push({
        kind: name,
        role: prefixes.includes('+') ? 'start' : prefixes.includes('-') ? 'end' : 'mark',
        side: prefixes.includes('^') ? 'above' : prefixes.includes('_') ? 'below' : undefined,
        text: value === undefined ? undefined : String(value),
        params: {}
      });
    } else if (EVENT_PROPERTIES.has(name)) {
      properties.push({ name, value: value ?? true });
    } else {
      const owner = marks.at(-1);
      if (!owner) throw new ShorthandError(`"${name}" is neither a notation nor a parameter of one`);
      owner.params[name] = value ?? true;
    }
  }
  return { marks, properties };
}

/** A sortable instant for pairing spanner ends with starts. */
const instant = (measure: number, offset: Fraction): number => measure * 1e4 + F.toNumber(offset);

interface Stream {
  staff: string;
  voice: number;
  measure: number;
  offset: Fraction;
  value: NoteValue;
}

export function parseShorthand(source: string, title = 'Example'): Score {
  let staves: StaffDef[] = [{ id: 'upper', clef: 'treble' }, { id: 'lower', clef: 'bass' }];
  let groupKind: StaffGroup['kind'] | 'none' = 'brace';
  let key: KeySignature = { fifths: 0, mode: 'major' };
  let time: TimeSignature = { beats: 4, beatType: 4, symbol: 'numeric' };
  let scoreTitle = title;
  const staffLines: { staff: string; voice: number; text: string; line: number }[] = [];

  source.split('\n').forEach((raw, index) => {
    const text = raw.replace(/(^|\s)\/\/.*$/, '').trim();
    if (!text) return;
    const match = /^([\w-]+)(?:\.(\d+))?\s*:\s*(.*)$/.exec(text);
    if (!match) throw new ShorthandError(`Line ${index + 1}: expected "name: …"`);
    const [, name, voice, rest] = match;
    if (name === 'staves') {
      staves = rest.split(',').map(part => {
        const [id, clef = 'treble'] = part.trim().split(/\s+/);
        if (!CLEFS.includes(clef as ClefKind)) throw new ShorthandError(`Line ${index + 1}: unknown clef ${clef}`);
        return { id, clef: clef as ClefKind };
      });
    } else if (name === 'group') groupKind = rest.trim() as typeof groupKind;
    else if (name === 'key') key = parseKey(rest);
    else if (name === 'time') time = parseTime(rest);
    else if (name === 'title') scoreTitle = rest.trim();
    else staffLines.push({ staff: name, voice: voice ? Number(voice) : 1, text: rest, line: index + 1 });
  });

  const measures: Mutable<Measure>[] = [];
  const measureAt = (index: number) => (measures[index] ??= { number: 0 });
  measureAt(0).time = time;
  measureAt(0).key = key;
  const events: Mutable<ScoreEvent>[] = [];
  const tuplets: Tuplet[] = [];
  const clefs: ClefChange[] = [];
  const attachments: Attachment[] = [];
  const starts: PendingSpan[] = [];
  const ends: PendingSpan[] = [];
  const tiesFrom: ChordEvent[] = [];
  const streams = new Map<string, Stream>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}${++counter}`;

  const timeAt = (measure: number): TimeSignature => {
    for (let index = measure; index >= 0; index--) { const found = measures[index]?.time; if (found) return found; }
    return time;
  };

  for (const { staff, voice, text, line } of staffLines) {
    const fail = (message: string): never => { throw new ShorthandError(`Line ${line}: ${message}`); };
    if (!staves.some(item => item.id === staff)) fail(`unknown staff "${staff}"`);
    const streamKey = `${staff}.${voice}`;
    const stream = streams.get(streamKey) ?? { staff, voice, measure: 0, offset: F.ZERO, value: { base: 'quarter', dots: 0 } };
    streams.set(streamKey, stream);
    const tupletStack: Tuplet[] = [];
    const groups: ('tuplet' | 'grace')[] = [];
    let grace: Grace | undefined;
    // Grace notes keep their own running value, starting at an eighth.
    let graceValue: NoteValue = { base: 'eighth', dots: 0 };
    let pendingGraces: Mutable<ChordEvent>[] = [];
    let afterCount = 0;
    let previous: Mutable<ScoreEvent> | undefined;
    let target: Target = { type: 'barline', before: stream.measure - 1, after: stream.measure };

    const timeFactor = () => tupletStack.reduce((factor, tuplet) => F.mul(factor, F.frac(tuplet.normal, tuplet.actual)), F.ONE);

    const anchorsFor = (mark: MarkItem): Anchor[] => {
      const known = entry(mark.kind);
      const kind = known.model === 'structure' ? 'event' : known.anchor;
      if (target.type === 'barline') {
        if (kind !== 'barline' && kind !== 'measure') fail(`${mark.kind} must follow an event, not a barline`);
        return [mark.role === 'end'
          ? { barline: { measure: (target as { before: number }).before, side: 'end' } }
          : { barline: { measure: (target as { after: number }).after, side: 'start' } }];
      }
      const event = target.event;
      switch (kind) {
        case 'event': return [{ event: event.id }];
        case 'position': return [{ position: { measure: event.measure, offset: event.offset, staff } }];
        case 'barline': case 'measure': return [{ barline: { measure: event.measure, side: 'end' } }];
        case 'note':
          if (event.kind !== 'chord') return fail(`${mark.kind} needs a note`);
          return event.notes.map(note => ({ note: note.id }));
      }
    };

    const applyGroup = (token: string) => {
      const { marks, properties } = parseMarks(token.slice(1, -1));
      if (properties.length) {
        if (target.type !== 'event') fail('event properties must follow an event');
        const event = (target as { event: Mutable<ScoreEvent> }).event as Mutable<ChordEvent>;
        for (const { name, value } of properties) {
          const labels: Mutable<Labels> = { ...event.labels };
          if (name === 'role') { labels.roles = [...(labels.roles ?? []), String(value)]; event.labels = labels; }
          if (name === 'tag') { labels.tags = [...(labels.tags ?? []), String(value)]; event.labels = labels; }
          if (name === 'stem') event.stem = value === 'down' ? 'down' : 'up';
          if (name === 'size' && value === 'cue') event.cue = true;
        }
      }
      const perNote = new Map<string, number>();
      for (const mark of marks) {
        const anchors = anchorsFor(mark);
        const known = entry(mark.kind);
        if (known.model === 'spanner') {
          if (mark.role === 'mark') fail(`${mark.kind} is a spanner: write +${mark.kind} … -${mark.kind}`);
          const at = target.type === 'event' ? instant(target.event.measure, target.event.offset)
            : mark.role === 'end' ? instant(target.after, F.ZERO) - 0.5 : instant(target.after, F.ZERO);
          (mark.role === 'start' ? starts : ends).push({ item: mark, anchor: anchors[0], at, order: starts.length + ends.length });
          continue;
        }
        if (mark.role !== 'mark') fail(`${mark.kind} is not a spanner`);
        // Several marks of one kind on a chord go to its notes from the bottom up.
        const sameKind = marks.filter(other => other.kind === mark.kind).length;
        let chosen = anchors;
        if (anchors.length > 1 && sameKind > 1) {
          const index = perNote.get(mark.kind) ?? 0;
          perNote.set(mark.kind, index + 1);
          chosen = [anchors[Math.min(index, anchors.length - 1)]];
        }
        for (const anchor of chosen)
          attachments.push({
            id: nextId('a'), kind: mark.kind as NotationId, anchor,
            ...(mark.side ? { side: mark.side } : {}), ...(mark.text !== undefined ? { text: mark.text } : {}),
            ...(Object.keys(mark.params).length ? { params: { ...mark.params } } : {})
          });
      }
    };

    const addEvent = (token: string) => {
      const match = /^(?:<([^>]*)>|([A-Ga-g](?:##|x|#|bb|b|n)?-?\d+[!?]?(?:@[\w-]+)?)|([rRs]))(?:\/(\d+)(\.*))?(~)?$/.exec(token);
      if (!match) return fail(`cannot read "${token}"`);
      const [, chordBody, single, restKind, digits, dots, tie] = match;
      let value = grace ? graceValue : stream.value;
      if (digits !== undefined) {
        if (!VALUES[digits]) fail(`unknown note value /${digits}`);
        value = { base: VALUES[digits], dots: dots?.length ?? 0 };
        if (grace) graceValue = value; else stream.value = value;
      }
      const id = nextId('e');
      const common = {
        id, measure: stream.measure, staff, voice, offset: stream.offset,
        ...(tupletStack.length && !grace ? { tuplet: tupletStack.at(-1)!.id } : {})
      };
      let event: Mutable<ScoreEvent>;
      if (restKind === 'R') event = { ...common, kind: 'rest', value: { base: 'whole', dots: 0 }, fullBar: true };
      else if (restKind === 'r') event = { ...common, kind: 'rest', value };
      else if (restKind === 's') event = { ...common, kind: 'space', length: F.mul(durationOf(value), timeFactor()) };
      else {
        const notes: Note[] = (chordBody?.trim().split(/\s+/) ?? [single!]).map(text => {
          const parts = /^([^!?@]+)([!?])?(?:@([\w-]+))?$/.exec(text);
          if (!parts) return fail(`cannot read note "${text}"`);
          const [, pitchText, accidental, other] = parts;
          if (other && !staves.some(item => item.id === other)) fail(`unknown staff @${other}`);
          return {
            id: '', pitch: parsePitch(pitchText),
            ...(accidental ? { accidental: accidental === '!' ? 'show' as const : 'courtesy' as const } : {}),
            ...(other ? { staff: other } : {})
          };
        }).sort((a, b) => midi(a.pitch) - midi(b.pitch)).map((note, index) => ({ ...note, id: `${id}.${index + 1}` }));
        event = { ...common, kind: 'chord', value, notes };
      }
      if (grace) {
        if (event.kind !== 'chord') fail('grace groups hold notes only');
        const graceEvent = { ...(event as Mutable<ChordEvent>), grace: { ...grace } };
        if (grace.placement === 'after') {
          if (!previous) fail('after{ } needs an event before it');
          Object.assign(graceEvent, { measure: previous!.measure, offset: previous!.offset, graceOrder: afterCount++ });
          events.push(graceEvent);
        } else pendingGraces.push(graceEvent);
        if (tie) tiesFrom.push(graceEvent);
        target = { type: 'event', event: graceEvent };
        return;
      }
      events.push(event);
      pendingGraces.forEach((graceEvent, order) => events.push({ ...graceEvent, measure: event.measure, offset: event.offset, graceOrder: order }));
      pendingGraces = [];
      if (tie && event.kind === 'chord') tiesFrom.push(event);
      previous = event;
      target = { type: 'event', event };
      const length = event.kind === 'rest' && event.fullBar ? meterLength(timeAt(stream.measure))
        : event.kind === 'space' ? event.length : F.mul(durationOf(value), timeFactor());
      stream.offset = F.add(stream.offset, length);
    };

    const barline = (token: string) => {
      const kind = BARLINES[token];
      if (!kind) return fail(`unknown barline "${token}"`);
      const empty = F.isZero(stream.offset);
      if (!empty) {
        if (kind.end !== 'barline.single') measureAt(stream.measure).end = kind.end;
        stream.measure++;
        stream.offset = F.ZERO;
      }
      if (kind.repeatStart) measureAt(stream.measure).repeatStart = true;
      target = { type: 'barline', before: stream.measure - 1, after: stream.measure };
    };

    let tokens: string[] = [];
    try { tokens = tokenize(text); } catch (error) { fail((error as Error).message); }
    for (const token of tokens) {
      if (token.startsWith('[')) { applyGroup(token); continue; }
      if (token === '}') {
        const group = groups.pop();
        if (!group) fail('unmatched }');
        if (group === 'tuplet') tupletStack.pop();
        else { grace = undefined; afterCount = 0; }
        continue;
      }
      const tupletOpen = /^(\d+):(\d+)\{$/.exec(token);
      if (tupletOpen) {
        const tuplet: Tuplet = {
          id: nextId('t'), actual: Number(tupletOpen[1]), normal: Number(tupletOpen[2]),
          ...(tupletStack.length ? { parent: tupletStack.at(-1)!.id } : {})
        };
        tuplets.push(tuplet); tupletStack.push(tuplet); groups.push('tuplet');
        continue;
      }
      const graceOpen = /^(acc|grace|after)\{$/.exec(token);
      if (graceOpen) {
        grace = graceOpen[1] === 'after' ? { kind: 'appoggiatura', placement: 'after' }
          : { kind: graceOpen[1] === 'acc' ? 'acciaccatura' : 'appoggiatura', placement: 'before' };
        groups.push('grace');
        continue;
      }
      const directive = /^(clef|key|time)=(.+)$/.exec(token);
      if (directive) {
        const [, name, value] = directive;
        if (name === 'clef') {
          if (!CLEFS.includes(value as ClefKind)) fail(`unknown clef ${value}`);
          if (stream.measure === 0 && F.isZero(stream.offset)) staves = staves.map(item => item.id === staff ? { ...item, clef: value as ClefKind } : item);
          else clefs.push({ id: nextId('c'), staff, measure: stream.measure, offset: stream.offset, clef: value as ClefKind });
        } else {
          if (!F.isZero(stream.offset)) fail(`${name}= must open a measure`);
          if (name === 'key') measureAt(stream.measure).key = parseKey(value);
          else measureAt(stream.measure).time = parseTime(value);
        }
        continue;
      }
      if (/^:?\|[\w:]*$/.test(token)) { barline(token); continue; }
      addEvent(token);
    }
    if (groups.length) fail('unclosed {');
    if (pendingGraces.length) fail('grace notes without a main event');
  }

  // Measures that hold anything; a trailing barline opens none.
  const used = Math.max(0, ...events.map(event => event.measure)) + 1;
  measures.length = Math.max(used, 1);
  for (let index = 0; index < measures.length; index++) measureAt(index);

  const lengthOf = (index: number) => F.mul(F.ONE, meterLength(timeAt(index)));
  const soundingEnd = (event: Mutable<ScoreEvent>): Fraction => {
    if (event.kind === 'space') return F.add(event.offset, event.length);
    if (event.kind === 'rest' && event.fullBar) return F.add(event.offset, lengthOf(event.measure));
    if (event.kind === 'chord' && event.grace) return event.offset;
    let factor = F.ONE;
    for (let tuplet = tuplets.find(item => item.id === event.tuplet); tuplet; tuplet = tuplets.find(item => item.id === tuplet!.parent))
      factor = F.mul(factor, F.frac(tuplet.normal, tuplet.actual));
    return F.add(event.offset, F.mul(durationOf(event.value), factor));
  };
  const contentOf = (index: number) => events.filter(event => event.measure === index).reduce((end, event) => F.max(end, soundingEnd(event)), F.ZERO);

  // A short first measure is a pickup and numbering starts after it.
  const pickup = measures.length > 1 && F.lt(contentOf(0), lengthOf(0)) && F.gt(contentOf(0), F.ZERO);
  measures.forEach((measure, index) => {
    measure.number = pickup ? index : index + 1;
    if (pickup && index === 0) measure.length = contentOf(0);
  });

  // Voices that stop early are filled with space so every voice spans its measure.
  for (const { staff, voice } of streams.values()) {
    measures.forEach((measure, index) => {
      const own = events.filter(event => event.staff === staff && event.voice === voice && event.measure === index);
      if (!own.length) return;
      const filled = own.reduce((end, event) => F.max(end, soundingEnd(event)), F.ZERO);
      const length = measure.length ?? lengthOf(index);
      if (F.lt(filled, length))
        events.push({ id: nextId('e'), kind: 'space', measure: index, staff, voice, offset: filled, length: F.sub(length, filled) });
    });
  }

  const spanners: Spanner[] = [];
  const order = (a: Mutable<ScoreEvent>, b: Mutable<ScoreEvent>) => a.measure - b.measure || F.compare(a.offset, b.offset);
  for (const from of tiesFrom) {
    const next = events
      .filter((event): event is Mutable<ChordEvent> => event.kind === 'chord' && event.staff === from.staff &&
        event.voice === from.voice && !event.grace === !from.grace && order(event, from as Mutable<ScoreEvent>) > 0)
      .sort(order)[0];
    if (!next) throw new ShorthandError(`Tie from ${from.id} has no following chord`);
    for (const note of from.notes) {
      const to = next.notes.find(other => midi(other.pitch) === midi(note.pitch));
      if (to) spanners.push({ id: nextId('s'), kind: 'tie', start: { note: note.id }, end: { note: to.id } });
    }
  }

  // Each end closes the latest open start of its kind at or before it.
  const open = [...starts];
  for (const end of [...ends].sort((a, b) => a.at - b.at || a.order - b.order)) {
    const start = open.filter(item => item.item.kind === end.item.kind && item.at <= end.at)
      .sort((a, b) => b.at - a.at || b.order - a.order)[0];
    if (!start) throw new ShorthandError(`-${end.item.kind} has no matching +${end.item.kind}`);
    open.splice(open.indexOf(start), 1);
    const params = { ...start.item.params, ...end.item.params };
    spanners.push({
      id: nextId('s'), kind: start.item.kind as NotationId, start: start.anchor, end: end.anchor,
      ...(start.item.side ? { side: start.item.side } : {}), ...(start.item.text !== undefined ? { text: start.item.text } : {}),
      ...(Object.keys(params).length ? { params } : {})
    });
  }
  if (open.length) throw new ShorthandError(`Unclosed: ${open.map(item => `+${item.item.kind}`).join(', ')}`);

  // Assigned inside the header callback, so read it through its declared type.
  const grouping = groupKind as StaffGroup['kind'] | 'none';
  return {
    schema: 1,
    meta: { title: scoreTitle },
    staves,
    groups: grouping !== 'none' && staves.length > 1 ? [{ kind: grouping, staves: staves.map(staff => staff.id) }] : [],
    measures,
    events: events.sort(order),
    tuplets,
    clefs,
    attachments,
    spanners
  };
}
