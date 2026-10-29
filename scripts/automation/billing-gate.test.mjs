import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyHash } from './core.mjs';
const exec = promisify(execFile);
const policy = JSON.parse(await readFile(new URL('../../automation/policy.json', import.meta.url), 'utf8'));
const workflow = (await readFile(new URL('../../.github/workflows/deploy-production.yml', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');

test('actual production workflow gates checked-out policy by owner hash before installing or using Vercel credentials', async () => {
  const start = workflow.indexOf("          node --input-type=module <<'NODE'\n");
  const end = workflow.indexOf('\n          NODE', start);
  assert.ok(start > workflow.indexOf('actions/checkout@v4') && end > start);
  assert.ok(end < workflow.indexOf('- run: npm ci') && end < workflow.indexOf('VERCEL_TOKEN:'));
  assert.doesNotMatch(workflow, /AUTOMATION_BILLING_VERIFIED_UNTIL|AUDIT_UNTIL/);
  const code = workflow.slice(workflow.indexOf('\n', start) + 1, end);
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-billing-gate-'));
  try {
    await mkdir(path.join(dir, 'automation'));
    await mkdir(path.join(dir, 'scripts/automation'), { recursive: true });
    await writeFile(path.join(dir, 'scripts/automation/core.mjs'), await readFile(new URL('./core.mjs', import.meta.url)));
    await writeFile(path.join(dir, 'automation/policy.json'), JSON.stringify(policy));
    const env = { ...process.env, BILLING_POLICY_HASH: policyHash(policy, 'release'), AUDIT_UNTIL: '2000-01-01T00:00:00Z' };
    await exec(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env });
    for (const value of ['', 'invalid', 'a'.repeat(64)]) await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env: { ...env, BILLING_POLICY_HASH: value, AUDIT_UNTIL: '9999-01-01T00:00:00Z' } }), /owner confirmation/);
    await writeFile(path.join(dir, 'automation/policy.json'), JSON.stringify({ ...policy, operatingLimitYen: 700 }));
    await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env }), /owner confirmation/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('release audit registration publishes only the verified policy hash and preserves owner evidence dates', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-billing-register-'));
  try {
    const audit = { autoRechargeDisabled: true, dedicatedWindowsUser: true, botHasNoVariableWrite: true, productionLiveCallsDisabled: true, rollbackLiveCallsDisabled: true, vercelAutomationTokenVerified: true, vercelGitDeploymentsDisabled: true,
      services: Object.fromEntries(policy.services.map(name => [name, { mode: 'free-hard-stop', verifiedAt: new Date(Date.now() - 86400000).toISOString(), evidence: 'Owner-confirmed provider setting, preserved without renewal' }])) };
    await writeFile(path.join(dir, 'policy.json'), JSON.stringify(policy));
    await writeFile(path.join(dir, 'installation.json'), JSON.stringify({ commands: { gh: { file: process.execPath } } }));
    await writeFile(path.join(dir, 'variable'), "require('node:fs').writeFileSync('published.json',JSON.stringify(process.argv.slice(2)));\n");
    await writeFile(path.join(dir, 'input.json'), JSON.stringify(audit));
    const register = fileURLToPath(new URL('./record-audit.mjs', import.meta.url));
    await exec(process.execPath, [register, path.join(dir, 'input.json')], { cwd: dir, env: { ...process.env, RETRO_AUTOMATION_HOME: dir } });
    const published = JSON.parse(await readFile(path.join(dir, 'published.json'), 'utf8'));
    assert.deepEqual(published, ['set', 'AUTOMATION_BILLING_POLICY_HASH', '--repo', policy.repository, '--body', policyHash(policy, 'release')]);
    const saved = JSON.parse(await readFile(path.join(dir, 'audit.json'), 'utf8'));
    assert.deepEqual(saved.services, audit.services);
    assert.equal(saved.policyHashes.release, policyHash(policy, 'release'));
    // The same unchanged evidence can be registered again, but registration
    // cannot turn an old or different policy hash into current authorization.
    await writeFile(path.join(dir, 'input.json'), JSON.stringify(saved));
    await exec(process.execPath, [register, path.join(dir, 'input.json')], { cwd: dir, env: { ...process.env, RETRO_AUTOMATION_HOME: dir } });
    for (const hashes of [
      { policyHash: 'b'.repeat(64) },
      { policyHashes: { release: 'b'.repeat(64) } },
      { policyHashes: { development: 'b'.repeat(64) } },
      { policyHashes: { invalid: policyHash(policy) } },
      { policyHashes: { release: policyHash({ ...policy, operatingLimitYen: 700 }) } },
    ]) {
      await rm(path.join(dir, 'published.json'));
      await writeFile(path.join(dir, 'input.json'), JSON.stringify({ ...audit, ...hashes }));
      await assert.rejects(exec(process.execPath, [register, path.join(dir, 'input.json')], { cwd: dir, env: { ...process.env, RETRO_AUTOMATION_HOME: dir } }), /Stored billing policy differs/);
      await assert.rejects(readFile(path.join(dir, 'published.json')), { code: 'ENOENT' });
      assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'audit.json'), 'utf8')), saved);
      // Restore only the test sentinel, not authorization or audit state.
      await writeFile(path.join(dir, 'published.json'), 'test sentinel');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
