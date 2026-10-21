// Explicit, bounded live inference probe. No production data, database or app code.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
const home = process.env.RETRO_AUTOMATION_HOME;
if (!home) throw new Error('Set RETRO_AUTOMATION_HOME');
const installation = JSON.parse(await readFile(path.join(home, 'installation.json'), 'utf8'));
const dir = path.join(home, 'live-ai-probe');
await mkdir(dir, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|API_KEY|DATABASE_URL|DIRECT_URL|CLAUDE_CODE_USE_|ANTHROPIC_|OPENAI_|GIT_CONFIG_/i.test(key)));
const cmd = installation.commands.codex;
const proc = spawn(cmd.file, [...cmd.args, 'app-server', '--listen', 'stdio://'], { cwd: dir, env, windowsHide: true, shell: false });
const pending = new Map();
let id = 0, active;
const report = { at: new Date().toISOString(), route: 'local-codex-app-server', scope: 'Synthetic dialogue only; not the deployed Gemini provider or browser UX', transcripts: [] };
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
  if (msg.method === 'item/started' && !['userMessage', 'agentMessage', 'reasoning'].includes(msg.params.item?.type)) {
    send({ id: ++id, method: 'turn/interrupt', params: { threadId: active.threadId, turnId: msg.params.turnId } });
    abort(new Error('Tool use is not permitted in this dialogue probe')); return;
  }
  if (msg.method === 'item/agentMessage/delta') {
    active.text += msg.params.delta;
    active.firstDeltaMs ??= Date.now() - active.started;
  }
  if (msg.method === 'turn/completed') {
    const current = active; active = null;
    if (msg.params.turn.status !== 'completed') current.reject(new Error(`Inference did not complete: ${msg.params.turn.status}`));
    else current.resolve({ text: current.text, firstDeltaMs: current.firstDeltaMs, elapsedMs: Date.now() - current.started });
  }
});
const timer = setTimeout(() => { abort(new Error('Probe exceeded 180 seconds')); proc.kill(); }, 180_000);
try {
  await rpc('initialize', { clientInfo: { name: 'retroloop_live_probe', title: 'RetroLoop live dialogue probe', version: '1.0.0' } });
  send({ method: 'initialized', params: {} });
  const account = (await rpc('account/read', { refreshToken: false })).account;
  report.authType = account?.type; report.planType = account?.planType;
  if (account?.type !== 'chatgpt') throw new Error('Probe requires ChatGPT subscription authentication; API-key auth is not allowed');
  const models = await rpc('model/list', { limit: 100, includeHidden: false });
  const model = models.data?.find(m => m.isDefault) ?? models.data?.[0];
  if (!model) throw new Error('No model returned');
  report.model = model.model ?? model.id;
  const thread = await rpc('thread/start', { model: report.model, cwd: dir, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
    baseInstructions: 'あなたはレトロ（ふりかえり）を支援するアシスタントです。対象のふりかえり: 検証用。今回のKPT付箋: [Problem] コードレビューの待ち時間が長い。チームの助言・質問対応を日本語で簡潔に行ってください。ツールやファイルは一切使わず、ユーザーに返す対話文だけを出力してください。これは実データを含まない対話の検証です。' });
  for (const input of ['レビュー待ちが長いので「気をつける」を次のアクションにしようと思います。具体化を手伝って。', '自分でできることにしたい。担当者や期限はまだ決めていません。勝手に決めず、必要なことを質問して。', '担当は私。来週月曜の朝会後に、自分のPRへレビュー希望時刻を記載してチームに共有します。保存前に確認できる形でまとめて。']) {
    const completed = new Promise((resolve, reject) => { active = { resolve, reject, threadId: thread.thread.id, text: '', started: Date.now() }; });
    const start = rpc('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: input }] });
    const [, output] = await Promise.all([start, completed]);
    if (!output.text.trim()) throw new Error('Model returned no visible text');
    report.transcripts.push({ input, ...output });
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.reason = error.message; process.exitCode = 1; }
finally {
  clearTimeout(timer);
  await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  proc.stdin.end(); proc.kill();
  proc.stdin.destroy(); proc.stdout.destroy(); proc.stderr.destroy(); proc.unref();
}
console.log(JSON.stringify(report, null, 2));
