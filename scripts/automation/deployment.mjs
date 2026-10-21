// Runs inside GitHub Actions. No keys or environment values are logged.
import { appendFile, readFile } from 'node:fs/promises';
const action = process.argv[2];
const token = process.env.VERCEL_TOKEN;
const project = process.env.VERCEL_PROJECT_ID;
const team = process.env.VERCEL_ORG_ID;
async function vercel(endpoint) {
  const response = await fetch(`https://api.vercel.com${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Vercel API failed: ${response.status}`);
  return response.json();
}
async function verifySafeRuntime(url, expectedSha) {
  const healthResponse = await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${process.env.HEALTHCHECK_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
  if (!healthResponse.ok) throw new Error('Runtime health check failed');
  const health = await healthResponse.json();
  if (!/^[a-f0-9]{40}$/.test(health.sha ?? '') || (expectedSha && health.sha !== expectedSha) || health.liveLlm !== false || health.liveEmail !== false || health.keysPresent !== false) throw new Error('Runtime SHA or external-call gates do not match the release policy');
}
function productionUrl(project) {
  const alias = process.env.AUTOMATION_PRODUCTION_ALIAS;
  if (!/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(alias ?? '') || !project.targets?.production?.alias?.includes(alias)) throw new Error('Configured production alias unavailable');
  return `https://${alias}`;
}
if (action === 'previous') {
  const data = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  const previous = data.targets?.production?.url;
  if (!previous || !/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(previous)) throw new Error('No previous production deployment available for rollback');
  const rollback = await vercel(`/v13/deployments/${encodeURIComponent(previous)}?teamId=${encodeURIComponent(team)}`);
  const previousSha = rollback.meta?.automationReleaseSha;
  if (!/^[a-f0-9]{40}$/.test(previousSha ?? '')) throw new Error('Rollback deployment has no verified release SHA metadata');
  await verifySafeRuntime(productionUrl(data), previousSha);
  await appendFile(process.env.GITHUB_OUTPUT, `previous=https://${previous}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, `previous_sha=${previousSha}\n`);
} else if (action === 'verify') {
  const deployed = (await readFile('.deployment-url', 'utf8')).trim();
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app$/.test(deployed)) throw new Error('Invalid deployment URL');
  const data = await vercel(`/v13/deployments/${encodeURIComponent(new URL(deployed).hostname)}?teamId=${encodeURIComponent(team)}`);
  if (data.readyState !== 'READY') throw new Error('Deployment is not READY');
  const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  if (current.targets?.production?.id !== data.id) throw new Error('Deployment is not the current production target');
  const url = productionUrl(current);
  if (!data.alias?.includes(new URL(url).hostname)) throw new Error('Production alias does not point to this deployment');
  await verifySafeRuntime(url, process.env.TARGET_SHA);
  for (const pathname of ['/', '/signin']) {
    const response = await fetch(new URL(pathname, url), { signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok || !text.includes('<html') || !/RetroLoop|ログイン/.test(text)) throw new Error(`Production smoke failed: ${pathname} (${response.status})`);
  }
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `Production smoke passed: ${url}\nCommit: ${process.env.TARGET_SHA}\n`);
} else if (action === 'check-rollback') {
  const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  await appendFile(process.env.GITHUB_OUTPUT, `restored=${`https://${current.targets?.production?.url}` === process.env.PREVIOUS}\n`);
} else if (action === 'verify-rollback') {
  const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  if (`https://${current.targets?.production?.url}` !== process.env.PREVIOUS) throw new Error('Previous production target was not restored');
  const deployment = await vercel(`/v13/deployments/${encodeURIComponent(new URL(process.env.PREVIOUS).hostname)}?teamId=${encodeURIComponent(team)}`);
  const sha = deployment.meta?.automationReleaseSha;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || (process.env.PREVIOUS_SHA && process.env.PREVIOUS_SHA !== sha)) throw new Error('Rollback release SHA metadata mismatch');
  const url = productionUrl(current);
  await verifySafeRuntime(url, sha);
  for (const pathname of ['/', '/signin']) {
    const response = await fetch(new URL(pathname, url), { signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok || !/RetroLoop|ログイン/.test(text)) throw new Error('Rollback smoke failed');
  }
  console.log('Previous production target and public routes verified');
} else throw new Error('Unknown deployment action');
