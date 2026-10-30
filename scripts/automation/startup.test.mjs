import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPreviousRun, reconcileStartup } from './history.mjs';
import { liveRetryAllowed } from './live-verification.mjs';

const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  const previous = policy.startupRecovery');
const end = source.indexOf('  const tracking =', start);
assert.ok(start >= 0 && end > start, 'Actual main startup recovery markers must exist');
const startupSource = source.slice(start, end);

test('three startups preserve live-blocked SHA without entering planning', async () => scenario(async ({ add, launch, json, save }) => {
  const task = { kind: 'normal', stage: 'live-ai-blocked', branch: 'auto/normal-retained', sha: 'a'.repeat(40), liveFailure: { category: 'verification-unresolved' } };
  await add('2026-10-25-5', { status: 'awaiting-verification' }, task);
  for (const id of ['2026-10-25-13', '2026-10-25-21', '2026-10-26-5']) {
    const runDir = await add(id);
    await assert.rejects(launch(runDir, () => assert.fail('must not generate'), () => assert.fail('must not resume another release'), [], { liveRetryAllowed, process: { exitCode: 0, argv: [] } }), /unresolved/);
    assert.equal((await json(path.join(runDir, 'result.json'))).status, 'awaiting-verification');
    const retained = await json(path.join(runDir, 'task.json'));
    assert.equal(retained.sha, task.sha);
    assert.equal(retained.stage, task.stage);
  }
}));
const uncertaintySource = source.slice(source.indexOf('async function reconcileUncertainTask('), source.indexOf('async function main()'));
assert.ok(startupSource.includes('await reconcileStartup'), 'Actual startup must execute the reconciliation helper');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function scenario(callback) {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'retro-startup-'));
  const runsDir = path.join(stateDir, 'runs');
  await mkdir(runsDir);
  const json = async (file, fallback) => {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  };
  const save = async (file, value) => writeFile(file, JSON.stringify(value));
  const add = async (id, result, task) => {
    const dir = path.join(runsDir, id);
    await mkdir(dir);
    if (result) await save(path.join(dir, 'result.json'), result);
    if (task) await save(path.join(dir, 'task.json'), task);
    return dir;
  };
  const launch = async (runDir, develop, resumePendingRelease = () => assert.fail('Unexpected release resume'), releaseProblems = [], overrides = {}) => {
    const context = { policy: {}, path, stateDir, runDir, inspectPreviousRun, reconcileStartup, develop, resumePendingRelease, save, json, readdir, config: { repositoryPath: stateDir }, gh: async () => assert.fail('Unexpected workflow call'), git: async () => assert.fail('Unexpected remote call'), releaseProblems, process: { exitCode: 0 }, ...overrides };
    const run = new AsyncFunction(...Object.keys(context), uncertaintySource + startupSource + '\nreturn recovered;');
    return run(...Object.values(context));
  };
  try { await callback({ stateDir, runsDir, add, launch, json, save }); }
  finally { await rm(stateDir, { recursive: true, force: true }); }
}

test('actual main preserves owner boundary and task across three consecutive launches', async () => scenario(async ({ add, launch, json }) => {
  const task = { kind: 'normal', branch: 'automation/original', sha: 'original-sha', stage: 'release', verdict: { verdict: 'reject', risk: 'approval-required' } };
  await add('2026-10-25-5', { status: 'awaiting-approval', reason: 'Owner decision required' }, task);
  for (const id of ['2026-10-25-13', '2026-10-25-21']) {
    const runDir = await add(id);
    await assert.rejects(launch(runDir, () => assert.fail('Owner boundary reached develop'), () => assert.fail('Owner boundary resumed release')), /owner approval/);
    assert.equal((await json(path.join(runDir, 'result.json'))).status, 'awaiting-approval');
    assert.equal((await json(path.join(runDir, 'startup-recovery.json'))).status, 'awaiting-approval');
    assert.deepEqual(await json(path.join(runDir, 'task.json')), task);
  }
}));

test('repair requiring owner approval is reported as approval waiting on the same launch', async () => scenario(async ({ add, launch, json }) => {
  await add('2026-10-25-5', { status: 'failed' }, { kind: 'normal', stage: 'implementation', branch: 'auto/normal-original' });
  const runDir = await add('2026-10-25-13');
  await assert.rejects(launch(runDir, async () => ({ status: 'awaiting-approval', stage: 'planning', reason: 'Owner decision required' })), /unresolved/);
  assert.equal((await json(path.join(runDir, 'result.json'))).status, 'awaiting-approval');
}));

