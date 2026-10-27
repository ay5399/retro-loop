import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TASK_TIMING } from './budget.mjs';

const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
const declarations = section('async function resumePendingRelease(', 'async function prepareRecovery(') + section('async function release(', '\nawait mkdir(path.join(stateDir');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sha = 'a'.repeat(40), merged = 'b'.repeat(40);
const previous = { id: 'previous', task: { kind: 'normal', pr: 17, sha, branch: 'auto/normal-previous', result: { prevention: 'Regression test' } } };

async function fixture(run, info = { state: 'OPEN', headRefOid: sha }, releaseProblems = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'retro-release-guard-'));
  const stateDir = path.join(root, 'state'), runDir = path.join(root, 'run');
  const calls = [];
  try {
    await mkdir(stateDir); await mkdir(runDir);
    const json = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
    const save = async (file, value) => writeFile(file, JSON.stringify(value));
    const gh = async args => {
      calls.push(['gh', args]);
      if (args[0] === 'pr' && args[1] === 'view') {
        if (args.at(-1) === 'headRefOid,baseRefOid') return JSON.stringify({ headRefOid: sha, baseRefOid: 'current-main' });
        if (args.at(-1) === 'mergeCommit') return JSON.stringify({ mergeCommit: { oid: merged } });
        return JSON.stringify(info);
      }
      return '';
    };
    const context = {
      path, stateDir, runDir, json, save, gh, TASK_TIMING,
      policy: { repository: 'test/repo' }, deadline: Date.now() + 90 * 60_000,
      auditProblems: () => releaseProblems,
      api: async endpoint => {
        calls.push(['api', endpoint]);
        if (endpoint.endsWith('/production')) return [{ deployment_branch_policy: { custom_branch_policies: true } }];
        if (endpoint.endsWith('/deployment-branch-policies')) return [{ branch_policies: [{ name: 'main', type: 'branch' }] }];
        return [{ check_runs: ['Quality', 'Build', 'E2E'].map(name => ({ name })) }];
      },
      git: async args => {
        calls.push(['git', args]);
        if (args[0] === 'merge-base' || args[1] === 'origin/main') return 'current-main';
        if (args[0] === 'rev-parse' && args[1].endsWith('^{tree}')) return 'same-tree';
        return '';
      },
      dispatchWorkflow: async options => {
        calls.push(['dispatch']);
        await options.onDispatch({ databaseId: 91 });
        return { databaseId: 91 };
      },
      note: async () => { calls.push(['note']); throw new Error('Reporting unavailable'); },
      workspace: async () => { calls.push(['workspace']); throw new Error('Unexpected new work'); },
      withWorkspace: async () => { calls.push(['new-work']); throw new Error('Unexpected new work'); }
    };
    const load = new AsyncFunction(...Object.keys(context), `${declarations}; return { release, resumePendingRelease };`);
    const functions = await load(...Object.values(context));
    await run({ ...functions, calls, stateDir, runDir, json, save });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('legacy release checkpoints require owner identification without repeating failed work or replacing the PR', async () => fixture(async ({ resumePendingRelease, calls, runDir, json }) => {
  for (const legacy of [{ id: 'old-run', result: { status: 'awaiting-release', pr: 17 } }, { ...previous, task: { ...previous.task, result: {} } }]) {
    const outcome = await resumePendingRelease(legacy);
    assert.equal(outcome.status, 'awaiting-approval');
    assert.equal((await json(path.join(runDir, 'task.json'))).stage, 'awaiting-approval');
    assert.deepEqual(calls, []);
  }
}));

test('production halt prevents release and pending-release resume before any external or new-work call', async () => fixture(async ({ release, resumePendingRelease, calls, stateDir, save }) => {
  await save(path.join(stateDir, 'halt.json'), { sha: merged, run: 91 });
  await assert.rejects(release('unused', sha, 17), /Production halt/);
  await assert.rejects(resumePendingRelease(previous), /Uncertain production state/);
  assert.deepEqual(calls, []);
}));

test('already merged prior PR saves halt and refuses redispatch or replacement work', async () => fixture(async ({ resumePendingRelease, calls, stateDir, json }) => {
  await assert.rejects(resumePendingRelease(previous), /already merged/);
  assert.equal((await json(path.join(stateDir, 'halt.json'))).sha, merged);
  assert.deepEqual(calls.map(call => call[0]), ['gh']);
}, { state: 'MERGED', headRefOid: sha, mergeCommit: { oid: merged } }));

test('missing release audit defers pending release before any external or new-work call', async () => fixture(async ({ resumePendingRelease, calls }) => {
  const result = await resumePendingRelease(previous);
  assert.deepEqual(result, { status: 'awaiting-release-conditions', problems: ['Release billing audit expired'] });
  assert.deepEqual(calls, []);
}, undefined, ['Release billing audit expired']));

for (const info of [{ state: 'CLOSED', headRefOid: sha }, { state: 'OPEN', headRefOid: 'c'.repeat(40) }]) {
  test(`changed prior PR ${info.state}/${info.headRefOid.slice(0, 1)} refuses release or replacement`, async () => fixture(async ({ resumePendingRelease, calls }) => {
    await assert.rejects(resumePendingRelease(previous), /Previous PR changed/);
    assert.deepEqual(calls.map(call => call[0]), ['gh']);
  }, info));
}

test('successful release remains successful when result notification fails', async () => fixture(async ({ release, calls, stateDir, runDir, json }) => {
  assert.equal(await release('unused', sha, 17, 18), true);
  assert.equal(await json(path.join(stateDir, 'halt.json'), null), null);
  assert.equal((await json(path.join(runDir, 'release-notification.json'))).status, 'pending');
  assert.equal(calls.filter(call => call[0] === 'dispatch').length, 1);
  assert.ok(!calls.some(call => call[0] === 'gh' && call[1][0] === 'run' && call[1][1] === 'view'));
}));
