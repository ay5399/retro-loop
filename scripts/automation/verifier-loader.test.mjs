import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCandidateVerifier } from './verifier-loader.mjs';

test('candidate verifier executes its own source with controller dependencies, never the stale checkout source', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'retro-verifier-loader-'));
  const controller = path.join(root, 'controller'), candidate = path.join(root, 'candidate');
  try {
    for (const dir of [controller, candidate]) await mkdir(path.join(dir, 'scripts/automation'), { recursive: true });
    await mkdir(path.join(controller, 'node_modules/fixture-dependency'), { recursive: true });
    await writeFile(path.join(controller, 'node_modules/fixture-dependency/package.json'), JSON.stringify({ name: 'fixture-dependency', type: 'module', exports: './index.mjs' }));
    await writeFile(path.join(controller, 'node_modules/fixture-dependency/index.mjs'), 'export const value = "installed";');
    await writeFile(path.join(controller, 'scripts/automation/verify-live-chat-ui.mjs'), 'throw new Error("stale verifier");');
    await writeFile(path.join(candidate, 'scripts/automation/verify-live-chat-ui.mjs'), 'import { value } from "fixture-dependency"; export const result = "candidate:" + value; export const root = new URL("../../", import.meta.url).pathname;');
    const first = await loadCandidateVerifier(controller, candidate);
    assert.equal(first.result, 'candidate:installed');
    assert.ok(decodeURIComponent(first.root).includes('/controller/'));
    await writeFile(path.join(candidate, 'scripts/automation/verify-live-chat-ui.mjs'), 'export const result = "new reviewed candidate";');
    assert.equal((await loadCandidateVerifier(controller, candidate)).result, 'new reviewed candidate');
  } finally { await rm(root, { recursive: true, force: true }); }
});
