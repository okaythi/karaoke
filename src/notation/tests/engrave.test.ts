import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTRIES as CATALOGUE } from '../catalogue/registry';
import { engrave } from '../layout/engrave';
import { parseShorthand } from '../shorthand/parse';

for (const item of CATALOGUE) {
  item.examples.forEach((example, number) => {
    test(`${item.id} example ${number + 1} engraves`, () => {
      const result = engrave(parseShorthand(example.score, item.name), { width: example.width ?? 90 });
      assert.ok(result.systems.length > 0);
      for (const system of result.systems) {
        assert.ok(system.items.length > 0);
        for (const drawn of system.items) for (const value of Object.values(drawn.box)) assert.ok(Number.isFinite(value), `${drawn.element} has a non-finite box`);
      }
    });
  });
}
