import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slot, mutationDue, approvalMatches, requireReview, reserve, auditProblems, policyHash, changedPathsBlocked, needsLiveAiVerification } from './core.mjs';
const policy = JSON.parse(readFileSync(new URL('../../automation/policy.json', import.meta.url)));
test('AI experience and shared UI edits require live verification; docs use mock CI', () => {
  assert.equal(needsLiveAiVerification(['src/app/teams/[teamId]/retros/[retroId]/ai-chat.tsx']), true);
  assert.equal(needsLiveAiVerification(['src/app/api/chat/route.ts']), true);
  assert.equal(needsLiveAiVerification(['src/components/loop.tsx']), true);
  assert.equal(needsLiveAiVerification(['src/app/teams/[teamId]/retros/[retroId]/kpt-board.client.tsx']), true);
  assert.equal(needsLiveAiVerification(['docs/BRIEF.md']), false);
});
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
test('missing billing evidence and changed settings stop execution; elapsed time alone never expires evidence', () => {
  assert.ok(auditProblems(policy, {}).length);
  const now = new Date('2026-10-19T04:00:00Z');
  const audit = { policyHash: policyHash(policy), autoRechargeDisabled: true, dedicatedWindowsUser: true, botHasNoVariableWrite: true, productionLiveCallsDisabled: true, rollbackLiveCallsDisabled: true, vercelAutomationTokenVerified: true, vercelGitDeploymentsDisabled: true,
    services: Object.fromEntries(policy.services.map(s => [s, { mode: 'free-hard-stop', verifiedAt: now.toISOString(), evidence: 'provider settings checked' }])) };
  assert.deepEqual(auditProblems(policy, audit, now), []);
  audit.vercelAutomationTokenVerified = false;
  assert.ok(auditProblems(policy, audit, now).some(p => p.includes('workflow authentication')));
  assert.equal(auditProblems(policy, audit, now, 'development').some(p => p.includes('workflow authentication')), false);
  audit.vercelAutomationTokenVerified = true;
  assert.deepEqual(auditProblems(policy, audit, new Date('2036-11-01T00:00:00Z')), []);
  assert.deepEqual(auditProblems({ ...policy, hours: [6], productDirection: { purpose: 'updated' } }, audit, now), []);
  assert.ok(auditProblems({ ...policy, operatingLimitYen: 700 }, audit, now).length);
  for (const verifiedAt of [undefined, 'invalid', '2036-01-01T00:00:00Z']) {
    const invalid = structuredClone(audit);
    invalid.services.codex.verifiedAt = verifiedAt;
    assert.ok(auditProblems(policy, invalid, now).some(problem => problem.includes('timestamp')));
  }
});
test('development can proceed without production audit; disabled services do not expire', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const audit = { policyHashes: { development: policyHash(policy, 'development') }, autoRechargeDisabled: true, dedicatedWindowsUser: true, botHasNoVariableWrite: true, vercelGitDeploymentsDisabled: true,
    services: Object.fromEntries(['codex', 'claude', 'github'].map(s => [s, { mode: 'included-hard-stop', verifiedAt: now.toISOString(), evidence: 'checked' }])) };
  assert.deepEqual(auditProblems(policy, audit, now, 'development'), []);
  assert.ok(auditProblems(policy, audit, now).length);
  audit.vercelGitDeploymentsDisabled = false;
  assert.ok(auditProblems(policy, audit, now, 'development').some(p => p.includes('Vercel')));
  audit.vercelGitDeploymentsDisabled = true;
  audit.policyHashes.release = policyHash(policy);
  Object.assign(audit, { productionLiveCallsDisabled: true, rollbackLiveCallsDisabled: true, vercelAutomationTokenVerified: true });
  for (const s of ['vercel', 'neon']) audit.services[s] = { mode: 'free-hard-stop', verifiedAt: now.toISOString(), evidence: 'checked' };
  for (const s of ['gemini', 'resend', 'devlake']) audit.services[s] = { mode: 'disabled', evidence: 'No call path in this automation' };
  assert.deepEqual(auditProblems(policy, audit, now), []);
  audit.services.codex.mode = 'disabled';
  assert.ok(auditProblems(policy, audit, now, 'development').some(p => p.includes('required service')));
});
test('owner can waive Windows-user isolation without waiving bot or billing checks', () => {
  const audit = {};
  const errors = auditProblems(policy, audit);
  assert.ok(!errors.some(p => p.includes('Windows user')));
  assert.ok(auditProblems({ ...policy, githubAuth: 'legacy' }, audit).some(p => p.includes('GitHub bot')));
  assert.ok(errors.some(p => p.includes('billing audit')));
  assert.ok(auditProblems({ ...policy, requireDedicatedWindowsUser: true }, audit).some(p => p.includes('Windows user')));
  assert.notEqual(policyHash(policy), policyHash({ ...policy, requireDedicatedWindowsUser: true }));
});
test('autonomous edits cannot change policy, authentication, migrations or workflows', () => {
  assert.deepEqual(changedPathsBlocked(['src/components/loop.tsx', 'docs/UI_GUIDELINES.md'], policy), []);
  assert.equal(changedPathsBlocked(['automation/policy.json', 'src/auth.ts', '.github/workflows/ci.yml', 'prisma/schema.prisma', 'package.json'], policy).length, 5);
  assert.equal(changedPathsBlocked(['CLAUDE.md', 'src/instrumentation.ts', 'src/lib/prisma.ts', 'e2e/helpers.ts', 'docs/AUTONOMOUS_IMPROVEMENT.md'], policy).length, 5);
  assert.equal(changedPathsBlocked(['lib/external.ts'], policy).length, 1);
});
