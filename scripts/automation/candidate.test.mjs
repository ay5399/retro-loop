import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCandidateTextFiles, validateCandidateDiff, assertCandidateValid } from './candidate.mjs';
const diff = (text, file = 'e2e/chat.spec.ts') => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +12,1 @@\n+${text}\n`;

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
