import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));

export async function runBrowserProbe({ complete, dir, report, inputs, sourceRoot = root }) {
  const localRequire = createRequire(path.join(root, 'package.json'));
  const { build } = localRequire('esbuild');
  const postcss = localRequire('postcss'), tailwind = localRequire('@tailwindcss/postcss');
  await build({ absWorkingDir: root, nodePaths: [path.join(root, 'node_modules')], tsconfigRaw: { compilerOptions: { baseUrl: sourceRoot, paths: { '@/*': ['src/*'] } } }, entryPoints: ['scripts/automation/live-ui-entry.tsx'], outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic-actions', setup(b) {
    b.onResolve({ filter: /^\.\.\/\.\.\/src\// }, args => args.importer.endsWith('live-ui-entry.tsx') ? { path: path.join(sourceRoot, args.path.slice(6) + '.tsx') } : undefined);
    b.onResolve({ filter: /^\.\/actions$/ }, args => args.importer.endsWith('kpt-board.client.tsx') ? { path: path.join(root, 'scripts/automation/live-ui-store.ts') } : undefined);
  } }] });
  const css = await postcss([tailwind({ base: sourceRoot })]).process(await readFile(path.join(sourceRoot, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
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
      const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: async ({ writer }) => {
        const id = `live-${count}`;
        writer.write({ type: 'text-start', id });
        const output = await complete(input, delta => writer.write({ type: 'text-delta', id, delta }));
        report.transcripts.push({ input, ...output });
        writer.write({ type: 'text-end', id });
      } }) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
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
      await expect(page.locator('[data-chat-input]')).toBeEnabled({ timeout: 90_000 });
      const replies = page.locator('[data-ai-chat] li.justify-start');
      await expect(replies).toHaveCount(i + 1);
      expect((await replies.last().innerText()).trim().length).toBeGreaterThan(10);
    }
    expect(report.transcripts[0].text).not.toMatch(/15時|当番/);
    expect(report.transcripts[2].text).toMatch(/保存/);
    const saved = '担当：私／日付：2026-10-26 朝会後／行動：自分のPRにレビュー希望時刻を記載し、チームへ共有する';
    const lane = page.locator('[data-lane="TRY"]');
    await lane.getByPlaceholder('Try を追加').fill(saved);
    await lane.getByRole('button', { name: '＋ 追加', exact: true }).click();
    await expect(lane.locator('[data-note-id] p').filter({ hasText: saved })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ui-after.png'), fullPage: true });
    await page.reload();
    await expect(page.locator('[data-lane="TRY"] [data-note-id] p').filter({ hasText: saved })).toBeVisible();
    report.browser = { status: 'passed', realComponents: ['AiChat', 'KptBoardClient'], persistence: 'synthetic localStorage fixture; real PostgreSQL server actions remain covered separately by CI', savedNoteReappeared: true, liveCalls: count };
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
