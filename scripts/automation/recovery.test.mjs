import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireReview } from './core.mjs';

const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function develop(kind) {');
const end = source.indexOf('async function adopt(exp) {');
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runScenario({ baseline = 'passed', decision = 'implement', implementNoChange = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-recovery-'));
  const calls = [];
  try {
    const runDir = path.join(dir, 'logs');
    await mkdir(runDir);
    await mkdir(path.join(dir, 'e2e/__screens__'), { recursive: true });
    await writeFile(path.join(dir, '.git'), 'gitdir: test');
    await writeFile(path.join(dir, 'e2e/proof.png'), 'dummy fixture');
    const result = { title: 'repair', summary: 'researched safe change', noChange: implementNoChange, sources: ['https://example.com'], screenshots: ['e2e/proof.png'], risk: 'reversible', assumption: 'test', successCriteria: 'test' };
    const plan = { ...result };
    delete plan.noChange;
    const context = {
      path, createHash, requireReview, runDir, runId: 'fixture', stateDir: dir,
      deadline: Date.now() + 90 * 60_000, now: new Date(),
      config: {}, policy: { repository: 'test/repo', protectedPaths: [], productDirection: {} },
      workspace: async () => dir, withWorkspace: async (dir, callback) => callback({}),
      readFile, writeFile, readdir, cp, lstat,
      json: async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } },
      save: async (file, value) => writeFile(file, JSON.stringify(value)),
      checks: async (dir, tag) => {
        calls.push(['checks', tag]);
        if (tag.endsWith('-before') && baseline !== 'passed') {
          await writeFile(path.join(runDir, `${tag}-ci.json`), JSON.stringify({ status: baseline }));
          await writeFile(path.join(runDir, `${tag}-checks.log`), 'test failure: pending-state assertion');
          throw new Error('baseline failed');
        }
      },
      git: async args => {
        if (args[0] === 'rev-parse') return 'a'.repeat(40);
        if (args.includes('--name-only')) return args.includes('--diff-filter=D') ? '' : 'docs/repair.md';
        return '';
      },
      command: async (name, args, options) => {
        assert.equal(name, 'codex');
        const planning = args[args.indexOf('--output-schema') + 1].endsWith('plan.schema.json');
        calls.push([planning ? 'plan' : 'implement', options.input]);
        assert.equal(args[args.indexOf('--sandbox') + 1], planning ? 'read-only' : 'workspace-write');
        await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(planning ? { ...plan, decision } : result));
        await writeFile(options.log, 'fixture model log');
      },
      review: async (dir, sha, result, options) => { calls.push(['review', options.planning ? 'plan' : 'implementation']); return { sha, verdict: 'approve', risk: 'reversible', reason: 'reviewed' }; },
      note: async () => 1, gh: async () => 'https://github.com/test/repo/pull/1',
      jstDate: () => '2026-10-26', changedPathsBlocked: () => [], needsLiveAiVerification: () => false,
      release: async () => { calls.push(['release']); return true; },
    };
    const run = new AsyncFunction(...Object.keys(context), source.slice(start, end) + '\nreturn develop("normal");');
    try { return { result: await run(...Object.values(context)), calls }; }
    catch (error) { return { error, calls }; }
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
}

test('read-only plan with a useful candidate advances through review, implementation and release', async () => {
  const run = await runScenario();
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'released');
  assert.deepEqual(run.calls.map(call => call[0]), ['checks', 'plan', 'review', 'implement', 'review', 'checks', 'release']);
});

test('genuine no-change still requires independent planning review and never implements', async () => {
  const run = await runScenario({ decision: 'no-change' });
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'no-change');
  assert.deepEqual(run.calls.map(call => call[0]), ['checks', 'plan', 'review']);
});

test('confirmed baseline failure becomes a repair with diagnostics and cannot skip final verification', async () => {
  const run = await runScenario({ baseline: 'failed' });
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'released');
  assert.match(run.calls.find(call => call[0] === 'plan')[1], /BASELINE REPAIR ONLY/);
  assert.match(run.calls.find(call => call[0] === 'implement')[1], /pending-state assertion/);
  assert.equal(run.calls.filter(call => call[0] === 'checks').length, 2);
});

test('interrupted baseline workflow does not authorize code repair', async () => {
  const run = await runScenario({ baseline: 'interrupted' });
  assert.match(run.error.message, /baseline failed/);
  assert.deepEqual(run.calls.map(call => call[0]), ['checks']);
});

test('failing baseline cannot be declared no-change and reviewed implementation cannot be silently abandoned', async () => {
  const baseline = await runScenario({ baseline: 'failed', decision: 'no-change' });
  assert.match(baseline.error.message, /Baseline repair plan unresolved after 3/);
  assert.equal(baseline.calls.filter(call => call[0] === 'review').length, 3);
  const implementation = await runScenario({ implementNoChange: true });
  assert.match(implementation.error.message, /work remains unresolved/);
});
