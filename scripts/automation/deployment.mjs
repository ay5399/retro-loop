// Runs inside GitHub Actions. No keys or environment values are logged.
import { appendFile, readFile } from 'node:fs/promises';
const action = process.argv[2];
const token = process.env.VERCEL_TOKEN;
const project = process.env.VERCEL_PROJECT_ID;
const team = process.env.VERCEL_ORG_ID;
async function vercel(endpoint, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.vercel.com${endpoint}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Vercel API failed: ${response.status}`);
  if (response.status === 204 || method === 'POST') return {};
  return response.json();
}
async function rollbackPrevious() {
  const previous = process.env.PREVIOUS, sha = process.env.PREVIOUS_SHA;
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app$/.test(previous ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Invalid rollback target or SHA');
  const deployment = await vercel(`/v13/deployments/${encodeURIComponent(new URL(previous).hostname)}?teamId=${encodeURIComponent(team)}`);
  if (deployment.projectId !== project || deployment.meta?.automationReleaseSha !== sha || !/^dpl_[a-zA-Z0-9]+$/.test(deployment.id ?? '')) throw new Error('Rollback target does not match the project and verified SHA');
  const before = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  if (before.targets?.production?.id === deployment.id) { console.log('Previous production target is already restored'); return; }
  await vercel(`/v10/projects/${encodeURIComponent(project)}/promote/${encodeURIComponent(deployment.id)}?teamId=${encodeURIComponent(team)}`, { method: 'POST', body: {} });
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
    if (current.targets?.production?.id === deployment.id) { console.log('Previous production target restored through the project API'); return; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Rollback target did not become production within 60 seconds');
}
async function verifySafeRuntime(url, expectedSha) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const healthResponse = await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${process.env.HEALTHCHECK_TOKEN}`, 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      if (health.liveLlm !== false || health.liveEmail !== false || health.keysPresent !== false) throw new Error('Runtime SHA or external-call gates do not match the release policy');
      if (/^[a-f0-9]{40}$/.test(health.sha ?? '') && (!expectedSha || health.sha === expectedSha)) return;
    } else if (![404, 503].includes(healthResponse.status)) throw new Error('Runtime health check failed');
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Runtime SHA or external-call gates do not match the release policy');
}
async function productionUrl(project) {
  const alias = process.env.AUTOMATION_PRODUCTION_ALIAS;
  if (!/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(alias ?? '')) throw new Error('Configured production alias unavailable');
  for (let attempt = 0; attempt < 15; attempt++) {
    const binding = await vercel(`/v4/aliases/${encodeURIComponent(alias)}?projectId=${encodeURIComponent(project.id)}&teamId=${encodeURIComponent(team)}`);
    if (binding.alias === alias && binding.projectId === project.id && binding.deploymentId === project.targets?.production?.id) return `https://${alias}`;
    if (attempt < 14) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Configured production alias unavailable or points to a different deployment');
}
if (action === 'previous') {
  const data = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  const previous = data.targets?.production?.url;
  if (!previous || !/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(previous)) throw new Error('No previous production deployment available for rollback');
  const rollback = await vercel(`/v13/deployments/${encodeURIComponent(previous)}?teamId=${encodeURIComponent(team)}`);
  const previousSha = rollback.meta?.automationReleaseSha;
  if (!/^[a-f0-9]{40}$/.test(previousSha ?? '')) throw new Error('Rollback deployment has no verified release SHA metadata');
  await verifySafeRuntime(await productionUrl(data), previousSha);
  await appendFile(process.env.GITHUB_OUTPUT, `previous=https://${previous}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, `previous_sha=${previousSha}\n`);
} else if (action === 'promote') {
  const deployed = (await readFile('.deployment-url', 'utf8')).trim();
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app$/.test(deployed) || !/^[a-f0-9]{40}$/.test(process.env.TARGET_SHA ?? '')) throw new Error('Invalid promotion target or SHA');
  const data = await vercel(`/v13/deployments/${encodeURIComponent(new URL(deployed).hostname)}?teamId=${encodeURIComponent(team)}`);
  if (data.projectId !== project || data.meta?.automationReleaseSha !== process.env.TARGET_SHA || data.readyState !== 'READY' || data.target !== 'production' || !/^dpl_[a-zA-Z0-9]+$/.test(data.id ?? '')) throw new Error('Promotion target does not match the ready production release');
  const before = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  if (before.targets?.production?.id === data.id) console.log('Release is already the production target');
  else await vercel(`/v10/projects/${encodeURIComponent(project)}/promote/${encodeURIComponent(data.id)}?teamId=${encodeURIComponent(team)}`, { method: 'POST', body: {} });
  const until = Date.now() + 60_000;
  while (true) {
    const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
    if (current.targets?.production?.id === data.id) break;
    if (Date.now() >= until) throw new Error('Promotion did not become production within 60 seconds');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
} else if (action === 'verify') {
  const deployed = (await readFile('.deployment-url', 'utf8')).trim();
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app$/.test(deployed)) throw new Error('Invalid deployment URL');
  const data = await vercel(`/v13/deployments/${encodeURIComponent(new URL(deployed).hostname)}?teamId=${encodeURIComponent(team)}`);
  if (data.readyState !== 'READY') throw new Error('Deployment is not READY');
  const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  if (current.targets?.production?.id !== data.id) throw new Error('Deployment is not the current production target');
  const url = await productionUrl(current);
  await verifySafeRuntime(url, process.env.TARGET_SHA);
  for (const pathname of ['/', '/signin']) {
    const response = await fetch(new URL(pathname, url), { signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok || !text.includes('<html') || !/RetroLoop|ログイン/.test(text)) throw new Error(`Production smoke failed: ${pathname} (${response.status})`);
  }
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `Production smoke passed: ${url}\nCommit: ${process.env.TARGET_SHA}\n`);
} else if (action === 'rollback') {
  await rollbackPrevious();
} else if (action === 'check-rollback') {
  const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  await appendFile(process.env.GITHUB_OUTPUT, `restored=${`https://${current.targets?.production?.url}` === process.env.PREVIOUS}\n`);
} else if (action === 'verify-rollback') {
  const current = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  if (`https://${current.targets?.production?.url}` !== process.env.PREVIOUS) throw new Error('Previous production target was not restored');
  const deployment = await vercel(`/v13/deployments/${encodeURIComponent(new URL(process.env.PREVIOUS).hostname)}?teamId=${encodeURIComponent(team)}`);
  const sha = deployment.meta?.automationReleaseSha;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || (process.env.PREVIOUS_SHA && process.env.PREVIOUS_SHA !== sha)) throw new Error('Rollback release SHA metadata mismatch');
  const url = await productionUrl(current);
  await verifySafeRuntime(url, sha);
  for (const pathname of ['/', '/signin']) {
    const response = await fetch(new URL(pathname, url), { signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok || !/RetroLoop|ログイン/.test(text)) throw new Error('Rollback smoke failed');
  }
  console.log('Previous production target and public routes verified');
} else throw new Error('Unknown deployment action');
