import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedCompletion } from './live-verification.mjs';
const fixture = overrides => boundedCompletion({ inputs: ['one', 'two', 'three'], signal: new AbortController().signal, expiresAt: Date.now() + 10000, run: async input => ({ text: input }), ...overrides });

test('exactly three completed turns pass; incomplete, extra and altered turns cannot be hidden', async () => {
  const normal = fixture();
  for (const input of ['one', 'two', 'three']) assert.equal((await normal.complete(input)).text, input);
  normal.assertComplete();
  await assert.rejects(normal.complete('four'));
  assert.throws(normal.assertComplete);
  const partial = fixture();
  await partial.complete('one');
  assert.throws(partial.assertComplete);
  const altered = fixture();
  await assert.rejects(altered.complete('wrong'));
  assert.throws(altered.assertComplete);
});

test('expired, aborted, concurrent and failed inference cannot be turned into a passing result', async () => {
  for (const bounded of [fixture({ expiresAt: Date.now() - 1 }), fixture({ signal: AbortSignal.abort() }), fixture({ run: async () => { throw new Error('inference failed'); } })]) {
    await assert.rejects(bounded.complete('one'));
    assert.throws(bounded.assertComplete);
  }
  let finish;
  const concurrent = fixture({ run: () => new Promise(resolve => { finish = resolve; }) });
  const first = concurrent.complete('one');
  await assert.rejects(concurrent.complete('two'));
  finish({ text: 'one' }); await first;
  assert.throws(concurrent.assertComplete);
});
