import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changedPathsBlocked } from './core.mjs';

const execute = promisify(execFile);
const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function prepareRecovery(');
const end = source.indexOf('async function develop(', start);
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'retro-resume-'));
  const main = path.join(root, 'main');
  const stateDir = path.join(root, 'state');
  const runDir = path.join(root, 'run');
  const branch = 'auto/normal-previous';
  const original = path.join(stateDir, 'worktrees', branch.replaceAll('/', '-'));
  const fresh = path.join(root, 'fresh');
  const calls = [];
  const git = async (args, cwd = main, options = {}) => {
    calls.push({ args, cwd });
    const env = { ...process.env, ...(options.indexFile ? { GIT_INDEX_FILE: options.indexFile } : {}) };
    if (!options.input) return (await execute('git', args, { cwd, env, encoding: 'utf8' })).stdout.trimEnd();
    return await new Promise((resolve, reject) => {
      const child = execFile('git', args, { cwd, env, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trimEnd()));
      child.stdin.end(options.input);
    });
  };
  try {
    await mkdir(main); await mkdir(runDir); await mkdir(path.dirname(original), { recursive: true });
    await git(['init', '-b', 'main']);
    await git(['config', 'user.name', 'Recovery Test']);
    await git(['config', 'user.email', 'recovery-test@example.invalid']);
    await mkdir(path.join(main, 'docs'));
    await mkdir(path.join(main, 'scripts'));
    await writeFile(path.join(main, 'docs/committed.md'), 'base\n');
    await writeFile(path.join(main, 'docs/dirty.md'), 'base\n');
    await writeFile(path.join(main, 'scripts/controller.mjs'), 'old controller\n');
    await git(['add', '.']); await git(['commit', '-m', 'base']);
    await git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await git(['worktree', 'add', '-b', branch, original, 'HEAD']);
    await writeFile(path.join(original, 'docs/committed.md'), 'candidate committed\n');
    await git(['add', '.'], original); await git(['commit', '-m', 'candidate'], original);
    await writeFile(path.join(original, 'docs/dirty.md'), 'candidate staged draft\n');
    await git(['add', 'docs/dirty.md'], original);
    await writeFile(path.join(original, 'docs/dirty.md'), 'candidate dirty\n');
    await writeFile(path.join(original, 'docs/untracked.md'), 'candidate untracked\n');
    await writeFile(path.join(main, 'scripts/controller.mjs'), 'current controller\n');
    await git(['add', '.']); await git(['commit', '-m', 'current controller fix']);
    await git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await git(['worktree', 'add', '-b', 'auto/normal-recovery', fresh, 'main']);
    const context = { path, stateDir, runDir, readdir, lstat, readFile, writeFile, rm, randomBytes, git, changedPathsBlocked, policy: { protectedPaths: ['scripts/**'] }, json: async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } } };
    const prepare = new AsyncFunction(...Object.keys(context), `${source.slice(start, end)}; return prepareRecovery;`);
    const prepareRecovery = await prepare(...Object.values(context));
    await run({ root, original, fresh, calls, git, prepareRecovery, policy: context.policy, previous: { id: 'previous', dir: runDir, reason: 'failed', task: { branch, plan: { title: 'preserved approved plan' } } } });
    assert.deepEqual((await readdir(runDir)).filter(name => /\.index(?:\.lock)?$/.test(name)), []);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('authorized business actions and fixture support survive the real recovery transfer with original history intact', async () => fixture(async ({ original, fresh, git, prepareRecovery, previous, policy }) => {
  Object.assign(policy, JSON.parse(await readFile(new URL('../../automation/policy.json', import.meta.url), 'utf8')));
  const files = ['src/app/teams/example/actions.ts', 'src/app/api/example/route.ts', 'e2e/helpers.ts', 'scripts/automation/live-ui-store.ts'];
  for (const file of files) {
    await mkdir(path.dirname(path.join(original, file)), { recursive: true });
    await writeFile(path.join(original, file), `// authorized repair: ${file}\n`);
  }
  const originalStatus = await git(['status', '--porcelain'], original);
  const originalSha = await git(['rev-parse', 'HEAD'], original);
  const outcome = await prepareRecovery(previous, fresh);
  assert.equal(outcome.transferredPatch, true);
  assert.equal(outcome.applyProblem, undefined);
  for (const file of files) assert.equal(await readFile(path.join(fresh, file), 'utf8'), await readFile(path.join(original, file), 'utf8'));
  assert.equal(await git(['status', '--porcelain'], original), originalStatus);
  assert.equal(await git(['rev-parse', 'HEAD'], original), originalSha);
}));

