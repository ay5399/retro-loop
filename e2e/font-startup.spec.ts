import { test, expect } from "@playwright/test";

test("フォント生成に依存せずホームとログイン画面を表示できる", async ({ page }) => {
  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("その改善策、本当に効いてる？");
  const login = page.getByRole("link", { name: "ログイン", exact: true });
  await expect(login).toBeVisible();
  await expect(login).toHaveAttribute("href", "/signin");
  await page.screenshot({ path: "e2e/__screens__/font-repair-home.png", fullPage: true });

  await login.click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "ログイン", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com", { exact: true })).toBeVisible();
  // クライアント遷移ではプリフェッチを利用できるため、文書のHTTP応答も別途確認する。
  const signin = await page.request.get("/signin");
  expect(signin.status()).toBe(200);

  const reloaded = await page.reload();
  expect(reloaded?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "ログイン", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com", { exact: true })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/font-repair-signin.png", fullPage: true });
});
