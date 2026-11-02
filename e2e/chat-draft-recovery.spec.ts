import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
let teamId: string;
let retroId: string;
let otherRetroId: string;
let userId: string;
let email: string;
let otherEmail: string;
const key = () => `retroloop:chat-draft:v1:${JSON.stringify([userId, teamId, retroId])}`;
const url = () => `/teams/${teamId}/retros/${retroId}`;
const original = "  レビュー待ちを減らしたい\n\nまず依頼時刻を記録する  ";

test.beforeEach(async ({ page }, info) => {
  email = `chat-draft-${info.testId}@example.com`;
  otherEmail = `chat-draft-other-${info.testId}@example.com`;
  userId = (await prisma.user.create({ data: { email } })).id;
  const other = await prisma.user.create({ data: { email: otherEmail } });
  teamId = (await prisma.team.create({ data: { name: "相談文復元", memberships: { create: [{ userId }, { userId: other.id }] } } })).id;
  retroId = (await prisma.retrospective.create({ data: { teamId, name: "相談文復元" } })).id;
  otherRetroId = (await prisma.retrospective.create({ data: { teamId, name: "別の回" } })).id;
  await prisma.note.create({ data: { retrospectiveId: retroId, authorId: userId, kind: "PROBLEM", content: "レビュー待ちが長い" } });
  await loginAsDev(page, email);
  await page.goto(url());
  await expect(page.getByLabel("AIへの相談文")).toBeEnabled();
});
test.afterEach(async () => {
  await prisma.team.delete({ where: { id: teamId } });
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
});
test.afterAll(async () => { await prisma.$disconnect(); });

test("Problemの相談文を復元し、明示送信から本人Tryの確認・保存へ進む", async ({ page }) => {
  let requests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/chat") requests++; });
  await page.getByLabel("自分のProblemから相談する").selectOption({ label: "レビュー待ちが長い" });
  await page.getByRole("button", { name: "相談文の下書きに追加" }).click();
  const generated = await page.getByLabel("AIへの相談文").inputValue();
  const draft = `${generated}\n\n${original}`;
  await page.getByLabel("AIへの相談文").fill(draft);
  await page.screenshot({ path: "e2e/__screens__/chat-draft-recovery-before.png", fullPage: true });
  await page.reload();
  await expect(page.getByLabel("AIへの相談文")).toHaveValue(draft);
  await expect(page.getByText("未送信の相談文を復元しました。", { exact: false })).toBeVisible();
  expect(requests).toBe(0);
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
  await page.screenshot({ path: "e2e/__screens__/chat-draft-recovery-after.png", fullPage: true });
  await page.getByLabel("AIへの相談文").fill(`${draft}\n自分で依頼時刻を記録します。`);
  await page.locator("[data-chat-send]").click();
  await expect(page.locator("[data-chat-input]")).toBeEnabled();
  await expect(page.locator("[data-chat-input]")).toHaveValue("");
  await expect(page.locator("[data-chat-error]")).toHaveCount(0);
  expect(requests).toBe(1);
  expect(await page.evaluate(k => sessionStorage.getItem(k), key())).toBeNull();
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  await form.getByLabel("実行する行動").fill("レビュー依頼時刻を記録する");
  await form.getByLabel("実行する日付").fill("2026-11-09");
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await expect(form).toContainText("担当：自分");
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("保存しました");
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY", authorId: userId } })).toBe(1);
  await page.reload();
  await expect(page.getByLabel("AIへの相談文")).toHaveValue("");
  await expect(page.locator('[data-lane="TRY"] [data-note-id]').filter({ hasText: "レビュー依頼時刻を記録する" })).toHaveCount(1);
});

test("本人・回・チームの境界と明示破棄", async ({ page }) => {
  await page.getByLabel("AIへの相談文").fill(original);
  await page.goto(`/teams/${teamId}/retros/${otherRetroId}`);
  await expect(page.getByLabel("AIへの相談文")).toHaveValue("");
  await page.goto(url());
  await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await loginAsDev(page, otherEmail);
  await page.goto(url());
  await expect(page.getByLabel("AIへの相談文")).toBeEnabled();
  await expect(page.getByLabel("AIへの相談文")).toHaveValue("");
  expect(await page.evaluate(k => JSON.parse(sessionStorage.getItem(k)!), key())).toBe(original);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await loginAsDev(page, email);
  await page.goto(url());
  await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
  await page.evaluate(({ k, text }) => sessionStorage.setItem(k, JSON.stringify(text)), {
    k: `retroloop:chat-draft:v1:${JSON.stringify([userId, `${teamId}-other`, retroId])}`, text: "別チームの相談",
  });
  await page.getByRole("button", { name: "相談文の下書きを破棄" }).click();
  await page.reload();
  await expect(page.getByLabel("AIへの相談文")).toBeEnabled();
  await expect(page.getByLabel("AIへの相談文")).toHaveValue("");
});

test("通信失敗で戻った原文も再読み込み後に残る", async ({ page }) => {
  await page.route("**/api/chat", route => route.abort("failed"));
  await page.getByLabel("AIへの相談文").fill(original);
  await page.locator("[data-chat-send]").click();
  await expect(page.locator("[data-chat-error]")).toBeVisible();
  await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
  await page.reload();
  await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
});

test("中止で戻った原文も保持する", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/chat", async route => {
    await gate;
    await route.abort("failed").catch(() => {});
  });
  await page.getByLabel("AIへの相談文").fill(original);
  await page.locator("[data-chat-send]").click();
  try {
    await page.getByRole("button", { name: "応答を中止", exact: true }).click();
    await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
  } finally { release(); }
  await page.reload();
  await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
});

for (const raw of ["{broken", "42", '{"text":"unexpected"}']) {
  test(`壊れた保存値を無視して編集できる ${raw}`, async ({ page }) => {
    await page.evaluate(({ k, raw }) => sessionStorage.setItem(k, raw), { k: key(), raw });
    await page.reload();
    await expect(page.getByLabel("AIへの相談文")).toBeEnabled();
    await expect(page.getByLabel("AIへの相談文")).toHaveValue("");
    await page.getByLabel("AIへの相談文").fill(original);
    await page.reload();
    await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
  });
}

test("Storage例外でも編集でき、保持不能を案内する", async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Object.defineProperty(Storage.prototype, method, { configurable: true, value: () => { throw new Error("Storage unavailable"); } });
    }
  });
  await page.reload();
  await expect(page.getByLabel("AIへの相談文")).toBeEnabled();
  await page.getByLabel("AIへの相談文").fill(original);
  await expect(page.getByLabel("AIへの相談文")).toHaveValue(original);
  await expect(page.getByText("相談文の保持・破棄を完了できませんでした。", { exact: false })).toBeVisible();
});
