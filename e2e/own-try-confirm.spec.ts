import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
const email = "e2e-own-try@example.com";
const teamName = "E2E本人Try確認チーム";
let teamId: string;
let retroId: string;
let userId: string;

test.beforeAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email } });
  userId = user.id;
  const team = await prisma.team.create({ data: { name: teamName } });
  teamId = team.id;
  await prisma.membership.create({ data: { teamId, userId } });
  const retro = await prisma.retrospective.create({ data: { teamId, name: "本人が決めたTry" } });
  retroId = retro.id;
  await prisma.note.create({ data: { retrospectiveId: retroId, authorId: userId, kind: "PROBLEM", content: "レビュー待ちが長い" } });
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test("本人が行動と日付を確認・修正し、失敗と待機を経てTryを一件保存する", async ({ page }) => {
  await loginAsDev(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await page.getByLabel("自分のProblemから相談する").selectOption({ label: "レビュー待ちが長い" });
  await page.getByRole("button", { name: "相談文の下書きに追加" }).click();
  await page.locator("[data-chat-send]").click();
  await expect(page.locator("[data-ai-chat] li.justify-start")).not.toHaveCount(0);
  await expect(page.locator("[data-chat-input]")).toBeEnabled();
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  const action = form.getByLabel("実行する行動");
  const date = form.getByLabel("実行する日付");
  const confirm = form.getByRole("button", { name: "保存内容を確認" });
  await expect(action).toHaveValue("");
  await expect(date).toHaveValue("");
  await expect(confirm).toBeDisabled();
  await action.fill("   ");
  await date.fill("2026-11-02");
  await expect(confirm).toBeDisabled();
  await action.fill("レビューの待ち時間を調べる");
  await date.fill("");
  await expect(confirm).toBeDisabled();
  await date.fill("2026-11-02");
  await confirm.click();
  await expect(form).toContainText("担当：自分（ログイン中の本人）");
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
  await page.screenshot({ path: "e2e/__screens__/own-try-confirm-before.png", fullPage: true });
  await form.getByRole("button", { name: "修正する" }).click();
  await expect(action).toHaveValue("レビューの待ち時間を調べる");
  await action.fill("レビュー依頼時刻と完了時刻を一件記録する");
  await date.fill("2026-11-03");
  await confirm.click();

  const url = page.url();
  await page.route(url, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await route.abort("failed");
    else await route.continue();
  });
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("入力内容は保持しています");
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
  await form.getByRole("button", { name: "修正する" }).click();
  await expect(action).toHaveValue("レビュー依頼時刻と完了時刻を一件記録する");
  await expect(date).toHaveValue("2026-11-03");
  await confirm.click();
  await page.unroute(url);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let posts = 0;
  await page.route(url, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      posts++;
      await gate;
    }
    await route.continue();
  });
  try {
    await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
    const pending = form.getByRole("button", { name: "保存中…", exact: true });
    await expect(pending).toBeDisabled();
    await expect(form.getByRole("button", { name: "修正する" })).toBeDisabled();
    await expect(form.getByRole("status")).toHaveText("Try付箋を保存しています。");
    await expect.poll(() => posts).toBe(1);
    const bounds = await pending.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.keyboard.press("Enter");
    expect(posts).toBe(1);
    expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
  } finally {
    release();
  }
  await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
  const content = "行動：レビュー依頼時刻と完了時刻を一件記録する\n担当：自分（付箋の作成者）\n日付：2026-11-03";
  const notes = await prisma.note.findMany({ where: { retrospectiveId: retroId, kind: "TRY" } });
  expect(notes).toHaveLength(1);
  expect(notes[0].authorId).toBe(userId);
  expect(notes[0].content).toBe(content);
  await page.reload();
  await expect(page.locator('[data-lane="TRY"] [data-note-id]').filter({ hasText: "レビュー依頼時刻と完了時刻を一件記録する" })).toHaveCount(1);
  expect(posts).toBe(1);
  await page.screenshot({ path: "e2e/__screens__/own-try-confirm-after.png", fullPage: true });
});
