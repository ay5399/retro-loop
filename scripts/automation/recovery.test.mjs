import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireReview } from './core.mjs';
import { generationBudget, TASK_TIMING } from './budget.mjs';
import { collectEvidence } from './evidence.mjs';
import { validateCandidateTextFiles, validateCandidateDiff, assertCandidateValid, requireImplementationSandbox, recoveryVerificationEvidence } from './candidate.mjs';

const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function develop(');
const end = source.indexOf('async function adopt(exp) {');
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runScenario({ baseline = 'passed', decision = 'implement', implementNoChange = false, missingEvidence = false, badEncoding = false, previous = false, omitRegression = false, resume = false, rebaseConflict = false, reviewChoices = [], resumeCiStatus, localRecoveryCheckpoint = false, resumeLiveFailure = false, elapsedClock = false, missingEvidenceFailures = 1, afterCiStatus, pushFailures = 0, pushRemoteOutcome = 'unchanged', runMinutes = 90, planningErrors = [], previousRecoveryPlan = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-recovery-'));
  const calls = [];
  let elapsedMs = 0;
  const clockStart = Date.now();
  const advance = ms => { if (elapsedClock) elapsedMs += ms; };
  const ClockDate = class extends Date { static now() { return clockStart + elapsedMs; } };
  try {
    const runDir = path.join(dir, 'logs');
    await mkdir(runDir);
    await mkdir(path.join(dir, 'e2e/__screens__'), { recursive: true });
    await writeFile(path.join(dir, '.git'), 'gitdir: test');
    const proof = 'e2e/__screens__/proof.png';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1kAAAAASUVORK5CYII=', 'base64');
    await writeFile(path.join(dir, 'e2e/__screens__/baseline.png'), png);
    await writeFile(path.join(dir, 'e2e/regression.spec.ts'), 'test scenario');
    if (!missingEvidence) await writeFile(path.join(dir, proof), png);
    await mkdir(path.join(dir, 'docs'));
    await writeFile(path.join(dir, 'docs/repair.md'), badEncoding ? Buffer.from([0xff]) : 'repair');
    let implementations = 0, commits = 0, reviewNumber = 0, rebaseAttempted = false, liveCalls = 0, pushAttempts = 0, planningCalls = 0;
    const result = { title: 'repair', summary: 'researched safe change', noChange: implementNoChange, sources: ['https://example.com'], screenshots: [proof], prevention: 'Add a regression scenario', risk: 'reversible', assumption: 'test', successCriteria: 'test' };
    const plan = { ...result };
    delete plan.noChange;
    const context = {
      path, createHash, requireReview, generationBudget, TASK_TIMING, Date: elapsedClock ? ClockDate : Date,
      collectEvidence: async options => { advance(TASK_TIMING.artifactMs); return collectEvidence(options); }, safeEnv: extra => extra,
      prepareRecovery: async prior => { if (resume) calls.push(['prepareRecovery', prior.reason]); return { previousRun: 'old-run', preventionRequired: true }; }, validateCandidateTextFiles, validateCandidateDiff, assertCandidateValid, requireImplementationSandbox, recoveryVerificationEvidence, runDir, runId: 'fixture', stateDir: dir,
      deadline: clockStart + runMinutes * 60_000, now: new Date(),
      config: { repositoryPath: dir }, policy: { repository: 'test/repo', protectedPaths: [], productDirection: {}, liveAiVerification: { enabled: resumeLiveFailure } },
      workspace: async () => dir, withWorkspace: async (dir, callback) => callback({}),
      readFile, writeFile, readdir, cp, lstat,
      json: async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } },
      save: async (file, value) => writeFile(file, JSON.stringify(value)),
      checks: async (dir, tag) => {
        advance(4 * 60_000);
        calls.push(['checks', tag]);
        if (tag === 'resumed-release' && resumeCiStatus) {
          await writeFile(path.join(runDir, 'resumed-release-ci.json'), JSON.stringify({ status: resumeCiStatus }));
          await writeFile(path.join(runDir, 'resumed-release-checks.log'), 'actual resumed test failure');
          throw new Error('resumed workflow failed');
        }
        if (tag.includes('-after-') && afterCiStatus) {
          await writeFile(path.join(runDir, `${tag}-ci.json`), JSON.stringify({ status: afterCiStatus }));
          throw new Error('candidate workflow outcome unavailable');
        }
        if (tag.endsWith('-before') && baseline !== 'passed') {
          await writeFile(path.join(runDir, `${tag}-ci.json`), JSON.stringify({ status: baseline }));
          await writeFile(path.join(runDir, `${tag}-checks.log`), 'test failure: pending-state assertion');
          throw new Error('baseline failed');
        }
      },
      git: async args => {
        if (resume && (args[0] === 'rebase' || args[0] === 'push')) calls.push(['git', args]);
        if (args[0] === 'ls-remote') {
          const observed = pushAttempts && pushRemoteOutcome === 'acknowledged' ? commits.toString(16).padStart(40, '0') : pushAttempts && pushRemoteOutcome === 'changed' ? 'f'.repeat(40) : '0'.repeat(40);
          return `${observed}\trefs/heads/test`;
        }
        if (args[0] === 'push' && pushFailures) {
          calls.push(['push']);
          if (++pushAttempts <= pushFailures) throw new Error('push transport disconnected');
        }

        if (rebaseConflict && args[0] === 'rebase' && args[1] === 'origin/main' && !rebaseAttempted) { rebaseAttempted = true; throw new Error('conflict in original feature'); }
        if (localRecoveryCheckpoint && args[0] === 'rebase' && args[1] === 'origin/main') commits++;
        if (args[0] === 'commit') commits++;
        if (args[0] === 'rev-parse') return commits.toString(16).padStart(40, '0');
        if (args.includes('--name-only')) return args.includes('--diff-filter=D') ? '' : (omitRegression ? 'docs/repair.md' : 'docs/repair.md\0e2e/regression.spec.ts');
        return '';
      },
      command: async (name, args, options) => {
        if (name === 'node') {
          calls.push(['live-ai']);
          const outDir = args[args.indexOf('--output-dir') + 1];
          const sha = args[args.indexOf('--expected-sha') + 1];
          const status = liveCalls++ === 0 ? 'failed' : 'passed';
          await mkdir(outDir, { recursive: true });
          await writeFile(path.join(outDir, 'result.json'), JSON.stringify({ sha, status, browser: { status } }));
          return '';
        }
        assert.equal(name, 'codex');
        const planning = args[args.indexOf('--output-schema') + 1].endsWith('plan.schema.json');
        advance(options.timeout);
        calls.push([planning ? 'plan' : 'implement', options.input]);
        if (planning && planningErrors[planningCalls++]) throw new Error(planningErrors[planningCalls - 1]);
        assert.equal(args[args.indexOf('--sandbox') + 1], planning ? 'read-only' : 'workspace-write');
        if (!planning) {
          implementations++;
          if (implementations > missingEvidenceFailures) {
            await writeFile(path.join(dir, proof), png);
            await writeFile(path.join(dir, 'docs/repair.md'), 'correct UTF-8 repair');
          }
        }
        await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(planning ? { ...plan, decision } : { ...result, noChange: implementNoChange && implementations === 1 }));
        const stderr = `OpenAI Codex v0.163.0\n--------\nworkdir: fixture\nsandbox: ${planning ? 'read-only' : 'workspace-write [workdir, /tmp, $TMPDIR]'}\n--------\nexec\nQuoted old planning log:\nOpenAI Codex v0.163.0\n--------\nworkdir: previous\nsandbox: read-only\n--------\n`;
        await writeFile(options.log, stderr);
        await writeFile(options.stderrLog, stderr);
      },
      review: async (dir, sha, result, options = {}) => { advance(TASK_TIMING.reviewMs); calls.push(['review', options.planning ? 'plan' : 'implementation', sha]); return { sha, verdict: reviewChoices[reviewNumber++] ?? 'approve', risk: 'reversible', reason: 'fix review finding with regression coverage' }; },
      auditProblems: () => [],
      note: async () => 1, gh: async args => {
        if (args[0] === 'pr' && args[1] === 'create') advance(TASK_TIMING.publishMs);
        if (resume) calls.push(['gh', args]);
        if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ state: 'OPEN', headRefOid: '0'.repeat(40) });
        return 'https://github.com/test/repo/pull/1';
      },
      jstDate: () => '2026-10-26', changedPathsBlocked: () => [], needsLiveAiVerification: () => resumeLiveFailure,
      release: async () => { calls.push(['release']); advance(4 * 60_000); return !elapsedClock || clockStart + runMinutes * 60_000 - ClockDate.now() >= TASK_TIMING.releaseMs; },
    };
    const resumeDeclaration = source.slice(source.indexOf('async function resumePendingRelease('), source.indexOf('async function prepareRecovery('));
    const prior = { id: 'old-run', dir: runDir, reason: 'Previous release incomplete', task: { kind: 'normal', sha: '0'.repeat(40), branch: localRecoveryCheckpoint ? 'auto/normal-local-recovery' : 'auto/normal-original', ...(localRecoveryCheckpoint ? { remoteBranch: 'auto/normal-original', remoteHeadSha: '0'.repeat(40) } : {}), pr: 123, issue: 456, result, stage: 'awaiting-release' } };
    const run = new AsyncFunction(...Object.keys(context), (resume ? resumeDeclaration : '') + source.slice(start, end) + (resume ? `\nreturn resumePendingRelease(${JSON.stringify(prior)});` : '\nreturn develop("normal", ' + JSON.stringify(previous ? { previous: { id: 'old-run', reason: 'previous evidence missing', ...(previousRecoveryPlan ? { task: { recovery: { plan: { title: 'original approved context' } } } } : {}) } } : {}) + ');'));
    try { const outcome = await run(...Object.values(context)); return { result: outcome, calls, elapsedMs, checkpoint: await context.json(path.join(runDir, 'task.json'), null) }; }
    catch (error) { return { error, calls, checkpoint: await context.json(path.join(runDir, 'task.json'), null) }; }
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
}

