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
if (action === 'previous') {
  const data = await vercel(`/v9/projects/${encodeURIComponent(project)}?teamId=${encodeURIComponent(team)}`);
  const previous = data.targets?.production?.url;
  if (!previous || !/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(previous)) throw new Error('No previous production deployment available for rollback');
  await appendFile(process.env.GITHUB_OUTPUT, `previous=https://${previous}\n`);
} else if (action === 'verify') {
  const deployed = (await readFile('.deployment-url', 'utf8')).trim();
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app$/.test(deployed)) throw new Error('Invalid deployment URL');
  const data = await vercel(`/v13/deployments/${encodeURIComponent(new URL(deployed).hostname)}?teamId=${encodeURIComponent(team)}`);
  const alias = data.alias?.[0];
  if (!alias || !/^[a-zA-Z0-9.-]+$/.test(alias)) throw new Error('Production alias unavailable');
  const url = `https://${alias}`;
  for (const pathname of ['/', '/signin']) {
    const response = await fetch(new URL(pathname, url), { signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok || !text.includes('<html') || !/RetroLoop|ログイン/.test(text)) throw new Error(`Production smoke failed: ${pathname} (${response.status})`);
  }
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `Production smoke passed: ${url}\nCommit: ${process.env.TARGET_SHA}\n`);
} else throw new Error('Unknown deployment action');
