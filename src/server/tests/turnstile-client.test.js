import test from 'node:test';
import assert from 'node:assert/strict';
import { challenge } from '../../security/turnstile.ts';
test('explicit script loading starts challenge without depending on implicit ready()', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let options, removed = 0;
  const cfApi = {
    render(_container, value) { options = value; return 'widget-id'; },
    execute(id) { assert.equal(id, 'widget-id'); queueMicrotask(() => options.callback('verified-token')); },
    remove(id) { assert.equal(id, 'widget-id'); removed++; },
  };
  globalThis.window = {};
  globalThis.document = {
    createElement: tag => ({ tag, remove() {} }),
    head: { appendChild(script) { assert.match(script.src, /render=explicit/); globalThis.window.turnstile = cfApi; queueMicrotask(() => script.onload()); } },
    body: { appendChild() {} },
  };
  try {
    assert.equal(await challenge('site-key'), 'verified-token');
    assert.equal(options.action, 'fantaisie_playback');
    assert.equal(options.execution, 'execute');
    assert.equal(removed, 1);
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
