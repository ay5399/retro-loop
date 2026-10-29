import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readUIMessageStream } from 'ai';
import { assertSafeStylesheet, fixtureSdkAliases, createFixtureChatStream } from './verify-live-chat-ui.mjs';

test('live fixture rejects CSS that can load host code or additional files', () => {
  for (const css of ['@plugin "./host.js";', '@config "./host.js";', '@source "../../private";', '@import "./host.css";', '@reference "./host.css";', '@pl\\75gin "./host.js";']) {
    assert.throws(() => assertSafeStylesheet(css), /may not load/);
  }
});
test('current CSS and ordinary Tailwind variants remain usable', async () => {
  assert.doesNotThrow(() => assertSafeStylesheet('@import \'tailwindcss\'; @custom-variant dark (&:where(.dark, .dark *)); @utility tab-4 { tab-size: 4; } @variant dark { color: black; } @font-face { font-family: test; }'));
  const current = await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  assert.doesNotThrow(() => assertSafeStylesheet(current));
});

test('live fixture bundles locked installed SDK entries despite candidate partial packages', async () => {
  const installed = createRequire(import.meta.url);
  const repositoryRoot = path.dirname(path.dirname(path.dirname(installed.resolve('ai/package.json'))));
  const { build } = installed('esbuild');
  const candidate = await mkdtemp(path.join(tmpdir(), 'retro-partial-sdk-'));
  try {
    for (const name of ['ai', '@ai-sdk/react']) {
      const dir = path.join(candidate, 'node_modules', name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, type: 'module', exports: { '.': './dist/index.js' } }));
    }
    const entry = path.join(candidate, 'candidate.ts');
    await writeFile(entry, "export { DefaultChatTransport } from 'ai'; export { useChat } from '@ai-sdk/react';");
    const options = { entryPoints: [entry], bundle: true, platform: 'browser', write: false, metafile: true, logLevel: 'silent' };
    await assert.rejects(build(options), /Could not resolve/);
    const bundled = await build({ ...options, alias: await fixtureSdkAliases(repositoryRoot) });
    assert.ok(bundled.outputFiles[0].contents.length > 0);
    assert.ok(Object.keys(bundled.metafile.inputs).some(file => file.replaceAll('\\', '/').endsWith('/ai/dist/index.js')));
    assert.ok(!Object.keys(bundled.metafile.inputs).some(file => path.resolve(file).startsWith(path.join(candidate, 'node_modules') + path.sep)));
  } finally { await rm(candidate, { recursive: true, force: true }); }
});

test('successful fixture turns finish with distinct assistant IDs and preserve streamed output', async () => {
  const report = { transcripts: [] }, messages = [], ids = [];
  for (const input of ['相談1', '相談2']) {
    const complete = async (text, onDelta) => { onDelta('保存前に'); onDelta('確認します'); return { text: '保存前に確認します', elapsedMs: 10, input: text }; };
    const [events, updates] = createFixtureChatStream({ complete, input, report }).tee();
    const [chunks, snapshots] = await Promise.all([
      (async () => { const result = []; for await (const event of events) result.push(event); return result; })(),
      (async () => { const result = []; for await (const message of readUIMessageStream({ stream: updates, terminateOnError: true })) result.push(message); return result; })(),
    ]);
    assert.equal(chunks[0].type, 'start');
    assert.deepEqual(chunks.at(-1), { type: 'finish', finishReason: 'stop' });
    ids.push(chunks[0].messageId);
    const message = snapshots.at(-1);
    assert.equal(message.id, chunks[0].messageId);
    assert.equal(message.role, 'assistant');
    assert.equal(message.parts.filter(part => part.type === 'text').map(part => part.text).join(''), '保存前に確認します');
    messages.push(message);
  }
  assert.equal(new Set(ids).size, 2);
  assert.equal(messages.length, 2);
  assert.deepEqual(report.transcripts.map(turn => ({ input: turn.input, text: turn.text })), [{ input: '相談1', text: '保存前に確認します' }, { input: '相談2', text: '保存前に確認します' }]);
});
