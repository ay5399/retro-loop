import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('release requires safe rollback runtime at its public alias and exact SHA', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-release-test-'));
  const originalEnv = { ...process.env }, originalArgv = [...process.argv], originalFetch = globalThis.fetch;
  const sha = 'a'.repeat(40), previous = 'https://retro-safe-team.vercel.app';
  const calls = [];
  let health = { sha, liveLlm: false, liveEmail: false, keysPresent: false };
  try {
    Object.assign(process.env, { AUTOMATION_PRODUCTION_ALIAS: 'retro-blush.vercel.app', VERCEL_PROJECT_ID: 'test-project', VERCEL_ORG_ID: 'test-team', VERCEL_TOKEN: 'test-token', HEALTHCHECK_TOKEN: 'test-health-token', GITHUB_OUTPUT: path.join(dir, 'output'), PREVIOUS: previous, PREVIOUS_SHA: sha });
    globalThis.fetch = async url => {
      calls.push(String(url));
      const data = String(url).includes('/v9/projects/') ? { name: 'retro', targets: { production: { url: new URL(previous).hostname, alias: ['retro-git-main-team.vercel.app', 'retro-blush.vercel.app'] } } }
        : String(url).includes('/v13/deployments/') ? { meta: { automationReleaseSha: sha } } : health;
      return { ok: true, json: async () => data, text: async () => '<html>RetroLoop</html>' };
    };
    process.argv[2] = 'previous';
    await import(`./deployment.mjs?case=valid-${Date.now()}`);
    assert.ok(calls.some(url => url === 'https://retro-blush.vercel.app/api/health'));
    assert.ok(calls.every(url => url !== `${previous}/api/health`));
    assert.match(await readFile(path.join(dir, 'output'), 'utf8'), new RegExp(`previous_sha=${sha}`));
    process.env.AUTOMATION_PRODUCTION_ALIAS = 'other.vercel.app';
    await assert.rejects(import(`./deployment.mjs?case=wrong-alias-${Date.now()}`), /Configured production alias/);
    process.env.AUTOMATION_PRODUCTION_ALIAS = 'retro-blush.vercel.app';
    health = { ...health, keysPresent: true };
    await assert.rejects(import(`./deployment.mjs?case=key-${Date.now()}`), /Runtime SHA or external-call gates/);
    process.argv[2] = 'verify-rollback';
    health = { sha: 'b'.repeat(40), liveLlm: false, liveEmail: false, keysPresent: false };
    await assert.rejects(import(`./deployment.mjs?case=wrong-sha-${Date.now()}`), /Runtime SHA or external-call gates/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv); process.argv = originalArgv;
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
