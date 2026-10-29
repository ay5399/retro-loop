import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { policyHash, auditProblems } from './core.mjs';
import { migrateAuditPolicyHashes } from './migrate-audit-policy.mjs';

const policy = JSON.parse(await readFile(new URL('../../automation/policy.json', import.meta.url), 'utf8'));
function originalHash(policy, stage) {
  const fields = ['repository', 'owner', 'monthlyLimitYen', 'operatingLimitYen', 'allowPaidUsage', 'githubAuth', 'requireDedicatedWindowsUser', 'auditMaxAgeDays', 'services', 'protectedPaths'];
  const original = { ...policy, auditMaxAgeDays: 7 };
  return createHash('sha256').update(JSON.stringify({ stage, ...Object.fromEntries(fields.map(key => [key, original[key]])) })).digest('hex');
}
function originalAudit() {
  return {
    policyHash: originalHash(policy, 'release'),
    policyHashes: Object.fromEntries(['development', 'release'].map(stage => [stage, originalHash(policy, stage)])),
    autoRechargeDisabled: true, botHasNoVariableWrite: true, dedicatedWindowsUser: true,
    vercelGitDeploymentsDisabled: true, vercelAutomationTokenVerified: true,
    productionLiveCallsDisabled: true, rollbackLiveCallsDisabled: true,
    services: Object.fromEntries(policy.services.map(name => [name, { mode: 'free-hard-stop', verifiedAt: '2026-10-01T00:00:00Z', evidence: `Original ${name} evidence` }]))
  };
}

test('explicit migration preserves every original evidence field and timestamp without mutating source', () => {
  const original = originalAudit(), snapshot = structuredClone(original);
  assert.ok(auditProblems(policy, original).some(error => error.includes('policy')));
  const migrated = migrateAuditPolicyHashes(policy, original);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(migrated.services, original.services);
  assert.equal(migrated.policyHash, policyHash(policy));
  for (const stage of ['development', 'release']) assert.equal(migrated.policyHashes[stage], policyHash(policy, stage));
  const { policyHash: ignoredHash, policyHashes: ignoredHashes, ...retained } = migrated;
  const { policyHash: originalHashValue, policyHashes: originalHashes, ...evidence } = original;
  assert.deepEqual(retained, evidence);
  assert.deepEqual(auditProblems(policy, migrated, new Date('2036-01-01T00:00:00Z')), []);
  assert.deepEqual(migrateAuditPolicyHashes(policy, migrated), migrated);
});

test('migration cannot bless changed cost, identity, service, authentication, or protected-path settings', () => {
  for (const change of [
    { operatingLimitYen: 700 }, { monthlyLimitYen: 1100 }, { allowPaidUsage: true },
    { repository: 'other/repo' }, { owner: 'other' }, { githubAuth: 'legacy' },
    { requireDedicatedWindowsUser: true }, { services: ['codex'] }, { protectedPaths: [] }
  ]) assert.throws(() => migrateAuditPolicyHashes({ ...policy, ...change }, originalAudit()), /fresh evidence/);
  assert.throws(() => migrateAuditPolicyHashes(policy, {}), /No previously verified/);
  assert.throws(() => migrateAuditPolicyHashes(policy, { policyHash: 'forged' }), /fresh evidence/);
  assert.throws(() => migrateAuditPolicyHashes({ ...policy, auditMaxAgeDays: 30 }, originalAudit()), /seven-day/);
});

test('explicit stage hashes shadow stale legacy metadata without accepting changed effective policy', () => {
  const original = { ...originalAudit(), policyHash: 'obsolete unused fallback' };
  const migrated = migrateAuditPolicyHashes(policy, original);
  assert.equal(migrated.policyHash, policyHash(policy, 'release'));
  assert.deepEqual(migrated.services, original.services);
  assert.deepEqual(auditProblems(policy, migrated), []);
  assert.throws(() => migrateAuditPolicyHashes({ ...policy, operatingLimitYen: 700 }, original), /fresh evidence/);
  delete original.policyHashes.release;
  assert.throws(() => migrateAuditPolicyHashes(policy, original), /fresh evidence/);
  const forged = { ...originalAudit(), policyHashes: { release: 'forged' } };
  assert.throws(() => migrateAuditPolicyHashes(policy, forged), /fresh evidence/);
});

test('new audit stays sensitive to actual settings while scheduling/product text do not invalidate it', () => {
  const migrated = migrateAuditPolicyHashes(policy, originalAudit());
  assert.deepEqual(auditProblems({ ...policy, hours: [6], productDirection: { purpose: 'reworded' } }, migrated), []);
  assert.ok(auditProblems({ ...policy, operatingLimitYen: 700 }, migrated).some(error => error.includes('policy')));
});
