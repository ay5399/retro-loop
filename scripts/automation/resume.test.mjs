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
    await run({ root, original, fresh, calls, git, prepareRecovery, previous: { id: 'previous', dir: runDir, reason: 'failed', task: { branch, plan: { title: 'preserved approved plan' } } } });
    assert.deepEqual((await readdir(runDir)).filter(name => /\.index(?:\.lock)?$/.test(name)), []);
  } finally { await rm(root, { recursive: true, force: true }); }
}

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

test('recovery rejects unsafe branch and protected candidate changes before apply', async () => fixture(async ({ original, fresh, calls, prepareRecovery, previous }) => {
  const applied = () => calls.filter(call => call.args[0] === 'apply').length;
  await assert.rejects(prepareRecovery({ ...previous, task: { branch: '../outside' } }, fresh), /Unsafe previous task branch/);
  assert.equal(applied(), 0);
  await writeFile(path.join(original, 'scripts/controller.mjs'), 'unsafe candidate control\n');
  await assert.rejects(prepareRecovery(previous, fresh), /protected paths/);
  assert.equal(applied(), 0);
  assert.equal((await readFile(path.join(fresh, 'docs/committed.md'), 'utf8')).trim(), 'base');
}));