test('resumed release fixes two reviews and merges the original PR within three review attempts', async () => {
  const run = await runScenario({ resume: true, reviewChoices: ['revise', 'revise', 'approve'] });
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'released');
  assert.equal(run.result.pr, 123);
  assert.equal(run.calls.filter(call => call[0] === 'review').length, 3);
  assert.equal(run.calls.filter(call => call[0] === 'implement').length, 2);
  const prWrites = run.calls.filter(call => call[0] === 'gh' && ['create', 'edit'].includes(call[1][1]));
  assert.deepEqual(prWrites.map(call => call[1].slice(0, 3)), [['pr', 'edit', '123']]);
  assert.ok(run.calls.some(call => call[0] === 'git' && call[1][0] === 'push' && call[1].at(-1) === 'HEAD:auto/normal-original'));
});

test('existing PR with 40 minutes remaining fixes a resumed review and validates now while release waits', async () => {
  const run = await runScenario({ resume: true, elapsedClock: true, runMinutes: 40, reviewChoices: ['revise', 'approve'] });
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'awaiting-release-conditions');
  assert.equal(run.result.pr, 123);
  assert.equal(run.calls.filter(call => call[0] === 'implement').length, 1);
  assert.equal(run.calls.filter(call => call[0] === 'review').length, 2);
  assert.equal(run.calls.filter(call => call[0] === 'checks').length, 2);
  assert.equal(run.calls.filter(call => call[0] === 'release').length, 1);
  assert.ok(run.elapsedMs < 40 * 60_000);
  assert.equal(run.checkpoint.pr, 123);
  assert.equal(run.checkpoint.stage, 'awaiting-release-conditions');
  assert.equal(run.calls.some(call => call[0] === 'gh' && call[1][1] === 'create'), false);
});

