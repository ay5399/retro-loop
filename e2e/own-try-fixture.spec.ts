import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { fixtureSdkAliases, resolveFixtureActions } from "../scripts/automation/verify-live-chat-ui.mjs";

test("合成画面がサーバー依存なしで本人Tryを確認・修正・保存し再表示する", async ({ page, baseURL }) => {
  const root = await realpath(".");
  const sourceDir = path.join(root, "src");
  const retroDir = path.join(sourceDir, "app/teams/[teamId]/retros/[retroId]");
  const store = path.join(root, "scripts/automation/live-ui-store.ts");
  expect(resolveFixtureActions(path.join(retroDir, "own-try-confirmation.tsx"), sourceDir)).toEqual({ path: store });
  expect(resolveFixtureActions(path.join(retroDir, "kpt-board.client.tsx"), sourceDir)).toEqual({ path: store });
  expect(resolveFixtureActions(path.join(sourceDir, "other/own-try-confirmation.tsx"), sourceDir)).toBeUndefined();
  expect(resolveFixtureActions(path.join(retroDir, "actions.ts"), sourceDir)).toBeUndefined();

  // Bundle the real entry and both real components with the verifier's resolver.
  // No server modules are externalized or replaced with empty stubs.
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["scripts/automation/live-ui-entry.tsx"],
    bundle: true, platform: "browser", jsx: "automatic", write: false,
    alias: await fixtureSdkAliases(root),
    tsconfigRaw: { compilerOptions: { baseUrl: root, paths: { "@/*": ["src/*"] } } },
    metafile: true,
    plugins: [{ name: "synthetic-actions-regression", setup(b) {
      b.onResolve({ filter: /^\.\/actions$/ }, args => resolveFixtureActions(args.importer, sourceDir));
    } }],
  });
  const inputs = Object.keys(bundle.metafile!.inputs).map(file => file.replaceAll("\\", "/"));
  expect(inputs.some(file => file.endsWith("/own-try-confirmation.tsx"))).toBe(true);
  expect(inputs.some(file => file.endsWith("/live-ui-store.ts"))).toBe(true);
  expect(inputs.filter(file => /(?:\/actions\.ts$|\/auth\.ts$|prisma|next-auth)/i.test(file))).toEqual([]);

  // Reuse the configured loopback baseURL; every request is intercepted.
  // Only the fixture document, bundle and mock chat may receive responses.
  expect(baseURL).toBe("http://localhost:3000");
  const origin = baseURL!;
  let calls = 0;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = request.url();
    if (url === `${origin}/` && request.method() === "GET") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ja"><meta charset="utf-8"><body><div id="root"></div><script src="/app.js"></script></body></html>' });
    }
    if (url === `${origin}/app.js` && request.method() === "GET") {
      return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
    }
    if (url === `${origin}/api/chat` && request.method() === "POST") {
      calls++;
      expect(calls).toBe(1);
      const body = request.postDataJSON();
      expect(body.teamId).toBe("live-fixture");
      expect(body.retroId).toBe("live-fixture");
      const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => {
        writer.write({ type: "start", messageId: "mock-own-try" });
        writer.write({ type: "text-start", id: "text" });
        writer.write({ type: "text-delta", id: "text", delta: "自分で実行する行動と日付を入力し、保存前に確認してください。まだ保存されていません。" });
        writer.write({ type: "text-end", id: "text" });
        writer.write({ type: "finish", finishReason: "stop" });
      } }) });
      return route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    return route.abort();
  });
  await page.goto("/");
  await page.locator("[data-chat-input]").fill("レビュー待ちを減らす自分の行動を相談したい");
  await page.locator("[data-chat-send]").click();
  await expect(page.locator("[data-ai-chat] li.justify-start")).toContainText("まだ保存されていません");
  await expect(page.locator("[data-chat-error]")).toHaveCount(0);
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  const lane = page.locator('[data-lane="TRY"]');
  await expect(form.getByLabel("実行する行動")).toHaveValue("");
  await expect(form.getByLabel("実行する日付")).toHaveValue("");
  await expect(form.getByRole("button", { name: "保存内容を確認" })).toBeDisabled();
  await form.getByLabel("実行する行動").fill("レビュー待ちを記録する");
  await form.getByLabel("実行する日付").fill("2026-11-06");
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await expect(form).toContainText("まだ保存されていません");
  await expect(lane.locator("[data-note-id]")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("retro-live-fixture"))).toBeNull();
  await page.screenshot({ path: "e2e/__screens__/own-try-fixture-before.png", fullPage: true });
  await form.getByRole("button", { name: "修正する" }).click();
  await expect(form.getByLabel("実行する行動")).toHaveValue("レビュー待ちを記録する");
  await expect(form.getByLabel("実行する日付")).toHaveValue("2026-11-06");
  await form.getByLabel("実行する行動").fill("自分のPRのレビュー依頼時刻を一件記録する");
  await form.getByLabel("実行する日付").fill("2026-11-07");
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
  const content = "行動：自分のPRのレビュー依頼時刻を一件記録する\n担当：自分（付箋の作成者）\n日付：2026-11-07";
  await expect(lane.locator("[data-note-id] p")).toHaveText(content);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("retro-live-fixture")!));
  expect(saved.filter((note: { kind: string }) => note.kind === "TRY")).toHaveLength(1);
  await page.reload();
  await expect(lane.locator("[data-note-id]")).toHaveCount(1);
  await expect(lane.locator("[data-note-id] p")).toHaveText(content);
  expect(calls).toBe(1);
  await page.screenshot({ path: "e2e/__screens__/own-try-fixture-after.png", fullPage: true });
});
