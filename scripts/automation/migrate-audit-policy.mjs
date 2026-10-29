import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { policyHash } from './core.mjs';

// This is a one-time format migration, never an alternative acceptance path in
// auditProblems. Recompute the old hash from CURRENT settings, not stored claims.
function previousPolicyHash(policy, stage) {
  const fields = ['repository', 'owner', 'monthlyLimitYen', 'operatingLimitYen', 'allowPaidUsage', 'githubAuth', 'requireDedicatedWindowsUser', 'auditMaxAgeDays', 'services', 'protectedPaths'];
  const previous = { ...policy, auditMaxAgeDays: 7 };
  return createHash('sha256').update(JSON.stringify({ stage, ...Object.fromEntries(fields.map(key => [key, previous[key]])) })).digest('hex');
}

export function migrateAuditPolicyHashes(policy, audit) {
  if (policy.auditMaxAgeDays !== undefined && policy.auditMaxAgeDays !== 7) throw new Error('Only the verified seven-day policy format can be migrated');
  const migrated = structuredClone(audit);
  let hashes = 0;
  const migrate = (stored, stage) => {
    hashes++;
    const current = policyHash(policy, stage);
    if (stored !== current && stored !== previousPolicyHash(policy, stage)) throw new Error(`${stage}: policy settings differ from the previously audited policy; fresh evidence is required`);
    return current;
  };
  if (Object.hasOwn(audit, 'policyHash')) migrated.policyHash = migrate(audit.policyHash, 'release');
  for (const [stage, hash] of Object.entries(audit.policyHashes ?? {})) {
    if (!['development', 'release'].includes(stage)) throw new Error('Unknown stored audit stage');
    migrated.policyHashes[stage] = migrate(hash, stage);
  }
  if (!hashes) throw new Error('No previously verified policy hash to migrate');
  return migrated;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--policy' || args[2] !== '--audit' || args[4] !== '--output') throw new Error('Usage: node migrate-audit-policy.mjs --policy POLICY --audit AUDIT --output NEW_AUDIT');
  if (path.resolve(args[3]) === path.resolve(args[5])) throw new Error('Output must differ from the original audit; preserve the original evidence file');
  const policy = JSON.parse(await readFile(args[1], 'utf8'));
  const audit = JSON.parse(await readFile(args[3], 'utf8'));
  const migrated = migrateAuditPolicyHashes(policy, audit);
  await writeFile(args[5], `${JSON.stringify(migrated, null, 2)}\n`, { flag: 'wx' });
  console.log('Policy hashes migrated. Original evidence and verification timestamps preserved.');
}