test('actual main carries failed repair checkpoint and retries the same branch on third launch', async () => scenario(async ({ add, launch, json, save }) => {
  const originalTask = { kind: 'normal', branch: 'automation/original', stage: 'implementation', sha: 'initial-sha', plan: { title: 'same improvement' } };
  await add('2026-10-25-5', { status: 'failed', reason: 'Verification assertion failed' }, originalTask);
  const second = await add('2026-10-25-13');
  const checkpoint = { ...originalTask, sha: 'repair-sha', result: { summary: 'repair in progress' } };
  await assert.rejects(launch(second, async (kind, { previous }) => {
    assert.equal(kind, 'normal');
    assert.equal(previous.task.branch, originalTask.branch);
    await save(path.join(second, 'task.json'), checkpoint);
    throw new Error('Second verification still failing');
  }), /Second verification/);
  assert.equal((await json(path.join(second, 'result.json'))).status, 'failed');
  assert.deepEqual(await json(path.join(second, 'task.json')), checkpoint);
  const third = await add('2026-10-25-21');
  const outcome = await launch(third, async (kind, { previous }) => {
    assert.equal(kind, 'normal');
    assert.equal(previous.id, '2026-10-25-13');
    assert.equal(previous.task.branch, originalTask.branch);
    assert.equal(previous.task.sha, 'repair-sha');
    return { status: 'released', sha: 'final-sha', pr: 123, prevention: 'Regression test covers the failed assertion', evidence: { ci: 'passed' } };
  });
  assert.equal(outcome.status, 'released');
  assert.equal((await json(path.join(third, 'startup-recovery.json'))).status, 'resolved');
}));

test('actual main copies previous task when thrown repair has no new checkpoint', async () => scenario(async ({ add, launch, json }) => {
  const task = { kind: 'normal', branch: 'automation/same-branch', stage: 'implementation' };
  await add('2026-10-25-5', { status: 'failed' }, task);
  for (const id of ['2026-10-25-13', '2026-10-25-21']) {
    const runDir = await add(id);
    await assert.rejects(launch(runDir, async (kind, { previous }) => { assert.deepEqual(previous.task, task); throw new Error('Repair failed'); }), /Repair failed/);
    assert.deepEqual(await json(path.join(runDir, 'task.json')), task);
    assert.equal((await json(path.join(runDir, 'result.json'))).status, 'failed');
  }
}));

test('actual startup waits cheaply for release conditions across launches then resumes the original PR', async () => scenario(async ({ add, launch, json }) => {
  const original = { kind: 'normal', branch: 'automation/release-original', stage: 'awaiting-release', sha: 'reviewed-sha', pr: 123 };
  await add('2026-10-24-21', { status: 'awaiting-release' }, original);
  for (const id of ['2026-10-25-5', '2026-10-25-13']) {
    const runDir = await add(id);
    await launch(runDir, () => assert.fail('Unavailable release conditions must not call models'), () => assert.fail('Unavailable release conditions must not retry release'), ['vercel billing audit expired']);
    assert.equal((await json(path.join(runDir, 'result.json'))).status, 'awaiting-release-conditions');
    assert.equal((await json(path.join(runDir, 'startup-recovery.json'))).status, 'awaiting-release-conditions');
    assert.deepEqual(await json(path.join(runDir, 'task.json')), original);
  }
  let releaseCalls = 0;
  const finalDir = await add('2026-10-25-21');
  const outcome = await launch(finalDir, () => assert.fail('Pending release must not generate a different task'), async previous => {
    releaseCalls++;
    assert.equal(previous.task.pr, 123);
    assert.equal(previous.task.branch, original.branch);
    assert.equal(previous.task.sha, original.sha);
    return { status: 'released', pr: 123, sha: original.sha, prevention: 'Fresh release prerequisites checked before resuming the original reviewed PR', evidence: { ci: 'passed' } };
  }, []);
  assert.equal(releaseCalls, 1);
  assert.equal(outcome.status, 'released');
  assert.equal((await json(path.join(finalDir, 'startup-recovery.json'))).status, 'resolved');
}));

const mainPrefixStart = source.indexOf('async function main() {') + 'async function main() {'.length;
const outerCatchStart = source.lastIndexOf('} catch (error) {') + '} catch (error) {'.length;
const outerCatchEnd = source.indexOf('} finally {', outerCatchStart);
assert.ok(mainPrefixStart > 0 && outerCatchStart > 0 && outerCatchEnd > outerCatchStart, 'Actual main and outer error handlers must exist');
const earlyMain = source.slice(mainPrefixStart, start);
const actualOuterCatch = source.slice(outerCatchStart, outerCatchEnd);

