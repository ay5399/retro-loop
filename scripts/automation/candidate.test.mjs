import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCandidateTextFiles, validateCandidateDiff, assertCandidateValid, requireImplementationSandbox, recoveryVerificationEvidence } from './candidate.mjs';
const diff = (text, file = 'e2e/chat.spec.ts') => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +12,1 @@\n+${text}\n`;

const launch = mode => `OpenAI Codex v0.163.0\n--------\nworkdir: test\nmodel: test\napproval: never\nsandbox: ${mode}\nsession id: current\n--------\n`;

test('verification evidence is from the committed clean revision and rejects dirty working content', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retro-current-verification-'));
  const execute = promisify(execFile);
  const git = async args => (await execute('git', args, { cwd: dir })).stdout.trimEnd();
  try {
    await git(['init']); await git(['config', 'user.name', 'Evidence Test']); await git(['config', 'user.email', 'test@example.invalid']);
    await mkdir(path.join(dir, 'scripts/automation'), { recursive: true });
    const file = path.join(dir, 'scripts/automation/verify-live-chat-ui.mjs');
    await writeFile(file, 'current committed check');
    await git(['add', '.']); await git(['commit', '-m', 'current checker']);
    const proof = await recoveryVerificationEvidence(dir, git);
    assert.equal(proof.sha, await git(['rev-parse', 'HEAD']));
    assert.equal(proof.files[0].content, 'current committed check');
    assert.match(proof.files[1].unavailable, /Missing/);
    await writeFile(file, 'uncommitted different check');
    const dirty = await recoveryVerificationEvidence(dir, git);
    assert.match(dirty.unavailable, /dirty/);
    assert.deepEqual(dirty.files, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verification snapshot omits symlinks and oversized blobs without reading their contents', async () => {
  const calls = [], sha = 'a'.repeat(40);
  const git = async args => {
    calls.push(args);
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'status') return '';
    if (args[0] === 'ls-tree') return `${args.at(-1).includes('verify-live') ? '120000' : '100644'} blob ${sha}\t${args.at(-1)}`;
    if (args[0] === 'cat-file') return '16385';
    assert.fail('Source contents must not be read');
  };
  const proof = await recoveryVerificationEvidence('fixture', git);
  assert.match(proof.files[0].unavailable, /not a regular/);
  assert.match(proof.files[1].unavailable, /16 KiB/);
  assert.equal(calls.some(args => args[0] === 'show'), false);
});

test('installed CLI stdin probe stderr is accepted without scanning quoted tool output', async () => {
  // Captured 2026-10-30 with the installed runner command, stdin and elevated workspace-write.
  // Only the private worktree path and session ID were redacted.
  const stderr = await readFile(new URL('./fixtures/codex-0.163.0-stderr.txt', import.meta.url), 'utf8');
  assert.equal(requireImplementationSandbox(stderr + '\n' + launch('read-only')), 'workspace-write [workdir, /tmp, $TMPDIR]');
});

test('implementation accepts its workspace-write launch even when tools quote an older read-only launch', () => {
  const log = launch('workspace-write [workdir, /tmp, $TMPDIR]') + 'exec\nGet-Content old.log\n' + launch('read-only');
  assert.equal(requireImplementationSandbox(log), 'workspace-write [workdir, /tmp, $TMPDIR]');
  assert.equal(requireImplementationSandbox(log.replaceAll('\n', '\r\n')), 'workspace-write [workdir, /tmp, $TMPDIR]');
});

test('quoted workspace-write never authorizes a read-only, unrestricted, missing or ambiguous launch', () => {
  for (const mode of ['read-only', 'danger-full-access', 'workspace-write-fake', 'workspace-write\nsandbox: read-only']) {
    assert.throws(() => requireImplementationSandbox(launch(mode) + launch('workspace-write')), /launch sandbox is/);
  }
  assert.throws(() => requireImplementationSandbox('sandbox: workspace-write\n'), /unverified/);
  assert.throws(() => requireImplementationSandbox('tool output\n' + launch('workspace-write')), /unverified/);
  assert.throws(() => requireImplementationSandbox('{"summary":"done"}\n' + launch('workspace-write')), /unverified/);
  assert.throws(() => requireImplementationSandbox(launch('read-only').replace('sandbox:', 'quoted:') + launch('workspace-write')), /unverified/);
  assert.equal(requireImplementationSandbox(launch('workspace-write')), 'workspace-write');
});

test('literal loopback assertion allowed while calls, external URLs and credentials remain blocked', () => {
  assert.deepEqual(validateCandidateDiff(diff('expect(baseURL).toBe("http://localhost:3000");')), []);
  for (const text of ['fetch("http://localhost:3000")', 'expect(baseURL).toBe("https://example.com")', 'if (process.env.CHAT_FAILURE_BASELINE) return;', 'const x = process["env"].TOKEN;', 'import { SDK } from "@vendor/sdk";', 'const x = import("thing")']) {
    const findings = validateCandidateDiff(diff(text));
    assert.ok(findings.length, text);
    assert.equal(findings[0].file, 'e2e/chat.spec.ts');
    assert.equal(findings[0].line, 12);
  }
  const env = validateCandidateDiff(diff('if (process.env.CHAT_FAILURE_BASELINE) return;'));
  assert.match(env[0].guidance, /Do not add environment switches/);
  assert.match(env[0].guidance, /recorded existing baseline screenshots/);
  assert.throws(() => assertCandidateValid(env), /e2e\/chat.spec.ts:12/);
  assert.ok(validateCandidateDiff(diff('fetch("/api/chat")', 'src/app/page.tsx')).length);
  assert.ok(validateCandidateDiff(diff('const token = process.env.TOKEN', 'src/app/page.tsx')).length);
});

test('test disabling and deleted coverage remain blocked', () => {
  assert.ok(validateCandidateDiff(diff('test.skip("failure", () => {})')).length);
  assert.ok(validateCandidateDiff('+++ b/e2e/chat.spec.ts\n@@ -1 +1 @@\n-expect(value).toBe(true)\n+expect(value).toBe(false)').length);
});

test('loopback comparison exemption never allows requests, navigation, or compound statements', () => {
  const blocked = [
    'expect((await page.request.get("http://127.0.0.1:5432/")).ok()).toBeTruthy();',
    'expect(x).toBe(1); await page.request.post("http://localhost:3000/api/admin", { data });',
    'expect(await page.goto("http://[::1]:6379/")).toBeTruthy();',
    'expect(baseURL).toBe("http://localhost:3000"); await page.request.post(baseURL);',
    'expect(page.goto("http://localhost:3000")).toEqual("http://localhost:3000");'
  ];
  for (const text of blocked) assert.ok(validateCandidateDiff(diff(text)).some(item => item.reason === 'New URL in runtime or browser test'), text);
  for (const text of ['expect(baseURL).toBe("http://localhost:3000");', "expect(baseURL).toEqual('http://127.0.0.1:3000/');"]) assert.deepEqual(validateCandidateDiff(diff(text)), []);
});

test('deleted-file diagnostics retain the removed file path rather than the previous diff path', () => {
  const combined = diff('documentation', 'docs/readme.md') + 'diff --git a/e2e/deleted.spec.ts b/e2e/deleted.spec.ts\n--- a/e2e/deleted.spec.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-expect(value).toBe(true);\n';
  const findings = validateCandidateDiff(combined);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'e2e/deleted.spec.ts');
});

test('actual git diffs cannot spoof a docs header from inside a source hunk or skip plus-prefixed code', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retro-diff-header-'));
  const execute = promisify(execFile);
  try {
    await execute('git', ['init'], { cwd: root });
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/spoof.ts'), '/*\n++ b/docs/innocent.md\n*/\nconst secret = process.env.TOKEN;\n');
    await writeFile(path.join(root, 'src/increment.ts'), '++process.env.COUNT;\n');
    await execute('git', ['add', '.'], { cwd: root });
    const { stdout } = await execute('git', ['diff', '--cached', '--no-ext-diff'], { cwd: root, encoding: 'utf8' });
    assert.match(stdout, /^\+\+\+ b\/docs\/innocent\.md$/m);
    assert.match(stdout, /^\+\+\+process\.env\.COUNT;/m);
    const findings = validateCandidateDiff(stdout).filter(item => item.reason === 'Runtime environment or credential access');
    assert.deepEqual(findings.map(({ file, line }) => ({ file, line })), [
      { file: 'src/increment.ts', line: 1 },
      { file: 'src/spoof.ts', line: 4 }
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual Git C-quoted Unicode paths remain subject to runtime safety validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retro-diff-quoted-'));
  const execute = promisify(execFile);
  try {
    await execute('git', ['init'], { cwd: root });
    await mkdir(path.join(root, 'src'));
    const name = 'src/\u65e5\u672c\u8a9e file.ts';
    await writeFile(path.join(root, name), 'const secret = process.env.TOKEN;\n');
    await execute('git', ['add', '.'], { cwd: root });
    const { stdout } = await execute('git', ['-c', 'core.quotePath=true', 'diff', '--cached', '--no-ext-diff'], { cwd: root, encoding: 'utf8' });
    assert.match(stdout, /^\+\+\+ "b\/src\//m);
    const findings = validateCandidateDiff(stdout);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, name);
    assert.equal(findings[0].line, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Git C-quoted control characters and quoted deletion paths preserve safety and attribution', () => {
  const quoted = 'diff --git "a/src/name\\tfile.ts" "b/src/name\\tfile.ts"\n--- "a/src/name\\tfile.ts"\n+++ "b/src/name\\tfile.ts"\n@@ -0,0 +1 @@\n+const secret = process.env.TOKEN;\n';
  assert.equal(validateCandidateDiff(quoted)[0].file, 'src/name\tfile.ts');
  const removed = 'diff --git "a/e2e/name\\tfile.spec.ts" "b/e2e/name\\tfile.spec.ts"\n--- "a/e2e/name\\tfile.spec.ts"\n+++ /dev/null\n@@ -1 +0,0 @@\n-expect(x).toBe(true);\n';
  assert.equal(validateCandidateDiff(removed)[0].file, 'e2e/name\tfile.spec.ts');
  assert.throws(() => validateCandidateDiff('+++ "b/src/bad\\q.ts"\n'), /Invalid escape/);
});

test('changed code and docs must be valid UTF-8 without replacement characters', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retro-candidate-'));
  try {
    await writeFile(path.join(root, 'bad.md'), Buffer.from([0x61, 0x0a, 0xff]));
    await writeFile(path.join(root, 'bad.ts'), 'good\n\uFFFD');
    await writeFile(path.join(root, 'good.md'), '日本語');
    const findings = await validateCandidateTextFiles(root, ['bad.md', 'bad.ts', 'good.md', 'deleted.md']);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].line, 2);
    assert.match(findings[0].reason, /Invalid UTF-8/);
    assert.equal(findings[1].line, 2);
    assert.match(findings[1].reason, /replacement/);
    await writeFile(path.join(root, 'conflict.ts'), '<<<<<<< ours\nconst value = 1;\n=======\nconst value = 2;\n>>>>>>> theirs\n');
    const conflicts = await validateCandidateTextFiles(root, ['conflict.ts']);
    assert.deepEqual(conflicts.map(item => item.line), [1, 3, 5]);
    assert.match(conflicts[0].reason, /merge conflict/);
    assert.equal((await validateCandidateTextFiles(root, ['../outside.md', '/outside.md', 'C:\\outside.md'])).length, 3);
    await mkdir(path.join(root, 'real'));
    await writeFile(path.join(root, 'real', 'doc.md'), 'safe');
    try { await symlink(path.join(root, 'real'), path.join(root, 'linked'), 'junction'); }
    catch (error) { if (error.code !== 'EPERM') throw error; return; }
    assert.match((await validateCandidateTextFiles(root, ['linked/doc.md']))[0].reason, /symbolic link/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('actual Git diff rejects moved or reindented assertions with concrete restoration guidance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retro-diff-assertion-move-'));
  const execute = promisify(execFile);
  const original = '  expect(value).toBe(true);';
  const originalBody = `test("original", () => {\n${original}\n  prepare();\n  exercise();\n  cleanup();\n});\n`;
  try {
    await execute('git', ['init'], { cwd: root });
    await mkdir(path.join(root, 'e2e'));
    const target = path.join(root, 'e2e/chat.spec.ts');
    await writeFile(target, originalBody);
    await execute('git', ['add', '.'], { cwd: root });
    for (const replacement of [
      'test("original", () => {\n  prepare();\n  exercise();\n  cleanup();\n});\ntest("regression", () => {\n' + original + '\n});\n',
      originalBody.replace(original, `  ${original}`)
    ]) {
      await writeFile(target, replacement);
      const { stdout } = await execute('git', ['diff', '--no-ext-diff'], { cwd: root, encoding: 'utf8' });
      const findings = validateCandidateDiff(stdout);
      const removed = findings.find(item => item.guidance.includes(JSON.stringify(original)));
      assert.ok(removed, stdout);
      assert.equal(removed.reason, 'Removing browser test coverage');
      assert.match(removed.guidance, /Moves and reindentation are also rejected/);
      assert.match(removed.guidance, /Restore the original existing test body unchanged; add separate regression tests/);
      assert.throws(() => assertCandidateValid(findings), /expect\(value\)\.toBe\(true\)/);
    }
    await writeFile(target, originalBody + '\ntest("regression", () => {\n  expect(other).toBe(true);\n});\n');
    const { stdout } = await execute('git', ['diff', '--no-ext-diff'], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(validateCandidateDiff(stdout), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('removed assertion excerpts remain bounded', () => {
  const original = `expect("${'x'.repeat(500)}").toBe(true);`;
  const [finding] = validateCandidateDiff(`+++ b/e2e/chat.spec.ts\n@@ -1 +0,0 @@\n-${original}\n`);
  assert.ok(finding.guidance.includes(JSON.stringify(`${original.slice(0, 239)}?`)));
  assert.ok(!finding.guidance.includes(original));
});
