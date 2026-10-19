import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slot, mutationDue, approvalMatches, requireReview, reserve, auditProblems, policyHash, changedPathsBlocked } from './core.mjs';
const policy = JSON.parse(readFileSync(new URL('../../automation/policy.json', import.meta.url)));
test('JST slots and latest missed slot across midnight', () => {
  assert.equal(slot(new Date('2026-10-19T20:00:00Z')), '2026-10-20-5');
  assert.equal(slot(new Date('2026-10-19T04:00:00Z')), '2026-10-19-13');
  assert.equal(slot(new Date('2026-10-19T12:00:00Z')), '2026-10-19-21');
  assert.equal(slot(new Date('2026-10-19T18:00:00Z')), '2026-10-19-21');
});
test('mutation uses three calendar days, not three runs', () => {
  assert.equal(mutationDue('2026-10-17', new Date('2026-10-19T04:00:00Z')), false);
  assert.equal(mutationDue('2026-10-16', new Date('2026-10-19T04:00:00Z')), true);
});
test('only owner approval for exact proposal and SHA is accepted', () => {
  const sha = 'a'.repeat(40), body = `/approve-mutation exp-1 ${sha}`;
  assert.equal(approvalMatches([{ user: { login: 'bot' }, body }], 'ay5399', 'exp-1', sha), false);
  assert.equal(approvalMatches([{ user: { login: 'ay5399' }, body }], 'ay5399', 'exp-1', 'b'.repeat(40)), false);
  assert.equal(approvalMatches([{ user: { login: 'ay5399' }, body }], 'ay5399', 'exp-1', sha), true);
});
test('stale, refused or empty reviews fail closed', () => {
  for (const review of [{ sha: 'old', verdict: 'approve', reason: 'yes' }, { sha: 'new', verdict: 'reject', reason: 'no' }, { sha: 'new', verdict: 'approve', reason: '' }]) {
    assert.throws(() => requireReview(review, 'new'));
  }
});
test('unknown costs, paid usage, duplicates and accumulated reservations stop execution', () => {
  assert.throws(() => reserve({ entries: [] }, 'x', NaN, policy));
  assert.throws(() => reserve({ entries: [] }, 'x', 1, policy));
  assert.throws(() => reserve({ entries: [{ id: 'x', reservedYen: 0 }] }, 'x', 0, policy));
  assert.throws(() => reserve({ entries: [{ id: 'x', reservedYen: 801 }] }, 'y', 0, policy));
});
test('unverified/expired billing and changed policy stop execution', () => {
  assert.ok(auditProblems(policy, {}).length);
  const now = new Date('2026-10-19T04:00:00Z');
  const audit = { policyHash: policyHash(policy), autoRechargeDisabled: true, productionLiveCallsDisabled: true, rollbackLiveCallsDisabled: true, vercelGitDeploymentsDisabled: true,
    services: Object.fromEntries(policy.services.map(s => [s, { mode: 'free-hard-stop', verifiedAt: now.toISOString(), evidence: 'provider settings checked' }])) };
  assert.deepEqual(auditProblems(policy, audit, now), []);
  assert.ok(auditProblems(policy, audit, new Date('2026-11-01T00:00:00Z')).length);
  assert.ok(auditProblems({ ...policy, hours: [6] }, audit, now).length);
});
test('autonomous edits cannot change policy, authentication, migrations or workflows', () => {
  assert.deepEqual(changedPathsBlocked(['src/components/loop.tsx', 'docs/UI_GUIDELINES.md'], policy), []);
  assert.equal(changedPathsBlocked(['automation/policy.json', 'src/auth.ts', '.github/workflows/ci.yml', 'prisma/schema.prisma', 'package.json'], policy).length, 5);
});
