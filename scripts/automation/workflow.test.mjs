import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWorkflow } from './workflow.mjs';

function fixture(responses, overrides = {}) {
  let clock = 0;
  const calls = [], states = [];
  const options = { repository: 'owner/retro', workflow: 'verify.yml', expectedTitle: 'verify unique-request', deadline: 10, pollIntervalMs: 2,
    now: () => clock, sleep: async ms => { clock += ms; }, onDispatch: async state => { states.push(state); },
    gh: async args => { calls.push(args); const value = responses.shift(); if (value instanceof Error) throw value; return value ?? '[]'; }, ...overrides };
  return { options, calls, states };
}
const run = { databaseId: 123, displayTitle: 'verify unique-request', url: 'https://github.com/owner/retro/actions/runs/123', event: 'workflow_dispatch', headBranch: 'main' };

test('uses acknowledged URL immediately despite delayed generic title', async () => {
  const f = fixture(['Created https://github.com/owner/retro/actions/runs/123']);
  assert.deepEqual(await dispatchWorkflow(f.options), { databaseId: 123, url: run.url });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.states.map(s => s.status), ['dispatching', 'acknowledged', 'discovered']);
});
test('waits for exact unique title and ignores unrelated concurrent runs', async () => {
  const f = fixture(['', JSON.stringify([{ ...run, displayTitle: 'verify.yml' }, { ...run, databaseId: 456, displayTitle: 'other request' }]), JSON.stringify([run])]);
  assert.equal((await dispatchWorkflow(f.options)).databaseId, 123);
  assert.equal(f.calls.filter(args => args[0] === 'workflow').length, 1);
  assert.ok(f.calls[1].includes('verify.yml'));
});
test('transient lookup failure retries discovery without redispatching', async () => {
  const f = fixture(['', new Error('temporary network failure'), JSON.stringify([run])]);
  assert.equal((await dispatchWorkflow(f.options)).databaseId, 123);
  assert.equal(f.calls.filter(args => args[0] === 'workflow').length, 1);
});
test('ambiguous dispatch error still discovers acknowledged server work without duplicate dispatch', async () => {
  const f = fixture([new Error('connection closed after server accepted'), JSON.stringify([run])]);
  assert.equal((await dispatchWorkflow(f.options)).databaseId, 123);
  assert.equal(f.states[1].status, 'uncertain');
  assert.equal(f.calls.filter(args => args[0] === 'workflow').length, 1);
});
test('deadline cannot select unrelated runs and never dispatches twice', async () => {
  const f = fixture(['', ...Array(8).fill(JSON.stringify([{ ...run, displayTitle: 'unrelated workflow' }]))]);
  await assert.rejects(dispatchWorkflow(f.options), /deadline reached.*must not be repeated/);
  assert.equal(f.calls.filter(args => args[0] === 'workflow').length, 1);
});
test('rejects foreign repository URL and contradictory identity', async () => {
  await assert.rejects(dispatchWorkflow(fixture(['https://github.com/other/repo/actions/runs/123']).options), /repository/);
  await assert.rejects(dispatchWorkflow(fixture(['', JSON.stringify([{ ...run, databaseId: 124 }])]).options), /ID does not match/);
});
test('rejects duplicate unique titles and wrong branch or event', async () => {
  await assert.rejects(dispatchWorkflow(fixture(['', JSON.stringify([run, run])]).options), /Multiple/);
  const f = fixture(['', JSON.stringify([{ ...run, headBranch: 'other' }, { ...run, event: 'push' }]), JSON.stringify([run])]);
  assert.equal((await dispatchWorkflow(f.options)).databaseId, 123);
  assert.equal(f.calls.length, 3);
});
test('expired deadline performs no external write', async () => {
  const f = fixture([], { deadline: 0 });
  await assert.rejects(dispatchWorkflow(f.options), /before dispatch/);
  assert.equal(f.calls.length, 0);
});
test('accepts returned run ID metadata while rejecting mismatched metadata', async () => {
  assert.equal((await dispatchWorkflow(fixture([JSON.stringify({ databaseId: 123 })]).options)).databaseId, 123);
  await assert.rejects(dispatchWorkflow(fixture([JSON.stringify({ ...run, headBranch: 'other' })]).options), /metadata/);
});
