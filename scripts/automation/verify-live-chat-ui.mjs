import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
export async function fixtureSdkAliases(repositoryRoot = root) {
  const installed = createRequire(path.join(repositoryRoot, 'package.json'));
  const lock = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
  const aliases = {};
  for (const name of ['ai', '@ai-sdk/react']) {
    const metadata = JSON.parse(await readFile(installed.resolve(`${name}/package.json`), 'utf8'));
    if (metadata.version !== lock.packages?.[`node_modules/${name}`]?.version) throw new Error(`Installed ${name} does not match the locked fixture SDK version`);
    aliases[name] = await realpath(installed.resolve(name));
  }
  return aliases;
}
export function assertSafeStylesheet(css) {
  const postcss = createRequire(path.join(root, 'package.json'))('postcss');
  postcss.parse(css).walkAtRules(rule => {
    if (!['import', 'media', 'theme', 'layer', 'apply', 'supports', 'keyframes', 'container', 'property', 'starting-style', 'custom-variant', 'utility', 'variant', 'font-face'].includes(rule.name) || (rule.name === 'import' && !/^(?:"tailwindcss"|'tailwindcss')$/.test(rule.params))) throw new Error('Candidate CSS may not load scripts, configuration or additional files');
  });
}

export function createFixtureChatStream({ complete, input, report }) {
  return createUIMessageStream({ execute: async ({ writer }) => {
    const messageId = `live-${randomBytes(16).toString('hex')}`;
    const id = `${messageId}-text`;
    writer.write({ type: 'start', messageId });
    writer.write({ type: 'text-start', id });
    const output = await complete(input, delta => writer.write({ type: 'text-delta', id, delta }));
    report.transcripts.push({ input, ...output });
    writer.write({ type: 'text-end', id });
    writer.write({ type: 'finish', finishReason: 'stop' });
  } });
}

// Bounded wording checks, not a general semantic evaluation of arbitrary AI replies.
// ACTION_GUIDANCE requires a confirmation and a manual Try instruction, not the literal word 保存.
export function assertConfirmationReply(text) {
  expect(text).toMatch(/確認|保存前|未保存|下書き|案/);
  expect(text).toMatch(/(?:Try|トライ)付箋[\s\S]{0,48}(?:追加|登録)/i);
  expect(text).not.toMatch(/(?:保存|追加|登録)(?:しました|済み|(?:が|は)完了|して(?:います|あります|おきました|おいた))/);
}