async function runEarlyMain({ stateDir, runDir, json, save, auditBlocked = false, allowInfrastructurePass = false }) {
  const id = path.basename(runDir), match = /^(\d{4}-\d{2}-\d{2})-(\d+)/.exec(id);
  const context = {
    path, stateDir, runDir, inspectPreviousRun, json, save, createHash,
    dryRun: false, auditOnly: false, now: new Date(`${match[1]}T${match[2].padStart(2, '0')}:00:00+09:00`),
    policy: { repository: 'test/repo', githubAuth: 'app', requireDedicatedWindowsUser: false },
    command: async name => name === 'codex' ? 'ChatGPT' : JSON.stringify({ loggedIn: true }),
    safeEnv: () => ({}), githubEnv: async () => ({}),
    gh: async args => args[0] === 'repo' ? JSON.stringify({ visibility: 'PUBLIC', defaultBranchRef: { name: 'main' } }) : '[]',
    api: async endpoint => endpoint.endsWith('/rules/branches/main') ? [[{ type: 'pull_request' }, { type: 'required_status_checks' }]] : [[]],
    auditProblems: () => auditBlocked ? ['billing evidence expired'] : [],
    note: async () => 1, userInfo: () => ({ username: 'bot' }),
    console: { log() {}, error() {} }, process: { exitCode: 0 },
    jstDate: () => match[1], reserve: () => {}, runId: id,
    git: () => allowInfrastructurePass ? '' : assert.fail('Halt or audit block must stop before git fetch'),
  };
  const execute = new AsyncFunction(...Object.keys(context), `try { ${earlyMain} } catch (error) { ${actualOuterCatch} }`);
  await execute(...Object.values(context));
}

test('actual main halt across three launches retains previous task and owner boundary before startup reconciliation', async () => scenario(async ({ stateDir, add, json, save }) => {
  const task = { kind: 'normal', branch: 'automation/blocked-original', sha: 'reviewed-sha', stage: 'awaiting-approval', verdict: { verdict: 'approve', risk: 'approval-required' } };
  await add('2026-10-24-21', { status: 'awaiting-approval' }, task);
  await save(path.join(stateDir, 'halt.json'), { reason: 'Unresolved deployment' });
  for (const id of ['2026-10-25-5', '2026-10-25-13', '2026-10-25-21']) {
    const runDir = await add(id);
    await runEarlyMain({ stateDir, runDir, json, save });
    const result = await json(path.join(runDir, 'result.json'));
    assert.equal(result.status, 'awaiting-approval');
    assert.match(result.reason, /Production halt/);
    assert.deepEqual(await json(path.join(runDir, 'task.json')), task);
  }
}));

test('actual main audit block preserves approval without a task across repeated launches', async () => scenario(async ({ stateDir, add, json, save }) => {
  await add('2026-10-24-21', { status: 'awaiting-approval', reason: 'Owner decision required' });
  for (const id of ['2026-10-25-5', '2026-10-25-13', '2026-10-25-21']) {
    const runDir = await add(id);
    await runEarlyMain({ stateDir, runDir, json, save, auditBlocked: true });
    assert.equal((await json(path.join(runDir, 'result.json'))).status, 'awaiting-approval');
    assert.equal((await json(path.join(runDir, 'previous-run.json'))).ownerBlocked, true);
  }
}));

test('actual halt-only stops remain infrastructure failures then clear after current gates pass without code repair', async () => scenario(async ({ stateDir, add, launch, json, save }) => {
  await save(path.join(stateDir, 'halt.json'), { reason: 'Production investigation required' });
  for (const id of ['2026-10-25-5', '2026-10-25-13']) {
    const runDir = await add(id);
    await runEarlyMain({ stateDir, runDir, json, save });
    assert.equal((await json(path.join(runDir, 'result.json'))).gate, 'infrastructure');
    assert.equal((await json(path.join(runDir, 'infrastructure-gates.json'))).passed, false);
    assert.equal(await json(path.join(runDir, 'task.json'), null), null);
  }
  await rm(path.join(stateDir, 'halt.json'));
  const finalDir = await add('2026-10-25-21');
  await runEarlyMain({ stateDir, runDir: finalDir, json, save, allowInfrastructurePass: true });
  assert.equal((await json(path.join(finalDir, 'infrastructure-gates.json'))).passed, true);
  await launch(finalDir, () => assert.fail('Infrastructure clearance must not invent implementation repair'), () => assert.fail('No release task exists'));
  assert.equal((await json(path.join(finalDir, 'startup-recovery.json'))).proof.type, 'current-infrastructure-gates');
}));

