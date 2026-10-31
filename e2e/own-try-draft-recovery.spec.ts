import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
let teamId: string;
let retroId: string;
let otherRetroId: string;
let userId: string;
let email: string;
let otherEmail: string;
const action = "レビュー依頼の時刻を記録する\n完了時刻と比較する";
const date = "2026-11-09";
const form = (page: Page) => page.getByRole("region", { name: "自分のTryを確認・保存" });
const key = () => `retroloop:own-try-draft:v1:${JSON.stringify([userId, teamId, retroId])}`;
const url = () => `/teams/${teamId}/retros/${retroId}`;

test.beforeEach(async ({ page }, testInfo) => {
  email = `draft-${testInfo.testId}@example.com`;
  otherEmail = `draft-other-${testInfo.testId}@example.com`;
  const user = await prisma.user.create({ data: { email } });
  userId = user.id;
  const other = await prisma.user.create({ data: { email: otherEmail } });
  const team = await prisma.team.create({ data: { name: "下書き復元テスト", memberships: { create: [{ userId }, { userId: other.id }] } } });
  teamId = team.id;
  retroId = (await prisma.retrospective.create({ data: { teamId, name: "下書き復元" } })).id;
  otherRetroId = (await prisma.retrospective.create({ data: { teamId, name: "別のふりかえり" } })).id;
  await prisma.note.create({ data: { retrospectiveId: retroId, authorId: userId, kind: "PROBLEM", content: "レビュー待ちが長い" } });
  await loginAsDev(page, email);
  await page.goto(url());
  await expect(form(page).getByLabel("実行する行動")).toBeEnabled();
});

test.afterEach(async () => {
  await prisma.team.delete({ where: { id: teamId } });
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
});
test.afterAll(async () => { await prisma.$disconnect(); });

async function fillDraft(page: Page) {
  await form(page).getByLabel("実行する行動").fill(action);
  await form(page).getByLabel("実行する日付").fill(date);
}

test("再読み込み後に改行を復元し、再確認・修正して本人のTry一件を保存する", async ({ page }) => {
  let chatRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/chat") chatRequests++; });
  await fillDraft(page);
  await page.screenshot({ path: "e2e/__screens__/own-try-draft-recovery-before.png", fullPage: true });
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue(action);
  await expect(form(page).getByLabel("実行する日付")).toHaveValue(date);
  await expect(form(page)).toContainText("未保存の下書きを復元しました");
  await expect(form(page)).toContainText("まだ保存されていません。");
  await form(page).getByRole("button", { name: "保存内容を確認" }).click();
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue(action);
  await expect(form(page).getByRole("button", { name: "Try付箋として保存", exact: true })).toHaveCount(0);
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
  expect(chatRequests).toBe(0);
  const revised = `${action}\n一件分をチームへ共有する`;
  await form(page).getByLabel("実行する行動").fill(revised);
  await form(page).getByLabel("実行する日付").fill("2026-11-10");
  await form(page).getByRole("button", { name: "保存内容を確認" }).click();
  await form(page).getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form(page).getByRole("status")).toContainText("保存しました");
  expect(await page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key())).toBeNull();
  const notes = await prisma.note.findMany({ where: { retrospectiveId: retroId, kind: "TRY" } });
  expect(notes).toHaveLength(1);
  expect(notes[0].authorId).toBe(userId);
  expect(notes[0].content).toBe(`行動：${revised}\n担当：自分（付箋の作成者）\n日付：2026-11-10`);
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue("");
  await expect(form(page).getByLabel("実行する日付")).toHaveValue("");
  await expect(page.locator('[data-lane="TRY"] [data-note-id]').filter({ hasText: revised })).toHaveCount(1);
  await page.screenshot({ path: "e2e/__screens__/own-try-draft-recovery-after.png", fullPage: true });
});

test("保存失敗後も復元でき、明示破棄後は復元しない", async ({ page }) => {
  await fillDraft(page);
  await form(page).getByRole("button", { name: "保存内容を確認" }).click();
  await page.route(url(), async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await route.abort("failed");
    else await route.continue();
  });
  await form(page).getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form(page).getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue(action);
  await expect(form(page).getByLabel("実行する日付")).toHaveValue(date);
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
  await form(page).getByRole("button", { name: "下書きを破棄" }).click();
  expect(await page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key())).toBeNull();
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue("");
  await expect(form(page).getByLabel("実行する日付")).toHaveValue("");
});

