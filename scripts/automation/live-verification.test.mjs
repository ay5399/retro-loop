import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { providerFailure, exhaustedWindow, liveRetryAllowed } from './live-verification.mjs';

const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('retained verification publishes the reviewed SHA without research or generation', async () => {
  const sha = 'a'.repeat(40), calls = [], writes = [];
  const task = { kind: 'normal', branch: 'auto/normal-retained', sha, liveFailure: { category: 'provider-unavailable' }, result: { risk: 'reversible', prevention: 'regression', screenshots: ['proof.png'] }, verdict: { sha, verdict: 'approve', risk: 'reversible' } };
  const fn = await load('resumeLiveVerification', 'main', {
    path, runDir: '/run', process: { argv: [] }, liveRetryAllowed, policy: { repository: 'test/repo' },
    save: async (file, value) => writes.push(value), workspace: async branch => { assert.equal(branch, task.branch); return '/candidate'; }, withWorkspace: async (dir, callback) => callback(),
    git: async args => {
      calls.push(args[0]);
      if (args[0] === 'rev-parse') return sha;
      if (args.includes('--name-only')) return 'src/component.tsx';
      return '';
    },
    changedPathsBlocked: () => [], validateCandidateTextFiles: async () => [], validateCandidateDiff: () => [], assertCandidateValid: () => {},
    requireReview: (review, expected) => { assert.equal(review.sha, expected); },
    verifyLiveCandidate: async (dir, expected, tag, checkpoint) => { assert.equal(expected, sha); assert.equal(checkpoint.liveVerificationRetries, 1); calls.push('live'); },
    checks: async () => calls.push('ci'), collectEvidence: async () => ['proof'], writeFile: async () => {},
    gh: async args => { calls.push(args.slice(0, 2).join('-')); return args[1] === 'list' ? '[]' : 'https://github.com/test/repo/pull/1'; },
    release: async (dir, expected) => { assert.equal(expected, sha); calls.push('release'); return true; },
  });
  const result = await fn({ id: 'previous', task });
  assert.equal(result.status, 'released');
  assert.equal(result.sha, sha);
  assert.equal(writes.at(-1).stage, 'release');
  assert.deepEqual(calls.filter(call => ['live', 'ci', 'pr-create', 'release'].includes(call)), ['live', 'ci', 'pr-create', 'release']);
});
function load(name, next, context) {
  return new AsyncFunction(...Object.keys(context), source.slice(source.indexOf(`async function ${name}(`), source.indexOf(`async function ${next}(`)) + `; return ${name};`)(...Object.values(context));
}

test('PR retries stop after two launches; mutation never reaches publication', async () => {
  let task = { kind: 'normal', pr: 1, branch: 'auto/normal-retained', sha: 'a'.repeat(40), result: {}, liveFailure: { category: 'provider-unavailable' } };
  let attempts = 0;
  const fn = await load('resumeLiveVerification', 'main', {
    path, runDir: '/run', process: { argv: [] }, liveRetryAllowed,
    save: async (file, value) => { task = value; },
    resumePendingRelease: async previous => { attempts++; assert.equal(previous.task.liveVerificationRetries, attempts); return { status: 'awaiting-verification' }; },
  });
  for (let i = 0; i < 3; i++) assert.equal((await fn({ task })).status, 'awaiting-verification');
  assert.equal(attempts, 2);
  task = { ...task, kind: 'mutation', branch: 'auto/mutation-retained', liveVerificationRetries: 0 };
  assert.equal((await fn({ task })).status, 'awaiting-verification');
  assert.equal(attempts, 2);
});

test('rebase review rejection is held with new SHA and consumes the retry before review', async () => {
  const oldSha = 'a'.repeat(40), newSha = 'b'.repeat(40), writes = [];
  let rebased = false;
  const fn = await load('resumeLiveVerification', 'main', {
    path, runDir: '/run', process: { argv: [] }, liveRetryAllowed, policy: {},
    save: async (file, value) => writes.push(value), workspace: async () => '/candidate', withWorkspace: async (dir, callback) => callback(),
    git: async args => {
      if (args[0] === 'rebase') rebased = true;
      if (args[0] === 'rev-parse') return rebased ? newSha : oldSha;
      if (args.includes('--name-only')) return 'src/component.tsx';
      return '';
    },
    review: async (dir, sha) => { assert.equal(writes.at(-1).liveVerificationRetries, 1); assert.equal(writes.at(-1).sha, newSha); return { sha, verdict: 'reject', risk: 'approval-required' }; },
    changedPathsBlocked: () => [], validateCandidateTextFiles: async () => [], validateCandidateDiff: () => [], assertCandidateValid: () => {},
  });
  const outcome = await fn({ task: { kind: 'normal', branch: 'auto/normal-retained', sha: oldSha, result: {}, liveFailure: { category: 'provider-unavailable' } } });
  assert.equal(outcome.status, 'awaiting-verification');
  assert.equal(writes.at(-1).sha, newSha);
  assert.equal(writes.at(-1).verdict.verdict, 'reject');
  assert.equal(writes.at(-1).liveFailure.category, 'verification-unresolved');
});

