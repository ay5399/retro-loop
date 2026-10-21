// Owner-invoked, one-time safe baseline. Builds on Vercel, never on the host.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const home = process.env.RETRO_AUTOMATION_HOME;
if (!home) throw new Error('Set RETRO_AUTOMATION_HOME');
const root = process.cwd();
const vc = path.join(process.env.APPDATA, 'npm/node_modules/vercel/dist/vc.js');
const health = JSON.parse(await readFile(path.join(home, 'production-health.json'), 'utf8'));
const run = (file, args) => {
  try { return execFileSync(file, args, { cwd: root, encoding: 'utf8', maxBuffer: 10_000_000, timeout: 900_000, windowsHide: true }); }
  catch (error) { throw new Error(`Command failed (${path.basename(file)}): ${String(error.stderr ?? '').replaceAll(health.token, '[redacted]').slice(-3000)}`); }
};
const vercel = args => run(process.execPath, [vc, args[0], '--scope', 'yasu5399', ...args.slice(1)]);
if (run('git', ['status', '--porcelain']).trim()) throw new Error('Bootstrap requires a clean reviewed commit');
const sha = run('git', ['rev-parse', 'HEAD']).trim();
if (run('gh', ['api', 'repos/ay5399/retro-loop/commits/main', '--jq', '.sha']).trim() !== sha) throw new Error('Bootstrap commit must be current main');
const ci = JSON.parse(run('gh', ['run', 'list', '--repo', 'ay5399/retro-loop', '--workflow', 'ci.yml', '--event', 'push', '--commit', sha, '--json', 'conclusion']));
if (!ci.some(r => r.conclusion === 'success')) throw new Error('Exact-SHA main CI must pass first');
vercel(['project', 'inspect', 'retro', '--non-interactive']);
const project = JSON.parse(vercel(['api', '/v9/projects/retro']));
const alias = project.targets?.production?.alias?.find(a => /^[a-zA-Z0-9.-]+\.vercel\.app$/.test(a));
if (!alias) throw new Error('No existing production alias available');
const env = { ALLOW_LIVE_LLM: 'false', ALLOW_LIVE_EMAIL: 'false', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', AUTH_RESEND_KEY: '', GOOGLE_GENERATIVE_AI_API_KEY: '', HEALTHCHECK_TOKEN: health.token, AUTOMATION_RELEASE_SHA: sha };
const args = ['deploy', '.', '--prod', '--skip-domain', '--project', 'retro', '--yes', '--meta', `automationReleaseSha=${sha}`];
for (const [key, value] of Object.entries(env)) args.push('--env', `${key}=${value}`);
for (const [key, value] of Object.entries({ DATABASE_URL: 'postgresql://build:build@127.0.0.1:5432/build', DIRECT_URL: 'postgresql://build:build@127.0.0.1:5432/build', AUTH_SECRET: 'build-only-secret', AUTH_URL: 'http://localhost:3000', ALLOW_LIVE_LLM: 'false', ALLOW_LIVE_EMAIL: 'false', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', AUTH_RESEND_KEY: '', GOOGLE_GENERATIVE_AI_API_KEY: '' })) args.push('--build-env', `${key}=${value}`);
const output = vercel(args);
const url = output.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/)?.[0];
if (!url) throw new Error('Deployment URL missing');
const check = JSON.parse(vercel(['curl', `${url}/api/health`, '--', '--silent', '--show-error', '--fail', '--header', `Authorization: Bearer ${health.token}`]));
if (check.sha !== sha || check.liveLlm !== false || check.liveEmail !== false || check.keysPresent !== false) throw new Error('Candidate runtime is not safe; not promoted');
vercel(['promote', url, '--yes']);
const publicResponse = await fetch(`https://${alias}/api/health`, { headers: { Authorization: `Bearer ${health.token}` } });
const publicHealth = await publicResponse.json();
if (!publicResponse.ok || JSON.stringify(publicHealth) !== JSON.stringify(check)) throw new Error('Public alias verification failed');
const result = { sha, url, publicUrl: `https://${alias}`, publicHealth, verifiedAt: new Date().toISOString() };
await writeFile(path.join(home, 'safe-production-baseline.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