test("別ふりかえりと別本人へ混入せず、元の本人には残る", async ({ page }) => {
  await fillDraft(page);
  await page.goto(`/teams/${teamId}/retros/${otherRetroId}`);
  await expect(form(page).getByLabel("実行する行動")).toBeEnabled();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue("");
  await expect(form(page).getByLabel("実行する日付")).toHaveValue("");
  await page.goto(url());
  await expect(form(page).getByLabel("実行する行動")).toHaveValue(action);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await loginAsDev(page, otherEmail);
  await page.goto(url());
  await expect(form(page).getByLabel("実行する行動")).toBeEnabled();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue("");
  await expect(form(page).getByLabel("実行する日付")).toHaveValue("");
  expect(await page.evaluate((storageKey) => JSON.parse(sessionStorage.getItem(storageKey)!), key())).toEqual({ action, date });
});

for (const raw of ["{broken", JSON.stringify({ action: 42, date }), JSON.stringify({ action, date: "invalid" })]) {
  test(`不正な下書きでも入力し直して保存できる: ${raw}`, async ({ page }) => {
    await page.evaluate(({ storageKey, value }) => sessionStorage.setItem(storageKey, value), { storageKey: key(), value: raw });
    await page.reload();
    await expect(form(page).getByLabel("実行する行動")).toBeEnabled();
    await expect(form(page).getByLabel("実行する行動")).toHaveValue("");
    await fillDraft(page);
    await page.reload();
    await expect(form(page).getByLabel("実行する行動")).toHaveValue(action);
    await form(page).getByRole("button", { name: "保存内容を確認" }).click();
    await form(page).getByRole("button", { name: "Try付箋として保存", exact: true }).click();
    await expect(form(page).getByRole("status")).toContainText("保存しました");
  });
}

test("初期復元で下書きを上書きせず、別チームの同名キーも読まない", async ({ page }) => {
  const foreignKey = `retroloop:own-try-draft:v1:${JSON.stringify([userId, `${teamId}-other`, retroId])}`;
  await page.evaluate(({ storageKey, foreignKey, action }) => {
    sessionStorage.setItem(foreignKey, JSON.stringify({ action: "別チームの行動", date: "2026-11-11" }));
    sessionStorage.setItem(storageKey, JSON.stringify({ action, date: "" }));
  }, { storageKey: key(), foreignKey, action });
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue(action);
  await expect(form(page).getByLabel("実行する日付")).toHaveValue("");
  expect(await page.evaluate((storageKey) => JSON.parse(sessionStorage.getItem(storageKey)!), key())).toEqual({ action, date: "" });
  await form(page).getByRole("button", { name: "下書きを破棄" }).click();
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toBeEnabled();
  await expect(form(page).getByLabel("実行する行動")).toHaveValue("");
  expect(await page.evaluate((storageKey) => JSON.parse(sessionStorage.getItem(storageKey)!), foreignKey)).toEqual({ action: "別チームの行動", date: "2026-11-11" });
});

test("容量不足の書込例外でも入力を保持して保存する", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  });
  await page.reload();
  await fillDraft(page);
  await expect(form(page)).toContainText("このタブに下書きを保持できません");
  await expect(form(page).getByLabel("実行する行動")).toHaveValue(action);
  await form(page).getByRole("button", { name: "保存内容を確認" }).click();
  await form(page).getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form(page).getByRole("status")).toContainText("保存しました");
});

test("保存領域の読取・書込が例外でも通常の確認保存を継続する", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Unavailable", "SecurityError"); } });
  });
  await page.reload();
  await expect(form(page).getByLabel("実行する行動")).toBeEnabled();
  await expect(form(page)).toContainText("下書きを復元できませんでした");
  await fillDraft(page);
  await expect(form(page)).toContainText("このタブに下書きを保持できません");
  await form(page).getByRole("button", { name: "保存内容を確認" }).click();
  await form(page).getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form(page).getByRole("status")).toContainText("保存しました");
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY", authorId: userId } })).toBe(1);
});
