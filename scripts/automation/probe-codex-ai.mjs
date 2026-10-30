// Explicit, bounded live inference probe. No production data, database or app code.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { actionScenario } from './live-scenario.mjs';
import { providerFailure, exhaustedWindow } from './live-verification.mjs';
import { loadCandidateVerifier } from './verifier-loader.mjs';
const home = process.env.RETRO_AUTOMATION_HOME;
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Live verification requires Node.js 24 or later, matching .nvmrc');
if (!home) throw new Error('Set RETRO_AUTOMATION_HOME');
const installation = JSON.parse(await readFile(path.join(home, 'installation.json'), 'utf8'));
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const sourceRoot = path.resolve(arg('--source') ?? installation.repositoryPath);
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }).trim();
if (arg('--expected-sha') && (sha !== arg('--expected-sha') || execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }).trim())) throw new Error('Candidate must be the clean, independently reviewed SHA');
const { ACTION_GUIDANCE } = await import(pathToFileURL(path.join(sourceRoot, 'src/lib/llm/chat-guidance.ts')).href);
const dir = path.resolve(arg('--output-dir') ?? path.join(home, 'live-ai-probe'));
await mkdir(dir, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|API_KEY|DATABASE_URL|DIRECT_URL|CLAUDE_CODE_USE_|ANTHROPIC_|OPENAI_|GIT_CONFIG_/i.test(key)));
const cmd = installation.commands.codex;
const proc = spawn(cmd.file, [...cmd.args, 'app-server', '--listen', 'stdio://'], { cwd: dir, env, windowsHide: true, shell: false });
const pending = new Map();
let id = 0, active;
const report = { at: new Date().toISOString(), sha, route: 'local-codex-app-server', scope: 'Synthetic dialogue only; not the deployed Gemini provider or browser UX', transcripts: [] };
const send = msg => proc.stdin.write(JSON.stringify(msg) + '\n');
const rpc = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); send({ id: requestId, method, params }); });
function abort(error) { for (const p of pending.values()) p.reject(error); pending.clear(); if (active) { active.reject(error); active = null; } }
proc.on('error', abort);
proc.on('exit', () => abort(new Error('Codex app-server exited')));
proc.stderr.on('data', () => {}); // Do not persist arbitrary auth/config logs.
createInterface({ input: proc.stdout }).on('line', line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result); return; }
  if (msg.id !== undefined) { send({ id: msg.id, error: { code: -32601, message: 'Probe does not execute tools or approval requests' } }); abort(new Error('Unexpected server request')); return; }
  if (!active) return;
  if (msg.method === 'error' && msg.params?.error && msg.params.willRetry !== true) active.providerError = msg.params.error;
  if (msg.method === 'item/started' && !['userMessage', 'agentMessage', 'reasoning'].includes(msg.params.item?.type)) {
    send({ id: ++id, method: 'turn/interrupt', params: { threadId: active.threadId, turnId: msg.params.turnId } });
    abort(new Error('Tool use is not permitted in this dialogue probe')); return;
  }
  if (msg.method === 'item/agentMessage/delta') {
    active.text += msg.params.delta;
    active.firstDeltaMs ??= Date.now() - active.started;
    active.onDelta?.(msg.params.delta);
  }
  if (msg.method === 'turn/completed') {
    const current = active; active = null;
    if (msg.params.turn.status !== 'completed') {
      report.inferenceFailed = true;
      report.providerFailure = providerFailure(msg.params.turn.error ?? current.providerError);
      current.reject(new Error(`Inference did not complete: ${msg.params.turn.status}`));
    }
    else current.resolve({ text: current.text, firstDeltaMs: current.firstDeltaMs, elapsedMs: Date.now() - current.started });
  }
});
const controller = new AbortController(), expiresAt = Date.now() + 330_000;
const timer = setTimeout(() => { controller.abort(); abort(new Error('Probe exceeded 330 seconds')); proc.kill(); }, 330_000);
try {
  await rpc('initialize', { clientInfo: { name: 'retroloop_live_probe', title: 'RetroLoop live dialogue probe', version: '1.0.0' } });
  send({ method: 'initialized', params: {} });
  const account = (await rpc('account/read', { refreshToken: false })).account;
  report.authType = account?.type; report.planType = account?.planType;
  if (account?.type !== 'chatgpt') throw new Error('Probe requires ChatGPT subscription authentication; API-key auth is not allowed');
  const exhausted = exhaustedWindow(await rpc('account/rateLimits/read'));
  if (exhausted) { report.failurePhase = 'preflight'; report.providerFailure = exhausted; throw new Error('ChatGPT usage limit reached; no inference started'); }
  const models = await rpc('model/list', { limit: 100, includeHidden: false });
  const model = models.data?.find(m => m.isDefault) ?? models.data?.[0];
  if (!model) throw new Error('No model returned');
  report.model = model.model ?? model.id;
  const thread = await rpc('thread/start', { model: report.model, cwd: dir, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
    baseInstructions: 'あなたはレトロ（ふりかえり）を支援するアシスタントです。対象のふりかえり: 検証用。今回のKPT付箋: [Problem] コードレビューの待ち時間が長い。チームの助言・質問対応を日本語で簡潔に行ってください。ツールやファイルは一切使わず、ユーザーに返す対話文だけを出力してください。これは実データを含まない対話の検証です。\n' + ACTION_GUIDANCE });
  const { inputs, saved, date } = actionScenario();
  report.scenarioDate = date;
  let requestedTurns = 0;
  const complete = async (input, onDelta) => {
    if (controller.signal.aborted || Date.now() >= expiresAt || requestedTurns >= 3 || input !== inputs[requestedTurns] || active) throw new Error('Live inference exceeds the fixed synthetic scenario, turn limit or deadline');
    requestedTurns++;
    const completed = new Promise((resolve, reject) => { active = { resolve, reject, onDelta, threadId: thread.thread.id, text: '', started: Date.now() }; });
    const start = rpc('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: input }] });
    const [, output] = await Promise.all([start, completed]);
    if (!output.text.trim()) throw new Error('Model returned no visible text');
    return output;
  };
  if (process.argv.includes('--browser')) {
    report.scope = 'Real AiChat and KptBoard UI; real Plus inference; synthetic persistence, no production DB';
    report.excluded = 'Production chat route, Gemini provider, authentication and PostgreSQL persistence are covered separately by mock CI, not this live fixture';
    // Owner-authorized verifier changes are reviewed together with the candidate SHA.
    const { runBrowserProbe } = await loadCandidateVerifier(installation.repositoryPath, sourceRoot);
    await runBrowserProbe({ complete, dir, report, inputs, saved, sourceRoot, signal: controller.signal, expiresAt });
  } else {
    for (const input of inputs) report.transcripts.push({ input, ...await complete(input) });
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.reason = error.message; process.exitCode = 1;
  if (report.providerFailure?.category === 'usage-limit') {
    let refreshTimer;
    try {
      const limits = await Promise.race([rpc('account/rateLimits/read'), new Promise((_, reject) => { refreshTimer = setTimeout(() => reject(new Error('Rate-limit refresh timed out')), 3000); })]);
      report.providerFailure = exhaustedWindow(limits) ?? report.providerFailure;
    } catch { /* Preserve the known usage-limit failure if refresh is unavailable. */ }
    finally { clearTimeout(refreshTimer); }
  }
}
finally {
  clearTimeout(timer);
  await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  proc.stdin.end(); proc.kill();
  proc.stdin.destroy(); proc.stdout.destroy(); proc.stderr.destroy(); proc.unref();
}
console.log(JSON.stringify(report, null, 2));