test('provider diagnostics distinguish quota and transport without storing upstream messages', () => {
  assert.deepEqual(providerFailure({ codexErrorInfo: 'UsageLimitExceeded', message: 'secret@example.com' }), { category: 'usage-limit', code: 'UsageLimitExceeded' });
  assert.equal(providerFailure({ codexErrorInfo: { HttpConnectionFailed: { httpStatusCode: 503 } } }).category, 'provider-unavailable');
  assert.equal(providerFailure({ codexErrorInfo: 'ResponseStreamDisconnected' }).category, 'provider-unavailable');
  assert.deepEqual(providerFailure({ message: 'unknown private diagnostics' }), { category: 'verification-unresolved' });
});

test('read-only quota preflight waits for both exhausted windows and never assumes a missing reset', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  assert.equal(exhaustedWindow({ rateLimits: { primary: { usedPercent: 2 } } }, now), null);
  const failure = exhaustedWindow({ rateLimits: { primary: { usedPercent: 100, resetsAt: now / 1000 + 60 }, secondary: { usedPercent: 100, resetsAt: now / 1000 + 120 } } }, now);
  assert.equal(Date.parse(failure.retryAfter), now + 120000);
  assert.equal(liveRetryAllowed({ liveFailure: failure }, { now }), false);
  assert.equal(liveRetryAllowed({ liveFailure: failure }, { now: now + 120000 }), true);
  assert.equal(liveRetryAllowed({ liveFailure: { category: 'usage-limit' } }, { now }), false);
  assert.equal(liveRetryAllowed({ liveFailure: { category: 'verification-unresolved' } }), false);
  assert.equal(liveRetryAllowed({ liveFailure: { category: 'provider-unavailable' }, liveVerificationRetries: 2 }), false);
});

test('actual live controller holds exact candidate on failed, corrupt or absent reports', async () => {
  for (const report of [null, { sha: 'a'.repeat(40), providerFailure: { category: 'usage-limit' } }, 'corrupt', { sha: 'b'.repeat(40), providerFailure: { category: 'provider-unavailable' } }]) {
    const writes = [], task = { branch: 'auto/normal-retained', sha: 'a'.repeat(40), result: { title: 'same feature' }, verdict: { verdict: 'approve' } };
    const fn = await load('verifyLiveCandidate', 'resumeLiveVerification', {
      path, runDir: '/run', policy: { liveAiVerification: { enabled: true } }, config: { repositoryPath: '/repo' }, stateDir: '/state', TASK_TIMING: { liveAiMs: 100 }, safeEnv: x => x,
      command: async () => { throw new Error('upstream failed'); },
      json: async () => { if (report === 'corrupt') throw new Error('invalid JSON'); return report ?? {}; },
      save: async (file, value) => writes.push({ file, value }),
    });
    await assert.rejects(fn('/candidate', task.sha, 'probe', task), error => error.liveVerificationBlocked === true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].value.stage, 'live-ai-blocked');
    assert.equal(writes[0].value.sha, task.sha);
    assert.deepEqual(writes[0].value.result, task.result);
    assert.equal(writes[0].value.liveFailure.category, report?.sha === task.sha ? 'usage-limit' : 'verification-unresolved');
  }
});

test('actual resume holds an undiagnosed candidate without worktree, model, CI or external writes', async () => {
  const writes = [], task = { stage: 'live-ai-blocked', sha: 'a'.repeat(40), liveFailure: { category: 'verification-unresolved' } };
  const fn = await load('resumeLiveVerification', 'main', { path, runDir: '/run', process: { argv: [] }, liveRetryAllowed, save: async (file, value) => writes.push(value), workspace: () => assert.fail('must not open or generate a candidate') });
  const outcome = await fn({ id: 'previous', task });
  assert.equal(outcome.status, 'awaiting-verification');
  assert.equal(writes[0].sha, task.sha);
});
