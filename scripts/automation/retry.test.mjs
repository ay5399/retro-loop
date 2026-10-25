import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireReview } from './core.mjs';

// Exercise the controller's real retry block without models, GitHub or production.
const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const implementationStart = source.indexOf('    let files, sha, verdict;');
const implementationEnd = source.indexOf('    for (const image of result.screenshots)');
assert.ok(implementationStart >= 0 && implementationEnd > implementationStart);
const block = source.slice(implementationStart, implementationEnd);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function simulate(verdicts, failingChecks = 0) {
  const calls = [], records = [];
  let commits = 0, reviews = 0, checks = 0;
  const result = { title: 'test', sources: ['https://example.com'], screenshots: ['proof.png'] };
  const context = {
    deadline: Date.now() + 90 * 60_000, result, plan: {}, dir: 'worktree', runDir: 'logs', kind: 'normal', branch: 'auto/test', policy: {}, baseInstruction: '',
    git: async args => {
      if (args[0] === 'commit') { commits++; return ''; }
      if (args[0] === 'rev-parse') return commits.toString(16).padStart(40, '0');
      if (args.includes('--name-only')) return args.includes('--diff-filter=D') ? '' : 'docs/improvement.md';
      return '';
    },
    changedPathsBlocked: () => [], needsLiveAiVerification: () => false, requireReview,
    review: async (dir, sha) => { calls.push(`review:${sha}`); const choice = verdicts[reviews++] ?? 'approve'; return { sha, verdict: typeof choice === 'string' ? choice : choice.verdict, reason: 'findings to fix', risk: typeof choice === 'string' ? 'reversible' : choice.risk }; },
    checks: async () => { calls.push('checks'); if (checks++ < failingChecks) throw new Error('CI broken'); },
    save: async (file, record) => records.push(record), path: { join: (...parts) => parts.join('/') },
    readdir: async () => ['normal-after-1-checks.log'], readFile: async () => 'actual CI diagnostics',
    generate: async prompt => { calls.push('fix'); assert.match(prompt, /findings to fix|actual CI diagnostics/); return result; },
  };
  const run = new AsyncFunction(...Object.keys(context), block + '\nreturn { sha, verdict };');
  try { return { value: await run(...Object.values(context)), calls, records }; }
  catch (error) { return { error, calls, records }; }
}
test('two requested revisions are fixed and reviewed on new SHAs before validation', async () => {
  const run = await simulate(['revise', 'revise', 'approve']);
  assert.equal(run.error, undefined);
  assert.equal(run.calls.filter(c => c === 'fix').length, 2);
  assert.equal(new Set(run.calls.filter(c => c.startsWith('review:'))).size, 3);
  assert.equal(run.calls.at(-1), 'checks');
  assert.equal(run.records.at(-1).status, 'passed');
});
test('three failed reviews stop without running unapproved code', async () => {
  const run = await simulate(['revise', 'revise', 'revise']);
  assert.match(run.error.message, /after 3/);
  assert.equal(run.calls.includes('checks'), false);
  assert.equal(run.calls.filter(c => c === 'fix').length, 2);
});
test('CI failures return diagnostics to correction then require another review', async () => {
  const run = await simulate(['approve', 'approve'], 1);
  assert.equal(run.error, undefined);
  assert.deepEqual(run.calls.map(c => c.startsWith('review:') ? 'review' : c), ['review', 'checks', 'fix', 'review', 'checks']);
});
const planBlock = source.slice(source.indexOf('    let plan;'), source.indexOf("    let result = plan.decision"));
test('plan must be approved after researched revisions before implementation', async () => {
  let revisions = 0, reviews = 0;
  const plans = [];
  const context = {
    baselineFailure: '', git: async () => '', dir: 'worktree', baseInstruction: 'research competitors and user problems', runDir: 'logs', kind: 'normal',
    generate: async prompt => { revisions++; assert.match(prompt, /PLANNING ONLY/); return { sources: ['https://example.com'], decision: 'implement', summary: `plan ${revisions}` }; },
    createHash: () => ({ update: value => ({ digest: () => value.length.toString(16).padStart(40, '0') }) }),
    review: async (dir, sha, plan, options) => { assert.equal(options.planning, true); return { sha, verdict: ++reviews < 3 ? 'revise' : 'approve', risk: 'reversible', reason: 'improve evidence' }; },
    save: async (file, value) => plans.push(value), path: { join: (...parts) => parts.join('/') },
  };
  const run = new AsyncFunction(...Object.keys(context), planBlock + '\nreturn plan;');
  const approved = await run(...Object.values(context));
  assert.equal(approved.summary, 'plan 3');
  assert.equal(plans.length, 3);
  assert.equal(plans.at(-1).verdict.verdict, 'approve');
});

test('rejection and approval-required revisions never trigger automatic corrections or validation', async () => {
  for (const verdict of ['reject', { verdict: 'revise', risk: 'approval-required' }]) {
    const run = await simulate([verdict]);
    assert.match(run.error.message, /rejected or requires approval/);
    assert.equal(run.calls.includes('fix'), false);
    assert.equal(run.calls.includes('checks'), false);
  }
});

test('approved prototype requiring owner approval can finish validation; release still requires separate approval', async () => {
  const run = await simulate([{ verdict: 'approve', risk: 'approval-required' }]);
  assert.equal(run.error, undefined);
  assert.equal(run.value.verdict.risk, 'approval-required');
  assert.equal(run.calls.includes('fix'), false);
  assert.equal(run.calls.at(-1), 'checks');
});
