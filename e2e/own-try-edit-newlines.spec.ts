import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
const email = "e2e-own-try-edit-newlines@example.com";
const teamName = "E2E本人Try編集改行チーム";
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
  const retro = await prisma.retrospective.create({ data: { teamId, name: "本人Tryの編集と再保存" } });
  retroId = retro.id;
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test("本人Tryを編集・再保存しても空行とLF、担当・日付・作成者を維持する", async ({ page }) => {
  await loginAsDev(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  await form.getByLabel("実行する行動").fill("自分のPRにレビュー希望時刻を書く");
  await form.getByLabel("実行する日付").fill("2026-11-07");
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
  const notes = await prisma.note.findMany({ where: { retrospectiveId: retroId, kind: "TRY" } });
  expect(notes).toHaveLength(1);
  const saved = notes[0];
  const note = page.locator(`[data-note-id="${saved.id}"]`);
  const expected = "行動：自分のPRにレビュー希望時刻を書く\n\n朝会後にチームへ共有する\n担当：自分（付箋の作成者）\n日付：2026-11-07";
  await note.getByText("編集", { exact: true }).click();
  await note.getByRole("textbox").fill(expected);
  await expect(note.getByRole("textbox")).toHaveValue(expected);
  await page.screenshot({ path: "e2e/__screens__/own-try-edit-newlines-input.png", fullPage: true });
  await note.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(async () => (await prisma.note.findUniqueOrThrow({ where: { id: saved.id } })).content).toBe(expected);
  const updated = await prisma.note.findUniqueOrThrow({ where: { id: saved.id } });
  expect(updated.content).not.toContain("\r");
  expect(updated.authorId).toBe(userId);
  expect(updated.kind).toBe("TRY");
  expect(updated.retrospectiveId).toBe(retroId);
  await page.reload();
  // textContent preserves line endings and blank lines; toHaveText normalizes whitespace.
  expect(await note.locator("p").textContent()).toBe(expected);
  await page.screenshot({ path: "e2e/__screens__/own-try-edit-newlines-reloaded.png", fullPage: true });

  const singleLine = "自分のPRに希望時刻を書く（本人が修正）";
  await note.getByText("編集", { exact: true }).click();
  await note.getByRole("textbox").fill(singleLine);
  await note.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(async () => (await prisma.note.findUniqueOrThrow({ where: { id: saved.id } })).content).toBe(singleLine);
  await page.reload();
  expect(await note.locator("p").textContent()).toBe(singleLine);
  expect((await prisma.note.findUniqueOrThrow({ where: { id: saved.id } })).authorId).toBe(userId);
});