test('actual development approval return checkpoints explicit approval stage and risk', async () => {
  const checkpointStart = source.lastIndexOf("    await recordTask({ stage: 'awaiting-approval'");
  const returnMarker = "    return { status: 'awaiting-approval', pr, sha };";
  const checkpointEnd = source.indexOf(returnMarker, checkpointStart) + returnMarker.length;
  assert.ok(checkpointStart > 0 && checkpointEnd > checkpointStart, 'Development approval checkpoint must precede awaiting-approval return');
  const checkpoints = [];
  const context = { recordTask: async value => checkpoints.push(value), note: async () => {}, sha: 'reviewed-sha', result: { risk: 'approval-required' }, pr: 123, issue: 45, verdict: { verdict: 'approve', risk: 'reversible' } };
  const execute = new AsyncFunction(...Object.keys(context), source.slice(checkpointStart, checkpointEnd));
  assert.equal((await execute(...Object.values(context))).status, 'awaiting-approval');
  assert.equal(checkpoints[0].stage, 'awaiting-approval');
  assert.equal(checkpoints[0].verdict.risk, 'approval-required');
});

test('actual startup retains unknown workflow over three launches without entering code repair', async () => scenario(async ({ add, launch, json }) => {
  const task = { kind: 'normal', branch: 'auto/normal-original', stage: 'validation-uncertain', sha: 'a'.repeat(40), attempt: 1 };
  await add('2026-10-24-21', { status: 'failed', reason: 'dispatch outcome unknown' }, task);
  for (const id of ['2026-10-25-5', '2026-10-25-13', '2026-10-25-21']) {
    const runDir = await add(id);
    await assert.rejects(launch(runDir, () => assert.fail('Uncertain workflow must not call models')), /unresolved/);
    assert.equal((await json(path.join(runDir, 'result.json'))).status, 'awaiting-verification');
    assert.equal((await json(path.join(runDir, 'task.json'))).stage, 'validation-uncertain');
  }
}));

test('actual startup reconciles the same pending workflow over three launches before candidate repair', async () => scenario(async ({ add, launch, json, save }) => {
  const sha = 'a'.repeat(40);
  const task = { kind: 'normal', branch: 'auto/normal-original', stage: 'validation-uncertain', sha, attempt: 1 };
  const originalDir = await add('2026-10-24-21', { status: 'failed', reason: 'watch disconnected' }, task);
  await save(path.join(originalDir, 'normal-after-1-ci.json'), { sha, run: 123, status: 'running' });
  let repairs = 0;
  for (const [index, id] of ['2026-10-25-5', '2026-10-25-13', '2026-10-25-21'].entries()) {
    const runDir = await add(id);
    const proc = { exitCode: 0 };
    const overrides = { process: proc, gh: async args => {
      assert.deepEqual(args.slice(0, 3), ['run', 'view', '123']);
      return JSON.stringify({ databaseId: 123, displayTitle: `Verify Automation ${sha} original-request`, status: index < 2 ? 'in_progress' : 'completed', conclusion: index < 2 ? '' : 'success' });
    } };
    const repair = async (kind, { previous }) => {
      repairs++;
      assert.equal(previous.task.branch, task.branch);
      assert.equal(previous.task.sha, sha);
      assert.equal(previous.task.uncertaintyProof.run, 123);
      return { status: 'released', sha, pr: 321, prevention: 'Regression checks original workflow identity', evidence: { ci: 'passed' } };
    };
    if (index < 2) {
      await assert.rejects(launch(runDir, repair, undefined, [], overrides), error => { assert.equal(error.exitCode, 2); return /unresolved/.test(error.message); });
      assert.equal((await json(path.join(runDir, 'result.json'))).status, 'awaiting-verification');
      const retained = await json(path.join(runDir, 'task.json'));
      assert.equal(retained.stage, 'validation-uncertain');
      assert.equal(retained.uncertaintyDir, originalDir);
      assert.equal(retained.uncertainWorkflow.run, 123);
      assert.equal(repairs, 0);
    } else {
      const outcome = await launch(runDir, repair, undefined, [], overrides);
      assert.equal(outcome.status, 'released');
      assert.equal((await json(path.join(runDir, 'uncertainty-proof.json'))).run, 123);
      assert.equal(repairs, 1);
    }
  }
}));
