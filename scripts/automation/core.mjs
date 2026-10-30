import { createHash } from 'node:crypto';

export function jstDate(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function slot(now = new Date()) {
  const date = jstDate(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const scheduled = [21, 13, 5].find(h => hour >= h);
  if (scheduled !== undefined) return `${date}-${scheduled}`;
  const yesterday = jstDate(new Date(now.getTime() - 86400000));
  return `${yesterday}-21`;
}
export function mutationDue(lastDate, now = new Date()) {
  return !lastDate || (Date.parse(jstDate(now)) - Date.parse(lastDate)) / 86400000 >= 3;
}
export function policyHash(policy, stage = 'release') {
  // Product copy and scheduling do not change a provider's billing settings.
  const fields = ['repository', 'owner', 'monthlyLimitYen', 'operatingLimitYen', 'allowPaidUsage', 'githubAuth', 'requireDedicatedWindowsUser', 'services', 'protectedPaths'];
  if (policy.editableVerificationPaths !== undefined) fields.push('editableVerificationPaths');
  return createHash('sha256').update(JSON.stringify({ stage, ...Object.fromEntries(fields.map(key => [key, policy[key]])) })).digest('hex');
}
export function auditProblems(policy, audit, now = new Date(), stage = 'release') {
  if (!['development', 'release'].includes(stage)) throw new Error('Unknown audit stage');
  const errors = [];
  if (policy.monthlyLimitYen !== 1000 || policy.operatingLimitYen > 800 || policy.allowPaidUsage) {
    errors.push('Paid usage is disabled until a separately reviewed hard-stop adapter is installed.');
  }
  if ((audit.policyHashes?.[stage] ?? audit.policyHash) !== policyHash(policy, stage)) errors.push(`${stage}: cost/security policy has not been audited.`);
  const services = stage === 'development' ? ['codex', 'claude', 'github'] : policy.services;
  for (const name of services) {
    const s = audit.services?.[name];
    if (!s || !['included-hard-stop', 'free-hard-stop', 'disabled'].includes(s.mode)) {
      errors.push(`${name}: billing audit is unverified`); continue;
    }
    // These services have no call path from the mock-only automation. A disabled
    // declaration needs evidence, but cannot accrue usage or expire with time.
    if (s.mode === 'disabled' && ['gemini', 'resend', 'devlake'].includes(name)) {
      if (!s.evidence?.trim()) errors.push(`${name}: disabled-service evidence is missing`);
      continue;
    }
    const age = now.getTime() - Date.parse(s.verifiedAt);
    if (!Number.isFinite(age) || age < 0 || !s.evidence?.trim()) {
      errors.push(`${name}: billing evidence or verification timestamp is missing or invalid`);
    }
    if (['codex', 'claude', 'github', 'vercel', 'neon'].includes(name) && s.mode === 'disabled') {
      errors.push(`${name}: required service is disabled`);
    }
  }
  if (audit.autoRechargeDisabled !== true) errors.push('Automatic recharge / additional usage has not been verified disabled.');
  if (policy.requireDedicatedWindowsUser !== false && audit.dedicatedWindowsUser !== true) errors.push('A dedicated Windows user with a separate credential store is required.');
  if (policy.githubAuth !== 'app' && audit.botHasNoVariableWrite !== true) errors.push('GitHub bot must not have Actions variable write permissions.');
  // Publishing a candidate branch can trigger Vercel Git integration too.
  if (audit.vercelGitDeploymentsDisabled !== true) errors.push('Duplicate Vercel Git deployments have not been disabled.');
  if (stage === 'release') {
    if (audit.vercelAutomationTokenVerified !== true) errors.push('Vercel production workflow authentication has not been verified. Development may continue; merging and deployment are deferred.');
    if (audit.productionLiveCallsDisabled !== true) errors.push('Production external-call gates have not been verified.');
    if (audit.rollbackLiveCallsDisabled !== true) errors.push('Rollback deployments must also have live API/email access disabled.');
  }
  return errors;
}
export function approvalMatches(comments, owner, id, sha) {
  const command = `/approve-mutation ${id} ${sha}`;
  return comments.some(c => c.user?.login === owner && c.body?.trim() === command);
}
export function changedPathsBlocked(paths, policy) {
  return paths.filter(original => {
    const p = original.toLowerCase();
    if (original === 'scripts/automation/verify-live-chat-ui.mjs' && policy.editableVerificationPaths?.includes(original)) return false;
    return !/^(src\/|public\/|e2e\/|docs\/|readme\.md$)/.test(p) || /(?:^|\/)(?:actions|route|middleware|proxy|instrumentation)\.[cm]?[jt]sx?$/.test(p) || ['src/lib/prisma.ts', 'e2e/helpers.ts', 'docs/autonomous_improvement.md'].includes(p) || policy.protectedPaths.some(prefix => p.startsWith(prefix.toLowerCase()));
  });
}
export function requireReview(review, sha) {
  if (review.sha !== sha || review.verdict !== 'approve' || !review.reason?.trim()) throw new Error('Claude did not approve this exact commit.');
}
export function needsLiveAiVerification(paths) {
  return paths.some(p => p.startsWith('src/app/teams/[teamId]/retros/[retroId]/') || p.startsWith('src/components/') || p.startsWith('src/hooks/') || p.startsWith('src/lib/') || p === 'src/app/globals.css' || p === 'src/app/api/chat/route.ts' || /^scripts\/automation\/(?:probe-codex-ai|verify-live-chat-ui|live-ui-)/.test(p));
}
// Reserve the worst-case cost BEFORE a call; unknown costs never become free.
export function reserve(ledger, id, maxYen, policy) {
  if (!Number.isSafeInteger(maxYen) || maxYen < 0) throw new Error('Unknown maximum cost');
  if (maxYen && !policy.allowPaidUsage) throw new Error('Paid usage disabled');
  if (ledger.entries.some(e => e.id === id)) throw new Error('Duplicate reservation');
  const total = ledger.entries.reduce((n, e) => n + Math.max(e.reservedYen, e.actualYen ?? 0), 0);
  if (total + maxYen > policy.operatingLimitYen) throw new Error('Monthly operating budget exhausted');
  ledger.entries.push({ id, reservedYen: maxYen, actualYen: null });
  return ledger;
}
