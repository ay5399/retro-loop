import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { policyHash, auditProblems } from './core.mjs';
const home = process.env.RETRO_AUTOMATION_HOME;
const source = process.argv[2];
const stage = process.argv.includes('--development') ? 'development' : 'release';
if (!home || !source) throw new Error('Set RETRO_AUTOMATION_HOME and supply an owner-verified audit JSON file. See docs/AUTONOMOUS_IMPROVEMENT.md.');
const policy = JSON.parse(await readFile(path.join(home, 'policy.json'), 'utf8'));
const audit = JSON.parse(await readFile(source, 'utf8'));
// Never silently rebind existing evidence to changed settings. New owner
// verification has no saved hashes; a format-only migration is explicit.
if (Object.hasOwn(audit, 'policyHash') && audit.policyHash !== policyHash(policy, 'release')) {
  throw new Error('Stored billing policy differs. Use explicit migration or newly owner-verified evidence without saved policy hashes.');
}
for (const [savedStage, hash] of Object.entries(audit.policyHashes ?? {})) {
  if (!['development', 'release'].includes(savedStage) || hash !== policyHash(policy, savedStage)) {
    throw new Error('Stored billing policy differs. Use explicit migration or newly owner-verified evidence without saved policy hashes.');
  }
}
audit.policyHashes = { ...audit.policyHashes, [stage]: policyHash(policy, stage) };
// A full release audit also verifies all development prerequisites.
if (stage === 'release') audit.policyHashes.development = policyHash(policy, 'development');
const errors = auditProblems(policy, audit, new Date(), stage);
if (errors.length) throw new Error(errors.join('\n'));
const installation = JSON.parse(await readFile(path.join(home, 'installation.json'), 'utf8'));
if (stage === 'release') {
const publish = spawnSync(installation.commands.gh.file, ['variable', 'set', 'AUTOMATION_BILLING_POLICY_HASH', '--repo', policy.repository, '--body', audit.policyHashes.release], { windowsHide: true, encoding: 'utf8' });
if (publish.status !== 0) throw new Error(`Unable to publish owner-verified billing policy hash: ${publish.stderr}`);
}
await writeFile(path.join(home, 'audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(`${stage} audit recorded for the verified cost/security policy. Evidence and verification dates are preserved; elapsed days do not invalidate it. Development audit does not authorize production releases.`);
