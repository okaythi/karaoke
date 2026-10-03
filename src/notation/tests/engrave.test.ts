import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTRIES as CATALOGUE } from '../catalogue/registry';
import { engrave } from '../layout/engrave';
import { parseShorthand } from '../shorthand/parse';
import { clearingHeight } from '../layout/curves';

test('Slur endpoint clearance uses the vertical deficit when curvature is capped', () => {
  for (const side of ['above', 'below'] as const) {
    const sign = side === 'above' ? -1 : 1;
    const edge = sign * 2;
    const box = { x0: 0.3, x1: 0.5, y0: edge, y1: edge };
    const result = clearingHeight({ x: 0, y: 0 }, { x: 10, y: 0 }, [box], side, 1, 4.5, 0.3);
    assert.equal(result.height, sign * 4.5);
    assert.ok(result.lift > 0 && result.lift < 2.3, 'A nearby obstacle must not launch the slur far from its notes');
    for (const x of [0.3, 0.4, 0.5]) {
      const t = x / 10;
      assert.ok(result.lift + 3 * t * (1 - t) * 4.5 >= 2.3 - 1e-6);
    }
  }
});

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