export async function runBrowserProbe({ complete, dir, report, inputs, sourceRoot = root, signal, expiresAt = Date.now() + 330_000 }) {
  const localRequire = createRequire(path.join(root, 'package.json'));
  const { build } = localRequire('esbuild');
  const postcss = localRequire('postcss'), tailwind = localRequire('@tailwindcss/postcss');
  const sourceDir = path.join(await realpath(sourceRoot), 'src');
  const cssFile = await realpath(path.join(sourceRoot, 'src/app/globals.css'));
  if (!cssFile.startsWith(sourceDir + path.sep)) throw new Error('Candidate CSS resolves outside source');
  const candidateCss = await readFile(cssFile, 'utf8');
  assertSafeStylesheet(candidateCss);
  const modulesDir = await realpath(path.join(root, 'node_modules'));
  const fixtureFiles = await Promise.all(['live-ui-entry.tsx', 'live-ui-store.ts'].map(f => realpath(path.join(root, 'scripts/automation', f))));
  await build({ absWorkingDir: root, nodePaths: [path.join(root, 'node_modules')], alias: await fixtureSdkAliases(), tsconfigRaw: { compilerOptions: { baseUrl: sourceRoot, paths: { '@/*': ['src/*'] } } }, entryPoints: ['scripts/automation/live-ui-entry.tsx'], outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic-actions', setup(b) {
    b.onResolve({ filter: /^\.\.\/\.\.\/src\// }, args => args.importer.endsWith('live-ui-entry.tsx') ? { path: path.join(sourceRoot, args.path.slice(6) + '.tsx') } : undefined);
    b.onResolve({ filter: /^\.\/actions$/ }, args => args.importer.endsWith('kpt-board.client.tsx') ? { path: path.join(root, 'scripts/automation/live-ui-store.ts') } : undefined);
    b.onLoad({ filter: /.*/ }, async args => {
      const file = await realpath(args.path);
      if (!file.startsWith(sourceDir + path.sep) && !file.startsWith(modulesDir + path.sep) && !fixtureFiles.includes(file)) throw new Error('Browser bundle attempted to read outside source, dependencies or fixture');
      return undefined;
    });
  } }] });
  const css = await postcss([tailwind({ base: sourceRoot })]).process(candidateCss, { from: path.join(root, 'src/app/globals.css') });
  await writeFile(path.join(dir, 'styles.css'), css.css);
  const session = randomBytes(32).toString('hex');
  let origin, count = 0;
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': `probe=${session}; HttpOnly; SameSite=Strict; Path=/` });
        res.end('<!doctype html><html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); return;
      }
      const cookies = Object.fromEntries((req.headers.cookie ?? '').split(';').map(pair => { const i = pair.indexOf('='); return [pair.slice(0, i).trim(), pair.slice(i + 1)]; }));
      if (cookies.probe !== session) { res.writeHead(403).end(); return; }
      if (req.method === 'GET' && ['/app.js', '/styles.css'].includes(req.url)) {
        res.writeHead(200, { 'Content-Type': req.url.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(await readFile(path.join(dir, req.url.slice(1)))); return;
      }
      if (req.method !== 'POST' || req.url !== '/api/chat' || req.headers.origin !== origin || count >= inputs.length) { res.writeHead(403).end(); return; }
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 32_000) throw new Error('Request too large'); }
      const body = JSON.parse(text);
      const input = body.messages?.filter(m => m.role === 'user').at(-1)?.parts?.filter(p => p.type === 'text').map(p => p.text).join('');
      if (body.teamId !== 'live-fixture' || body.retroId !== 'live-fixture' || input !== inputs[count]) { res.writeHead(400).end(); return; }
      count++;
      const response = createUIMessageStreamResponse({ stream: createFixtureChatStream({ complete, input, report }) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const stop = () => { browser?.close().catch(() => {}); server.closeAllConnections(); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin);
    await expect(page.locator('[data-chat-input]')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ui-before.png'), fullPage: true });
    for (let i = 0; i < inputs.length; i++) {
      await page.locator('[data-chat-input]').fill(inputs[i]);
      await page.locator('[data-chat-send]').click();
      await expect(page.locator('[data-chat-send]')).toBeDisabled();
      await expect(page.locator('[data-chat-input]')).toBeEnabled({ timeout: Math.max(1, Math.min(90_000, expiresAt - Date.now())) });
      await expect(page.locator('[data-chat-error]')).toHaveCount(0);
      const replies = page.locator('[data-ai-chat] li.justify-start');
      await expect(replies).toHaveCount(i + 1);
      expect((await replies.last().innerText()).trim().length).toBeGreaterThan(10);
    }
    expect(report.transcripts[0].text).not.toMatch(/15時|当番/);
    assertConfirmationReply(report.transcripts[2].text);
    const saved = '担当：私／日付：2026-10-26 朝会後／行動：自分のPRにレビュー希望時刻を記載し、チームへ共有する';
    const lane = page.locator('[data-lane="TRY"]');
    await lane.getByPlaceholder('Try を追加').fill(saved);
    await lane.getByRole('button', { name: '＋ 追加', exact: true }).click();
    await expect(lane.locator('[data-note-id] p').filter({ hasText: saved })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ui-after.png'), fullPage: true });
    await page.reload();
    await expect(page.locator('[data-lane="TRY"] [data-note-id] p').filter({ hasText: saved })).toBeVisible();
    report.browser = { status: 'passed', realComponents: ['AiChat', 'KptBoardClient'], persistence: 'synthetic localStorage fixture; real PostgreSQL server actions remain covered separately by CI', savedNoteReappeared: true, liveCalls: count };
  } finally { signal?.removeEventListener('abort', stop); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