test('resumed rebase conflict is aborted and candidate transfers onto current main before same PR repair', async () => {
  const run = await runScenario({ resume: true, rebaseConflict: true });
  assert.equal(run.error, undefined);
  assert.equal(run.result.pr, 123);
  const abort = run.calls.findIndex(call => call[0] === 'git' && call[1][1] === '--abort');
  const transfer = run.calls.findIndex(call => call[0] === 'prepareRecovery');
  assert.ok(abort >= 0 && transfer > abort);
  assert.match(run.calls[transfer][1], /conflict in original feature/);
  assert.ok(run.calls.some(call => call[0] === 'implement' && call[1].includes('Rebase onto current main failed')));
  assert.equal(run.calls.some(call => call[0] === 'gh' && call[1][1] === 'create'), false);
});

test('resumed release rejection preserves approval boundary and never generates a replacement', async () => {
  const run = await runScenario({ resume: true, reviewChoices: ['reject'] });
  assert.match(run.error.message, /requires owner approval/);
  assert.equal(run.calls.some(call => ['implement', 'release', 'prepareRecovery'].includes(call[0])), false);
});

test('resumed concluded CI failure is corrected and reviewed before original PR release', async () => {
  const run = await runScenario({ resume: true, resumeCiStatus: 'failed' });
  assert.equal(run.error, undefined);
  assert.equal(run.result.pr, 123);
  assert.ok(run.calls.some(call => call[0] === 'implement' && call[1].includes('actual resumed test failure')));
  assert.equal(run.calls.filter(call => call[0] === 'review').length, 2);
});
test('resumed concluded live verification failure is corrected before original PR release', async () => {
  const run = await runScenario({ resume: true, resumeLiveFailure: true });
  assert.equal(run.error, undefined);
  assert.equal(run.result.pr, 123);
  assert.equal(run.calls.filter(call => call[0] === 'live-ai').length, 2);
  assert.ok(run.calls.some(call => call[0] === 'implement' && call[1].includes('live-ai validation failed')));
});

