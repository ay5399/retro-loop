import { test, expect, type Page } from "@playwright/test";

const path = "/experiments/action-confirmation";
const action = "レビュー依頼時に確認観点を3点添える";
const storageKey = "retroloop:experiment:action-v1:架空メンバーA:架空ふりかえり1";
const blockedRequests = new WeakMap<Page, string[]>();

// Every scenario fails on an attempted external/API request, even if aborted.
test.beforeEach(async ({ page, baseURL }) => {
  const forbidden: string[] = [];
  blockedRequests.set(page, forbidden);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL!).origin || url.pathname.startsWith("/api/")) {
      forbidden.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => {
  expect(blockedRequests.get(page)).toEqual([]);
});

async function converse(page: Page) {
  for (const text of ["気をつける", action, "2026-10-30に自分が実行します"]) {
    await page.getByLabel("本人の返答").fill(text);
    await page.getByRole("button", { name: "返答する" }).click();
  }
  await expect(page.getByText("3往復が終了しました。未確定なら保存せず、考え直してください。")).toBeVisible();
  await expect(page.getByRole("button", { name: "返答する" })).toHaveCount(0);
}
async function prepare(page: Page) {
  await converse(page);
  await page.getByLabel("実行する行動", { exact: true }).fill("レビュー依頼する");
  await page.getByLabel("実行する日付", { exact: true }).fill("2026-10-30");
  await page.getByRole("checkbox", { name: /本人が担当/ }).check();
  await page.getByLabel("実行する行動", { exact: true }).fill(action);
  await expect(page.getByRole("checkbox", { name: /本人が担当/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /本人が担当/ }).check();
}

test("本人入力の確認・保存・再表示と自由文比較", async ({ page }) => {
  await page.goto(path);
  await page.getByLabel("自由文のみの比較画面").check();
  await converse(page);
  await expect(page.getByRole("button", { name: "確認してブラウザーに保存" })).toHaveCount(0);
  await page.screenshot({ path: "e2e/__screens__/action-confirmation-before.png", fullPage: true });
  await page.getByLabel("自由文のみの比較画面").uncheck();
  const save = page.getByRole("button", { name: "確認してブラウザーに保存" });
  await converse(page);
  await expect(page.getByLabel("実行する行動", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("実行する日付", { exact: true })).toHaveValue("");
  await expect(save).toBeDisabled();
  await page.getByLabel("実行する行動", { exact: true }).fill("レビュー依頼する");
  await page.getByRole("checkbox", { name: /本人が担当/ }).check();
  await expect(save).toBeDisabled();
  await page.getByLabel("実行する日付", { exact: true }).fill("2026-10-30");
  await expect(page.getByRole("checkbox", { name: /本人が担当/ })).not.toBeChecked();
  await page.getByLabel("実行する行動", { exact: true }).fill(action);
  await page.getByRole("checkbox", { name: /本人が担当/ }).check();
  await page.screenshot({ path: "e2e/__screens__/action-confirmation-after.png", fullPage: true });
  // Two synchronous clicks must still produce only one stored record.
  await save.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  const saved = page.getByRole("region", { name: "保存済みアクション" });
  await expect(saved).toContainText(action);
  await page.reload();
  await expect(saved).toContainText("レビュー待ちが長く、自分の作業が止まる");
  await expect(saved).toContainText(action);
  await expect(saved).toContainText("架空メンバーA");
  await expect(saved).toContainText("2026-10-30");
  await expect(saved.getByRole("definition").last()).toHaveText("未着手");
  await page.screenshot({ path: "e2e/__screens__/action-confirmation-reloaded.png", fullPage: true });
  await page.getByRole("button", { name: "完了にする" }).click();
  await page.reload();
  await expect(saved.getByRole("definition").last()).toHaveText("完了");
  await page.getByLabel("実験ユーザー").selectOption("架空メンバーB");
  await expect(saved).toHaveCount(0);
  await page.getByLabel("実験ユーザー").selectOption("架空メンバーA");
  await expect(saved).toContainText(action);
  await page.getByLabel("実験ふりかえり").selectOption("架空ふりかえり2");
  await expect(saved).toHaveCount(0);
  await page.getByLabel("実験ふりかえり").selectOption("架空ふりかえり1");
  await expect(saved).toContainText(action);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("retroloop:experiment:action-v1:")))).toHaveLength(1);
});

test("保存失敗では成功表示せず、再試行できる", async ({ page }) => {
  await page.goto(path);
  await prepare(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("retroloop:experiment:action-v1:")) {
        Storage.prototype.setItem = original;
        throw new DOMException("Dummy quota exceeded", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "確認してブラウザーに保存" }).click();
  await expect(page.getByRole("alert")).toContainText("保存できませんでした");
  await expect(page.getByRole("region", { name: "保存済みアクション" })).toHaveCount(0);
  await page.getByRole("button", { name: "確認してブラウザーに保存" }).click();
  await expect(page.getByRole("region", { name: "保存済みアクション" })).toContainText(action);
});

test("完了の保存失敗では未着手を維持する", async ({ page }) => {
  await page.goto(path);
  await prepare(page);
  await page.getByRole("button", { name: "確認してブラウザーに保存" }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("retroloop:experiment:action-v1:")) {
        Storage.prototype.setItem = original;
        throw new DOMException("Dummy quota exceeded", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "完了にする" }).click();
  await expect(page.getByRole("alert")).toContainText("保存できませんでした");
  const status = page.getByRole("region", { name: "保存済みアクション" }).getByRole("definition").last();
  await expect(status).toHaveText("未着手");
  await page.reload();
  await expect(status).toHaveText("未着手");
  await page.getByRole("button", { name: "完了にする" }).click();
  await page.reload();
  await expect(status).toHaveText("完了");
});

for (const [name, raw] of [
  ["壊れたJSON", "{"],
  ["存在しない日付", JSON.stringify({ problem: "レビュー待ちが長く、自分の作業が止まる", action, owner: "架空メンバーA", retro: "架空ふりかえり1", date: "2026-02-30", done: false })],
  ["異なるふりかえり", JSON.stringify({ problem: "レビュー待ちが長く、自分の作業が止まる", action, owner: "架空メンバーA", retro: "架空ふりかえり2", date: "2026-10-30", done: false })],
]) {
  test(`${name}は表示・上書きせず停止する`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: raw });
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("上書きせず、この実験を停止しました");
    await expect(page.getByRole("region", { name: "保存済みアクション" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "返答する" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "確認してブラウザーに保存" })).toBeDisabled();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(raw);
  });
}

test("ブラウザー保存の読込拒否時は書き込まない", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Dummy access denied", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new Error("Unexpected write"); };
  });
  await page.goto(path);
  await expect(page.getByRole("alert")).toContainText("上書きせず、この実験を停止しました");
  await expect(page.getByRole("button", { name: "確認してブラウザーに保存" })).toBeDisabled();
});
