import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { appPermissions, validateInstallation, createAppAuth } from './github-app.mjs';

const config = { appId: 123, installationId: 456 };
const installation = { app_id: 123, account: { login: 'ay5399' }, repository_selection: 'selected', permissions: appPermissions };
test('App accepts only minimal permissions and the configured installation', () => {
  validateInstallation(installation, config, 'ay5399/retro-loop');
  for (const changed of [{ permissions: { ...appPermissions, variables: 'write' } }, { permissions: { ...appPermissions, secrets: 'write' } }, { permissions: { ...appPermissions, workflows: 'write' } }, { permissions: { ...appPermissions, administration: 'write' } }, { app_id: 999 }, { repository_selection: 'all' }, { suspended_at: 'today' }, { permissions: { ...appPermissions, members: 'write' } }, { permissions: { ...appPermissions, organization_administration: 'write' } }, { permissions: { ...appPermissions, emails: 'read' } }, { permissions: { ...appPermissions, contents: 'read' } }, { account: { login: 'other' } }]) {
    assert.throws(() => validateInstallation({ ...installation, ...changed }, config, 'ay5399/retro-loop'));
  }
});
test('App tokens are signed, repository scoped, cached and refreshed before expiry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-app-test-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPath = path.join(dir, 'key.pem');
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    let now = Date.parse('2026-10-21T00:00:00Z'), issued = 0;
    const request = async (url, options) => {
      let value;
      if (url.endsWith('/app/installations/456')) {
        const jwt = options.headers.Authorization.slice(7).split('.');
        assert.ok(createVerify('RSA-SHA256').update(jwt.slice(0, 2).join('.')).verify(publicKey, jwt[2], 'base64url'));
        value = installation;
      } else if (url.endsWith('/access_tokens')) {
        assert.deepEqual(JSON.parse(options.body), { repositories: ['retro-loop'], permissions: appPermissions });
        value = { token: `test-token-${++issued}`, expires_at: new Date(now + 3_600_000).toISOString() };
      } else {
        assert.equal(url, 'https://api.github.com/installation/repositories?per_page=100');
        value = { total_count: 1, repositories: [{ full_name: 'ay5399/retro-loop' }] };
      }
      return { ok: true, json: async () => value };
    };
    const token = createAppAuth({ ...config, privateKeyPath }, 'ay5399/retro-loop', { request, clock: () => now });
    assert.equal(await token(), 'test-token-1');
    assert.equal(await token(), 'test-token-1');
    now += 1_800_000;
    assert.equal(await token({ minValidityMs: 2_460_000 }), 'test-token-2');
    now += 3_400_000;
    assert.equal(await token(), 'test-token-3');
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
test('missing App config fails without any request or owner credential fallback', async () => {
  const token = createAppAuth({}, 'ay5399/retro-loop', { request: async () => { assert.fail('No network request expected'); } });
  await assert.rejects(token(), /Configure GitHub App/);
});
