import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as F from '../core/fraction';
import { inferClefChanges } from '../import/clefs';
import type { ClefRule } from '../import/clefs';
import { engrave } from '../layout/engrave';
import { validateScore } from '../model/validate';
import { parseShorthand } from '../shorthand/parse';

const RULE: ClefRule = { alternate: 'treble', fitLedgers: 2, changeCost: 2, splitCost: 4 };

/** The lower staff's starting clef and each inferred change, as "bar:offset clef" (bars from 1). */
function clefs(shorthand: string, rule: ClefRule = RULE): string[] {
  const score = inferClefChanges(parseShorthand(`time: 3/4\n${shorthand}`, 'test'), { lower: rule });
  assert.deepEqual(validateScore(score).filter(issue => issue.level === 'error'), []);
  engrave(score, { width: 60 });
  return [score.staves.find(staff => staff.id === 'lower')!.clef,
    ...score.clefs.map(change => `${change.measure + 1}:${F.format(change.offset)} ${change.clef}`)];
}

test('A left hand that stays high takes treble clef and returns at the barline', () => {
  assert.deepEqual(clefs('lower: E3/4 B3 E4 | <E4 G#4>/4 <G#4 B4> <B4 E5> | <A4 C#5>/4 <G#4 B4> <E4 G#4> | E3/4 B3 E4 |'),
    ['bass', '2:0 treble', '4:0 bass']);
});

test('A brief excursion stays on ledger lines', () => {
  assert.deepEqual(clefs('lower: E3/4 <B3 E4> <E4 G#4> | E3/4 <B3 E4> <E4 G#4> |'), ['bass']);
});

test('Chords far above a bass note change clef after it', () => {
  assert.deepEqual(clefs('lower: F#3/4 <E4 A4> <A4 C#5> | E2/4 <G#3 B3> <B3 E4> |'), ['bass', '1:1/4 treble', '2:0 bass']);
});

test('A low note never goes into the alternate clef', () => {
  // E3 needs three ledger lines under a treble staff, so each bass note returns to bass clef.
  assert.deepEqual(clefs('lower: <A4 C#5>/4 <A4 C#5> <A4 C#5> | E3/4 <A4 C#5> <A4 C#5> |'),
    ['treble', '2:0 bass', '2:1/4 treble']);
});

test('A staff without a rule keeps its clef', () => {
  const score = parseShorthand('lower: <A4 C#5>/1 |', 'test');
  assert.deepEqual(inferClefChanges(score, {}).clefs, []);
});
