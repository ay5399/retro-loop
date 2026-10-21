import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('rollback uses project-only APIs and rejects a different project or SHA before mutation', async () => {
  const originalEnv = { ...process.env }, originalArgv = [...process.argv], originalFetch = globalThis.fetch;
  const sha = 'a'.repeat(40), posts = [];
  let projectId = 'test-project', restored = false;
  try {
    Object.assign(process.env, { VERCEL_PROJECT_ID: 'test-project', VERCEL_ORG_ID: 'test-team', VERCEL_TOKEN: 'test-token', PREVIOUS: 'https://retro-safe-team.vercel.app', PREVIOUS_SHA: sha });
    process.argv[2] = 'rollback';
    globalThis.fetch = async (url, options) => {
      const pathname = new URL(url).pathname;
      if (options.method === 'POST') { posts.push({ pathname, body: options.body }); restored = true; return { ok: true, status: 200 }; }
      if (pathname === '/v13/deployments/retro-safe-team.vercel.app') return { ok: true, json: async () => ({ id: 'dpl_safe', projectId, meta: { automationReleaseSha: sha } }) };
      if (pathname === '/v9/projects/test-project') return { ok: true, json: async () => ({ targets: { production: { id: restored ? 'dpl_safe' : 'dpl_new' } } }) };
      throw new Error('Unexpected non-project API request');
    };
    projectId = 'another-project';
    await assert.rejects(import(`./deployment.mjs?case=rollback-project-${Date.now()}`), /does not match/);
    projectId = 'test-project'; process.env.PREVIOUS_SHA = 'b'.repeat(40);
    await assert.rejects(import(`./deployment.mjs?case=rollback-sha-${Date.now()}`), /does not match/);
    assert.deepEqual(posts, []);
    process.env.PREVIOUS_SHA = sha;
    await import(`./deployment.mjs?case=rollback-valid-${Date.now()}`);
    assert.deepEqual(posts, [{ pathname: '/v9/projects/test-project/rollback/dpl_safe', body: '{}' }]);
    await import(`./deployment.mjs?case=rollback-again-${Date.now()}`);
    assert.equal(posts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv); process.argv = originalArgv;
  }
});

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
      const data = String(url).includes('/v9/projects/') ? { id: 'test-project', name: 'retro', targets: { production: { id: 'safe-deployment', url: new URL(previous).hostname, alias: ['retro-git-main-team.vercel.app'] } } }
        : String(url).includes('/v4/aliases/') ? { alias: 'retro-blush.vercel.app', projectId: 'test-project', deploymentId: 'safe-deployment' }
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