test('resumed missing evidence is repaired in the same three-review bound', async () => {
  const run = await runScenario({ resume: true, missingEvidence: true });
  assert.equal(run.error, undefined);
  assert.equal(run.result.pr, 123);
  assert.equal(run.calls.filter(call => call[0] === 'review').length, 3);
});

test('resumed uncertain workflow does not authorize a code rewrite', async () => {
  const run = await runScenario({ resume: true, resumeCiStatus: 'interrupted' });
  assert.match(run.error.message, /resumed workflow/);
  assert.equal(run.calls.some(call => call[0] === 'implement'), false);
});

test('next-launch checkpoint pushes original remote PR branch rather than local recovery branch', async () => {
  const run = await runScenario({ resume: true, localRecoveryCheckpoint: true });
  assert.equal(run.error, undefined);
  const push = run.calls.find(call => call[0] === 'git' && call[1][0] === 'push')[1];
  assert.equal(push.at(-1), 'HEAD:auto/normal-original');
  assert.equal(push[1], `--force-with-lease=refs/heads/auto/normal-original:${'0'.repeat(40)}`);
  assert.equal(run.result.pr, 123);
});

test('read-only plan with a useful candidate advances through review, implementation and release', async () => {
  const run = await runScenario();
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'released');
  assert.deepEqual(run.calls.map(call => call[0]), ['checks', 'plan', 'review', 'implement', 'review', 'checks', 'release']);
});

test('planning timeout retries in the same run and still requires independent planning review', async () => {
  const run = await runScenario({ elapsedClock: true, planningErrors: ['codex failed (timeout). See fixture log'] });
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'released');
  assert.equal(run.calls.filter(call => call[0] === 'plan').length, 2);
  assert.equal(run.calls.filter(call => call[0] === 'review' && call[1] === 'plan').length, 1);
  assert.ok(run.elapsedMs < 90 * 60_000);
});

test('planning retries stop after three explicit timeouts; authentication failures never retry', async () => {
  const timed = await runScenario({ planningErrors: Array(3).fill('codex failed (timeout). See fixture log') });
  assert.match(timed.error.message, /timed out after 3 attempts/);
  assert.equal(timed.calls.filter(call => call[0] === 'plan').length, 3);
  assert.equal(timed.calls.some(call => call[0] === 'review'), false);
  const auth = await runScenario({ planningErrors: ['codex failed (1). Authentication required'] });
  assert.match(auth.error.message, /Authentication required/);
  assert.equal(auth.calls.filter(call => call[0] === 'plan').length, 1);
  const retained = await runScenario({ previous: true, previousRecoveryPlan: true, planningErrors: Array(3).fill('codex failed (timeout). See fixture log') });
  assert.equal(retained.checkpoint.plan.title, 'original approved context');
});

test('baseline interruption preserves the nested previous recovery plan checkpoint', async () => {
  const run = await runScenario({ previous: true, previousRecoveryPlan: true, baseline: 'interrupted' });
  assert.match(run.error.message, /baseline failed/);
  assert.equal(run.checkpoint.plan.title, 'original approved context');
});

test('recovery prompt distinguishes current verification once without persisting source in the checkpoint', async () => {
  const run = await runScenario({ previous: true });
  assert.equal(run.error, undefined);
  const prompt = run.calls.find(call => call[0] === 'plan')[1];
  assert.equal(prompt.match(/CURRENT verification-script snapshot/g)?.length, 1);
  assert.match(prompt, /logs are HISTORICAL/);
  assert.equal(run.checkpoint.recovery.controllerVerification, undefined);
  assert.doesNotMatch(JSON.stringify(run.checkpoint), /CURRENT verification-script snapshot|Verification scripts invoked/);
});

