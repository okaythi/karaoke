import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTRIES as CATALOGUE } from '../catalogue/registry';
import { validateScore } from '../model/validate';
import { parseShorthand } from '../shorthand/parse';

for (const item of CATALOGUE) {
  item.examples.forEach((example, number) => {
    test(`${item.id} example ${number + 1} parses and validates`, () => {
      const score = parseShorthand(example.score, item.name);
      const errors = validateScore(score).filter(issue => issue.level === 'error');
      assert.deepEqual(errors, []);
    });
  });
}

test('every catalogue entry has at least one example', () => {
  assert.deepEqual(CATALOGUE.filter(item => !item.examples.length).map(item => item.id), []);
});