test('recovery transfers committed, dirty, and untracked candidate files onto current main without reverting controller fixes', async () => fixture(async ({ original, fresh, git, prepareRecovery, previous }) => {
  const originalSha = await git(['rev-parse', 'HEAD'], original);
  const originalIndex = await git(['diff', '--cached', '--binary'], original);
  const originalStatus = await git(['status', '--porcelain'], original);
  const result = await prepareRecovery(previous, fresh);
  assert.equal(result.transferredPatch, true);
  assert.equal(result.applyProblem, undefined);
  assert.equal(result.plan.title, 'preserved approved plan');
  assert.equal(result.preventionRequired, true);
  for (const [file, content] of [['committed', 'candidate committed'], ['dirty', 'candidate dirty'], ['untracked', 'candidate untracked']]) {
    assert.equal((await readFile(path.join(fresh, `docs/${file}.md`), 'utf8')).trim(), content);
    assert.equal((await readFile(path.join(original, `docs/${file}.md`), 'utf8')).trim(), content);
  }
  assert.equal(await git(['rev-parse', 'HEAD'], original), originalSha);
  assert.equal(await git(['diff', '--cached', '--binary'], original), originalIndex);
  assert.equal(await git(['status', '--porcelain'], original), originalStatus);
  assert.equal((await readFile(path.join(fresh, 'scripts/controller.mjs'), 'utf8')).trim(), 'current controller');
}));

test('recovery finds the latest recovery-tagged plan when a task checkpoint lacks its plan', async () => fixture(async ({ fresh, prepareRecovery, previous }) => {
  await writeFile(path.join(previous.dir, 'mutation-recovery-plan-1.json'), JSON.stringify({ plan: { title: 'old proposal' } }));
  await writeFile(path.join(previous.dir, 'mutation-recovery-plan-2.json'), JSON.stringify({ plan: { title: 'latest reviewed proposal' } }));
  const result = await prepareRecovery({ ...previous, task: { branch: previous.task.branch } }, fresh);
  assert.equal(result.plan.title, 'latest reviewed proposal');
}));

test('recovery retains nested approved context across a previous planning timeout', async () => fixture(async ({ fresh, prepareRecovery, previous }) => {
  const result = await prepareRecovery({ ...previous, task: { branch: previous.task.branch, recovery: { plan: { title: 'original approved context' } } } }, fresh);
  assert.equal(result.plan.title, 'original approved context');
}));

test('recovery excludes only untracked legacy controller output and preserves original candidate and index', async () => fixture(async ({ original, fresh, git, prepareRecovery, previous }) => {
  await writeFile(path.join(original, 'automation-result.json'), '{"noChange":false}');
  const status = await git(['status', '--porcelain'], original);
  const index = await git(['diff', '--cached'], original);
  const result = await prepareRecovery(previous, fresh);
  assert.equal(result.transferredPatch, true);
  assert.equal((await readFile(path.join(fresh, 'docs/dirty.md'), 'utf8')).trim(), 'candidate dirty');
  await assert.rejects(readFile(path.join(fresh, 'automation-result.json')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(original, 'automation-result.json'), 'utf8'), '{"noChange":false}');
  assert.equal(await git(['status', '--porcelain'], original), status);
  assert.equal(await git(['diff', '--cached'], original), index);
}));

test('legacy output exclusion never allows tracked output or other protected files', async () => fixture(async ({ original, fresh, git, calls, prepareRecovery, previous }) => {
  await writeFile(path.join(original, 'automation-result.json'), '{}');
  await writeFile(path.join(original, 'scripts/controller.mjs'), 'protected change');
  await assert.rejects(prepareRecovery(previous, fresh), /protected paths/);
  await git(['add', 'automation-result.json'], original);
  await assert.rejects(prepareRecovery(previous, fresh), /tracks reserved controller output/);
  assert.equal(calls.filter(call => call.args[0] === 'apply').length, 0);
}));

test('interrupted baseline handoff uses the preserved original candidate branch', async () => fixture(async ({ fresh, prepareRecovery, previous }) => {
  const result = await prepareRecovery({ ...previous, task: { ...previous.task, branch: 'auto/normal-empty-recovery', recoverySourceBranch: previous.task.branch } }, fresh);
  assert.equal(result.transferredPatch, true);
  assert.equal(result.branch, previous.task.branch);
  assert.equal((await readFile(path.join(fresh, 'docs/dirty.md'), 'utf8')).trim(), 'candidate dirty');
}));

test('recovery rejects unsafe branch and protected candidate changes before apply', async () => fixture(async ({ original, fresh, calls, prepareRecovery, previous }) => {
  const applied = () => calls.filter(call => call.args[0] === 'apply').length;
  await assert.rejects(prepareRecovery({ ...previous, task: { branch: '../outside' } }, fresh), /Unsafe previous task branch/);
  assert.equal(applied(), 0);
  await writeFile(path.join(original, 'scripts/controller.mjs'), 'unsafe candidate control\n');
  await assert.rejects(prepareRecovery(previous, fresh), /protected paths/);
  assert.equal(applied(), 0);
  assert.equal((await readFile(path.join(fresh, 'docs/committed.md'), 'utf8')).trim(), 'base');
}));
