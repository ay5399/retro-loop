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
export function policyHash(policy) {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}
export function auditProblems(policy, audit, now = new Date()) {
  const errors = [];
  if (policy.monthlyLimitYen !== 1000 || policy.operatingLimitYen > 800 || policy.allowPaidUsage) {
    errors.push('Paid usage is disabled until a separately reviewed hard-stop adapter is installed.');
  }
  if (audit.policyHash !== policyHash(policy)) errors.push('Policy changed after the billing audit.');
  for (const name of policy.services) {
    const s = audit.services?.[name];
    if (!s || !['included-hard-stop', 'free-hard-stop', 'disabled'].includes(s.mode)) {
      errors.push(`${name}: billing audit is unverified`); continue;
    }
    const age = now.getTime() - Date.parse(s.verifiedAt);
    if (!Number.isFinite(age) || age < 0 || age > policy.auditMaxAgeDays * 86400000 || !s.evidence) {
      errors.push(`${name}: billing evidence is missing or expired`);
    }
    if (['codex', 'claude', 'github', 'vercel', 'neon'].includes(name) && s.mode === 'disabled') {
      errors.push(`${name}: required service is disabled`);
    }
  }
  if (audit.autoRechargeDisabled !== true) errors.push('Automatic recharge / additional usage has not been verified disabled.');
  if (audit.dedicatedWindowsUser !== true) errors.push('A dedicated Windows user with a separate credential store is required.');
  if (audit.botHasNoVariableWrite !== true) errors.push('GitHub bot must not have Actions variable write permissions.');
  if (audit.productionLiveCallsDisabled !== true) errors.push('Production external-call gates have not been verified.');
  if (audit.rollbackLiveCallsDisabled !== true) errors.push('Rollback deployments must also have live API/email access disabled.');
  if (audit.vercelGitDeploymentsDisabled !== true) errors.push('Duplicate Vercel Git deployments have not been disabled.');
  return errors;
}
export function approvalMatches(comments, owner, id, sha) {
  const command = `/approve-mutation ${id} ${sha}`;
  return comments.some(c => c.user?.login === owner && c.body?.trim() === command);
}
export function changedPathsBlocked(paths, policy) {
  return paths.filter(p => !/^(src\/|public\/|e2e\/|docs\/|README\.md$)/.test(p) || /(?:^|\/)(?:actions|route|middleware|proxy)\.[cm]?[jt]sx?$/.test(p) || p === 'src/lib/prisma.ts' || policy.protectedPaths.some(prefix => p.startsWith(prefix)));
}
export function requireReview(review, sha) {
  if (review.sha !== sha || review.verdict !== 'approve' || !review.reason?.trim()) throw new Error('Claude did not approve this exact commit.');
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
