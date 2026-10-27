import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const declaration = source.slice(source.indexOf('async function reconcileUncertainTask('), source.indexOf('async function main()'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function simulate({ stage = 'validation-uncertain', conclusion = 'success', missingId = false, requestOnly = false, delayedDiscovery = false, observed, launches = 1 } = {}) {
  const sha = 'a'.repeat(40), records = new Map(), calls = [];
  let discoveryCalls = 0;
  let prior = { id: 'old', dir: '/old', reason: 'uncertain', task: { stage, kind: 'normal', attempt: 1, sha, remoteHeadSha: 'b'.repeat(40), remoteBranch: 'auto/normal-old' } };
  const context = {
    path, runDir: '/new', config: { repositoryPath: '/repo' }, policy: { repository: 'test/repo' },
    readdir: async dir => { assert.equal(dir, '/old'); return missingId ? [] : ['normal-after-1-ci.json']; },
    json: async () => requestOnly ? { sha, request: 'original-request' } : { sha, run: 123 },
    save: async (file, value) => records.set(file, value),
    gh: async args => { calls.push(args); if (args[1] === 'list') return JSON.stringify(delayedDiscovery && discoveryCalls++ === 0 ? [] : [{ databaseId: 123, displayTitle: `Verify Automation ${sha} original-request` }]); assert.equal(args[1], 'view'); assert.equal(args[2], '123'); return JSON.stringify({ databaseId: 123, displayTitle: `Verify Automation ${sha} original-request`, status: conclusion === 'pending' ? 'in_progress' : 'completed', conclusion }); },
    git: async args => { calls.push(args); assert.equal(args[0], 'ls-remote'); return `${observed ?? sha}\trefs/heads/auto/normal-old`; },
  };
  const fn = new AsyncFunction(...Object.keys(context), 'prior', declaration + '\nreturn reconcileUncertainTask(prior);');
  let outcome;
  for (let i = 0; i < launches; i++) {
    outcome = await fn(...Object.values(context), prior);
    if (i + 1 < launches) prior = { ...prior, id: `launch-${i}`, dir: '/new', task: records.get(path.join('/new', 'task.json')) };
  }
  return { outcome, records, calls };
}
test('completed exact original workflow supplies proof before candidate repair', async () => {
  for (const conclusion of ['success', 'failure', 'timed_out']) {
    const run = await simulate({ conclusion });
    assert.equal(run.outcome.previous.task.stage, 'needs-fix');
    assert.equal(run.records.get(path.join('/new', 'uncertainty-proof.json')).run, 123);
    assert.equal(run.calls.length, 1);
  }
});
test('three launches preserve uncertain workflow ID and never redispatch', async () => {
  const run = await simulate({ conclusion: 'pending', launches: 3 });
  assert.equal(run.outcome.status, 'awaiting-verification');
  assert.equal(run.records.get(path.join('/new', 'task.json')).stage, 'validation-uncertain');
  assert.equal(run.records.get(path.join('/new', 'task.json')).uncertaintyDir, '/old');
  assert.equal(run.calls.length, 3);
});
test('missing original workflow ID remains unresolved over three launches', async () => {
  const run = await simulate({ missingId: true, launches: 3 });
  assert.equal(run.outcome.status, 'awaiting-verification');
  assert.equal(run.calls.length, 0);
});
test('uncertain push accepts acknowledged or unchanged heads and requires approval for divergence', async () => {
  for (const observed of ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]) {
    const run = await simulate({ stage: 'publishing-uncertain', observed });
    if (observed.startsWith('c')) assert.equal(run.outcome.status, 'awaiting-approval');
    else assert.equal(run.outcome.previous.task.remoteHeadSha, observed);
    assert.equal(run.calls.length, 1);
  }
});

test('request-only uncertain dispatch discovers the original exact-title workflow read-only', async () => {
  const run = await simulate({ requestOnly: true });
  assert.equal(run.outcome.previous.task.stage, 'needs-fix');
  assert.equal(run.outcome.previous.task.uncertaintyProof.run, 123);
  assert.deepEqual(run.calls.map(args => args.slice(0, 2)), [['run', 'list'], ['run', 'view']]);
});

test('late workflow title is discovered on next launch without repeating dispatch', async () => {
  const run = await simulate({ requestOnly: true, delayedDiscovery: true, launches: 2 });
  assert.equal(run.outcome.previous.task.uncertaintyProof.run, 123);
  assert.deepEqual(run.calls.map(args => args.slice(0, 2)), [['run', 'list'], ['run', 'list'], ['run', 'view']]);
});
