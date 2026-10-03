import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as F from '../core/fraction';
import { importAligned } from '../import/aligned';
import type { AlignedImportSettings, AlignedNote } from '../import/aligned';
import { inferOttavas } from '../import/ottavas';
import type { OttavaRule } from '../import/ottavas';
import { engrave } from '../layout/engrave';
import { ScoreIndex } from '../model/query';
import type { ChordEvent, Score, Spanner } from '../model/types';
import { parseShorthand } from '../shorthand/parse';

const RULE: OttavaRule = { peakLedgers: 3, supportLedgers: 1, supportNotes: 2, loneMeasureNotes: 0, bridgeMeasures: 1, figureLeap: 6 };

/** Where each inferred line starts and ends, as "bar:offset" (bars from 1). */
function lines(shorthand: string, rule: OttavaRule = RULE): string[] {
  const score = parseShorthand(shorthand, 'test');
  const index = new ScoreIndex(score);
  const at = (anchor: Spanner['start']) => {
    const event = index.event((anchor as { event: string }).event);
    return `${event.measure + 1}:${F.format(event.offset)}`;
  };
  return inferOttavas(score, { treble: rule }).map(line => `${at(line.start)}-${at(line.end)}`);
}

test('An octave line ends where the high figure ends, not inside the run that follows', () => {
  // The descent from A5 is a new figure (a seventh below the G6) and needs no line.
  assert.deepEqual(lines('time: 3/4\nupper: E6/4 F6 G6 | G6/8 A5 G5 F5 E5 D5 |'), ['1:0-2:0']);
});

test('An octave line covers a whole run rather than starting inside it', () => {
  assert.deepEqual(lines('upper: D5/8 E5 F5 G5 A5 B5 D6 E6 | C5/1 |'), ['1:0-1:7/8']);
});

test('An octave line starts after a leap up into the high register', () => {
  assert.deepEqual(lines('upper: C5/4 E6 F6 E6 | C5/1 |'), ['1:1/4-1:3/4']);
});

test('An octave line never covers a chord it would push onto more ledger lines', () => {
  // <G4 B5> needs one ledger line at pitch and two under the line.
  assert.deepEqual(lines('upper: <G5 E6>/4 <G5 E6> <G4 B5> <G5 E6> | C5/1 |'), ['1:0-1:1/4', '1:3/4-1:3/4']);
  // A wide chord that needs no more ledger lines under the line stays under it.
  assert.deepEqual(lines('upper: <G5 E6>/4 <G5 E6> <C5 G6> <G5 E6> | C5/1 |'), ['1:0-1:3/4']);
});

test('Octave line passages a bar apart join only when the line can run on between them', () => {
  const high = 'E6/4 F6 E6 F6';
  assert.deepEqual(lines(`upper: ${high} | C6/4 B5 C6 D6 | ${high} | C5/1 |`), ['1:0-3:3/4']);
  assert.deepEqual(lines(`upper: ${high} | C6/4 B5 C6 D6 | ${high} | C5/1 |`, { ...RULE, bridgeMeasures: 0 }), ['1:0-1:3/4', '3:0-3:3/4']);
  assert.deepEqual(lines(`upper: ${high} | <G4 B5>/1 | ${high} | C5/1 |`), ['1:0-1:3/4', '3:0-3:3/4']);
});

test('Inferred octave lines have distinct IDs', () => {
  const score = parseShorthand('upper: <G5 E6>/4 <G5 E6> <G4 B5> <G5 E6> | C5/1 |', 'test');
  assert.deepEqual(inferOttavas(score, { treble: RULE }).map(line => line.id), ['ottava@upper.1', 'ottava@upper.1.2']);
});

/** The written octave of every note of the first chord, by pitch name. */
function writtenOctaves(score: Score): Record<string, number> {
  const { prepared } = engrave(score, { width: 60 });
  const chord = score.events.find((event): event is ChordEvent => event.kind === 'chord')!;
  return Object.fromEntries(chord.notes.map(note => [`${note.pitch.step}${note.pitch.octave}`, prepared.writtenPitch(note.id).octave]));
}

