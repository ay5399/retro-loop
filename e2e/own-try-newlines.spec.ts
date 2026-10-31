import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
const email = "e2e-own-try-newlines@example.com";
const teamName = "E2E本人Try改行チーム";
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
  const retro = await prisma.retrospective.create({ data: { teamId, name: "改行を保つ本人Try" } });
  retroId = retro.id;
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test("複数行の本人TryはFormData送信後もLFの本文を正確に保存する", async ({ page }) => {
  await loginAsDev(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  const action = "自分のPRにレビュー希望時刻を記載する\n\n朝会後にチームへ共有する";
  await form.getByLabel("実行する行動").fill(action);
  await form.getByLabel("実行する日付").fill("2026-11-07");
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
  await page.screenshot({ path: "e2e/__screens__/own-try-newlines-before.png", fullPage: true });
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
  const notes = await prisma.note.findMany({ where: { retrospectiveId: retroId, kind: "TRY" } });
  expect(notes).toHaveLength(1);
  expect(notes[0].authorId).toBe(userId);
  expect(notes[0].content).toBe(`行動：${action}\n担当：自分（付箋の作成者）\n日付：2026-11-07`);
  expect(notes[0].content).not.toContain("\r");
  await page.reload();
  const note = page.locator('[data-lane="TRY"] [data-note-id]');
  await expect(note).toHaveCount(1);
  await expect(note.locator("p")).toHaveText(notes[0].content);
  await page.screenshot({ path: "e2e/__screens__/own-try-newlines-after.png", fullPage: true });
});