test('elapsed real develop repairs two missing-evidence attempts and completes third review/CI before retaining the same unmerged PR', async () => {
  const run = await runScenario({ elapsedClock: true, missingEvidence: true, missingEvidenceFailures: 2 });
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'awaiting-release-conditions');
  assert.equal(run.result.pr, 1);
  assert.equal(run.checkpoint.pr, 1);
  assert.equal(run.checkpoint.stage, 'awaiting-release-conditions');
  assert.equal(run.checkpoint.sha, run.result.sha);
  assert.equal(run.calls.filter(call => call[0] === 'implement').length, 3);
  assert.equal(run.calls.filter(call => call[0] === 'review' && call[1] === 'implementation').length, 3);
  assert.equal(run.calls.filter(call => call[0] === 'checks').length, 4);
  assert.equal(run.calls.filter(call => call[0] === 'release').length, 1);
  assert.ok(run.elapsedMs > 45 * 60_000);
  assert.ok(run.elapsedMs < 90 * 60_000);
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
  assert.equal(implementation.error, undefined);
  assert.equal(implementation.result.status, 'released');
  assert.equal(implementation.calls.filter(call => call[0] === 'implement').length, 2);
});

for (const [name, scenario, reason] of [
  ['missing evidence', { missingEvidence: true }, /Missing browser evidence/],
  ['invalid UTF-8', { badEncoding: true }, /Invalid UTF-8 encoding/],
]) {
  test(`${name} is repaired in the same run before release`, async () => {
    const run = await runScenario(scenario);
    assert.equal(run.error, undefined);
    assert.equal(run.result.status, 'released');
    const implementations = run.calls.filter(call => call[0] === 'implement');
    assert.equal(implementations.length, 2);
    assert.match(implementations[1][1], reason);
    const reviews = run.calls.filter(call => call[0] === 'review' && call[1] === 'implementation');
    if (scenario.missingEvidence) {
      assert.equal(reviews.length, 2);
      assert.notEqual(reviews[0][2], reviews[1][2]);
      assert.equal(run.calls.filter(call => call[0] === 'checks').length, 3);
    }
    assert.equal(run.calls.at(-1)[0], 'release');
  });
}

test('previous unfinished task is repaired with recurrence prevention before new work', async () => {
  const run = await runScenario({ previous: true, implementNoChange: true });
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, 'released');
  assert.match(run.result.prevention, /regression/);
  assert.match(run.calls.find(call => call[0] === 'plan')[1], /RECOVERY BEFORE NEW WORK/);
  assert.equal(run.calls.filter(call => call[0] === 'implement').length, 2);
});

test('previous recovery cannot exit through no-change or omit regression coverage', async () => {
  const skipped = await runScenario({ previous: true, decision: 'no-change' });
  assert.match(skipped.error.message, /unresolved after 3 reviews/);
  assert.equal(skipped.calls.some(call => call[0] === 'release'), false);
  const untested = await runScenario({ previous: true, omitRegression: true });
  assert.match(untested.error.message, /regression scenario/);
  assert.equal(untested.calls.filter(call => call[0] === 'implement').length, 3);
  assert.equal(untested.calls.some(call => call[0] === 'release'), false);
});

for (const status of ['interrupted', 'unknown', 'dispatched']) {
  test(`uncertain candidate CI ${status} preserves work without generating or redispatching`, async () => {
    const run = await runScenario({ afterCiStatus: status });
    assert.match(run.error.message, /Infrastructure outcome uncertain/);
    assert.equal(run.calls.filter(call => call[0] === 'implement').length, 1);
    assert.equal(run.calls.filter(call => call[0] === 'checks' && call[1].includes('-after-')).length, 1);
    assert.equal(run.calls.some(call => call[0] === 'release'), false);
  });
}
for (const [outcome, failures, expectedPushes, succeeds] of [
  ['acknowledged', 1, 1, true], ['unchanged', 1, 2, true], ['unchanged', 2, 2, false], ['changed', 1, 1, false],
]) {
  test(`push ${outcome} with ${failures} transport failures reconciles without code regeneration`, async () => {
    const run = await runScenario({ pushFailures: failures, pushRemoteOutcome: outcome });
    assert.equal(run.calls.filter(call => call[0] === 'push').length, expectedPushes);
    assert.equal(run.calls.filter(call => call[0] === 'implement').length, 1);
    if (succeeds) {
      assert.equal(run.error, undefined);
      assert.equal(run.result.status, 'released');
    } else {
      assert.match(run.error.message, /Infrastructure outcome uncertain/);
      assert.equal(run.calls.some(call => call[0] === 'release'), false);
      assert.equal(run.calls.some(call => call[0] === 'checks' && call[1].includes('-after-')), false);
    }
  });
}
