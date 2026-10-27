import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function command(');
const end = source.indexOf('async function gh(', start);
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const output = '\u65e5\u672c\u8a9e\ud83d\ude80';
const errorOutput = '\u30ec\u30d3\u30e5\u30fc\u6307\u6458';

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'retro-command-'));
  try {
    const script = path.join(root, 'split-output.mjs');
    await writeFile(script, `
const stdout = Buffer.from(${JSON.stringify(output)});
const stderr = Buffer.from(${JSON.stringify(errorOutput)});
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
for (const byte of stdout) { process.stdout.write(Buffer.of(byte)); await pause(); }
for (const byte of stderr) { process.stderr.write(Buffer.of(byte)); await pause(); }
process.exitCode = Number(process.argv[2] || 0);
`);
    const context = { config: { repositoryPath: root, commands: { node: { file: process.execPath }, codex: { file: process.execPath } } }, deadline: Date.now() + 30_000, spawn, writeFile };
    const load = new AsyncFunction(...Object.keys(context), `${source.slice(start, end)}; return command;`);
    const command = await load(...Object.values(context));
    await run({ root, script, command });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('actual command preserves split UTF-8 stdout, stderr, and log without replacement characters', async () => fixture(async ({ root, script, command }) => {
  const log = path.join(root, 'output.log');
  assert.equal(await command('node', [script], { log }), output);
  const stored = await readFile(log, 'utf8');
  assert.equal(stored, `${output}\n${errorOutput}`);
  assert.ok(!stored.includes('\uFFFD'));
}));

test('actual command preserves split UTF-8 stderr in failure diagnostics', async () => fixture(async ({ script, command }) => {
  await assert.rejects(command('node', [script, '7']), error => {
    assert.equal(error.message, `node failed (7). ${errorOutput}`);
    assert.ok(!error.message.includes('\uFFFD'));
    return true;
  });
}));