test('An octave line governs only the notes drawn on its staff', () => {
  const score = parseShorthand('upper: <G3@lower B3@lower G5 G6>/1[+ottava.8va -ottava.8va] |\nlower: R |', 'test');
  assert.deepEqual(writtenOctaves(score), { G3: 3, B3: 3, G5: 4, G6: 5 });
  // The same chord with the line on the lower staff: only the notes drawn there move.
  const onLower = { ...score, spanners: score.spanners.map(line => ({ ...line, staff: 'lower' })) };
  assert.deepEqual(writtenOctaves(onLower), { G3: 2, B3: 2, G5: 5, G6: 6 });
});

test('Octave lines are inferred for notes a chord of another staff draws on a staff', () => {
  const score = parseShorthand('upper: <G4@lower B4@lower D5@lower G5>/1 |\nlower: R |', 'test');
  const [line] = inferOttavas(score, { bass: { ...RULE, peakLedgers: 5, supportLedgers: 4, supportNotes: 0 } });
  assert.equal(line.staff, 'lower');
});

test('The hook of an octave line over one note stands clear of the 8va mark', () => {
  const score = parseShorthand('upper: C7/4[+ottava.8va -ottava.8va] C5 C5 C5 |', 'test');
  const items = engrave(score, { width: 60 }).systems[0].items.filter(item => item.element === 'ottava.8va');
  const mark = items.find(item => item.primitive.kind === 'glyph')!;
  const hook = items.find(item => item.primitive.kind === 'line' && item.primitive.x1 === item.primitive.x2)!;
  assert.ok(hook.box.x0 > mark.box.x1 + 1, 'The hook must come after the mark and a stretch of line');
});

const SETTINGS: AlignedImportSettings = {
  title: 'test', staves: [{ id: 'upper', clef: 'treble' }, { id: 'lower', clef: 'bass' }], group: 'brace',
  time: { beats: 4, beatType: 4, symbol: 'numeric' }, key: { fifths: 0, mode: 'major' },
  chord: { ticks: 60, seconds: 0.05, alignSeconds: 0.05 },
  roll: { minNotes: 3, minSeconds: 0.05, maxSeconds: 0.35, maxBeatFraction: 0.34 },
  tripletOnsets: 2, tieSeconds: 0.75, syncopation: false
};

/** One note per entry: staff, MIDI pitch and attack time; all on the first beat. */
function struck(notes: readonly (readonly ['upper' | 'lower', number, number])[]): AlignedNote[] {
  return notes.map(([staff, midi, audioStart], position) =>
    ({ id: `n${position}`, midi, audioStart, audioEnd: audioStart + 1, staff, voice: 1, tick: 0, sourceLength: 480 }));
}

/** MIDI pitches of the first chord on each staff. */
function hands(notes: AlignedNote[], settings: AlignedImportSettings): { upper: number[]; lower: number[]; moved: number } {
  const result = importAligned({ divisions: 480, notes }, settings);
  const pitches = (staff: string) => (result.score.events.find(event => event.kind === 'chord' && event.staff === staff) as ChordEvent | undefined)
    ?.notes.map(note => notes.find(source => source.id === note.id)!.midi) ?? [];
  return { upper: pitches('upper'), lower: pitches('lower'), moved: result.report.handMoves };
}

test('A note out of the right hand\'s reach joins the left hand\'s chord', () => {
  // E4 lies two octaves under E6; the left hand strikes B3 at the same moment.
  const notes = struck([['upper', 64, 1], ['upper', 80, 1], ['upper', 88, 1], ['lower', 59, 1]]);
  assert.deepEqual(hands(notes, { ...SETTINGS, reach: 16 }), { upper: [80, 88], lower: [59, 64], moved: 1 });
  assert.deepEqual(hands(notes, SETTINGS), { upper: [64, 80, 88], lower: [59], moved: 0 });
});

test('A note stays with its hand when the other hand could not reach it either', () => {
  const notes = struck([['upper', 64, 1], ['upper', 80, 1], ['upper', 88, 1], ['lower', 36, 1]]);
  assert.deepEqual(hands(notes, { ...SETTINGS, reach: 16 }), { upper: [64, 80, 88], lower: [36], moved: 0 });
});

test('A rolled chord keeps its notes however wide it is', () => {
  const notes = struck([['upper', 64, 1], ['upper', 80, 1.06], ['upper', 88, 1.12], ['lower', 59, 1]]);
  assert.deepEqual(hands(notes, { ...SETTINGS, reach: 16 }), { upper: [64, 80, 88], lower: [59], moved: 0 });
});
