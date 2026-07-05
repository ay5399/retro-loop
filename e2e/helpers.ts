import { existsSync, readFileSync, rmSync } from "node:fs";
import type { Page } from "@playwright/test";

// 開発サーバがマジックリンクを書き出すファイル（src/auth.ts のE2Eフック）
const MAGIC_LINK_FILE = ".magic-link.dev";

/**
 * マジックリンク方式で実際にログインする（実ブラウザ操作）。
 * /signin でメールを送信 → dev フックが書き出したリンクをブラウザで開く。
 */
export async function loginViaMagicLink(page: Page, email: string): Promise<void> {
  // 前回のリンクが残っていれば消す
  if (existsSync(MAGIC_LINK_FILE)) rmSync(MAGIC_LINK_FILE);

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "ログインリンクを送る" }).click();

  // dev フックが書き出したマジックリンクを読む（送信完了の実シグナル）
  const url = await waitForMagicLink();
  await page.goto(url);
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

async function waitForMagicLink(timeoutMs = 5000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(MAGIC_LINK_FILE)) {
      const url = readFileSync(MAGIC_LINK_FILE, "utf8").trim();
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("マジックリンクが生成されませんでした（.magic-link.dev が見つからない）");
}
