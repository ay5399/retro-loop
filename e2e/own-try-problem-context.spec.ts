import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
const email = "e2e-problem-context@example.com";
const otherEmail = "e2e-problem-context-other@example.com";
const teamName = "E2E元Problem文脈";
let teamId: string;
let retroId: string;
let userId: string;
let otherId: string;
let firstId: string;
let secondId: string;
const first = "レビュー待ちが長い";
const second = "依頼の優先度が伝わらない\n急ぎか判断できない";
const action = "自分のレビュー依頼に優先度を一件記す";

test("元Problemだけ選んだ下書きも復元し、破棄できる", async ({ page }) => {
  await loginAsDev(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  await form.getByLabel("元Problem（任意）").selectOption(secondId);
  await expect(form.locator("[data-own-try-draft-notice]")).toContainText("一時保持");
  await page.reload();
  await expect(form.getByLabel("元Problem（任意）")).toHaveValue(secondId);
  await expect(form.getByLabel("実行する行動")).toHaveValue("");
  await expect(form.getByLabel("実行する日付")).toHaveValue("");
  await expect(form.getByRole("button", { name: "保存内容を確認" })).toBeDisabled();
  await form.getByRole("button", { name: "下書きを破棄", exact: true }).click();
  await page.reload();
  await expect(form.getByLabel("元Problem（任意）")).toHaveValue("");
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
});

test.beforeEach(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
  userId = (await prisma.user.create({ data: { email } })).id;
  otherId = (await prisma.user.create({ data: { email: otherEmail } })).id;
  teamId = (await prisma.team.create({ data: { name: teamName } })).id;
  await prisma.membership.createMany({ data: [{ teamId, userId }, { teamId, userId: otherId }] });
  retroId = (await prisma.retrospective.create({ data: { teamId, name: "元Problemを残す" } })).id;
  firstId = (await prisma.note.create({ data: { retrospectiveId: retroId, authorId: userId, kind: "PROBLEM", content: first } })).id;
  secondId = (await prisma.note.create({ data: { retrospectiveId: retroId, authorId: userId, kind: "PROBLEM", content: second } })).id;
});

test.afterEach(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
});
test.afterAll(async () => { await prisma.$disconnect(); });

async function open(page: Page) {
  await loginAsDev(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  await form.getByLabel("実行する行動").fill(action);
  await form.getByLabel("実行する日付").fill("2026-11-10");
  return form;
}

test("元Problemを明示選択・修正し、復元後に再確認して一件保存・再表示する", async ({ page }) => {
  const form = await open(page);
  await expect(form.getByLabel("元Problem（任意）")).toHaveValue("");
  await page.screenshot({ path: "e2e/__screens__/own-try-problem-context-before.png", fullPage: true });
  await form.getByLabel("元Problem（任意）").selectOption(firstId);
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await expect(form).toContainText(`元Problem：${first}`);
  await form.getByRole("button", { name: "修正する" }).click();
  await form.getByLabel("元Problem（任意）").selectOption(secondId);
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await expect(form).toContainText(`元Problem：${second}`);
  await page.reload();
  await expect(form.getByLabel("元Problem（任意）")).toHaveValue(secondId);
  await expect(form.getByLabel("実行する行動")).toHaveValue(action);
  await expect(form.getByLabel("実行する日付")).toHaveValue("2026-11-10");
  await expect(form.getByRole("button", { name: "Try付箋として保存", exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
  const saved = await prisma.note.findMany({ where: { retrospectiveId: retroId, kind: "TRY" } });
  expect(saved).toHaveLength(1);
  expect(saved[0].authorId).toBe(userId);
  expect(saved[0].content).toBe(`行動：${action}\n担当：自分（付箋の作成者）\n日付：2026-11-10\n元Problem：${second}`);
  await page.reload();
  const note = page.locator('[data-lane="TRY"] [data-note-id]');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText(saved[0].content);
  await expect(form.getByLabel("元Problem（任意）")).toHaveValue("");
  await page.screenshot({ path: "e2e/__screens__/own-try-problem-context-after.png", fullPage: true });
});

for (const change of ["edit", "delete"] as const) {
  test(`確認後の元Problemの${change}を検知し、入力保持・再確認する`, async ({ page }) => {
    const form = await open(page);
    await form.getByLabel("元Problem（任意）").selectOption(firstId);
    await form.getByRole("button", { name: "保存内容を確認" }).click();
    if (change === "edit") await prisma.note.update({ where: { id: firstId }, data: { content: "レビュー依頼の通知に気付かない" } });
    else await prisma.note.delete({ where: { id: firstId } });
    await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("選び直して保存内容を再確認");
    await expect(form.getByLabel("実行する行動")).toHaveValue(action);
    await expect(form.getByLabel("実行する日付")).toHaveValue("2026-11-10");
    expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(0);
    await page.reload();
    await expect(form.getByLabel("元Problem（任意）")).toHaveValue(firstId);
    await form.getByLabel("元Problem（任意）").selectOption(secondId);
    await form.getByRole("button", { name: "保存内容を確認" }).click();
    await expect(form).toContainText(`元Problem：${second}`);
    await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
    expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(1);
  });
}

for (const invalid of ["other-author", "other-retro", "other-team", "keep"] as const) {
  test(`送信IDを${invalid}へ改変しても保存を拒否する`, async ({ page }) => {
    const form = await open(page);
    await form.getByLabel("元Problem（任意）").selectOption(firstId);
    await form.getByRole("button", { name: "保存内容を確認" }).click();
    let targetRetro = retroId;
    if (invalid === "other-retro" || invalid === "other-team") {
      const targetTeam = invalid === "other-team" ? (await prisma.team.create({ data: { name: teamName } })).id : teamId;
      targetRetro = (await prisma.retrospective.create({ data: { teamId: targetTeam, name: "別回" } })).id;
    }
    const target = await prisma.note.create({ data: { retrospectiveId: targetRetro,
      authorId: invalid === "other-author" ? otherId : userId,
      kind: invalid === "keep" ? "KEEP" : "PROBLEM", content: first } });
    let changed = 0;
    await page.route(page.url(), async route => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        const body = route.request().postData()!;
        expect(body).toContain(firstId);
        changed++;
        await route.continue({ postData: body.replaceAll(firstId, target.id) });
      } else await route.continue();
    });
    await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("選び直して保存内容を再確認");
    expect(changed).toBe(1);
    await expect(form.getByLabel("実行する行動")).toHaveValue(action);
    expect(await prisma.note.count({ where: { retrospectiveId: { in: [retroId, targetRetro] }, kind: "TRY" } })).toBe(0);
  });
}

test("未選択保存は従来の本文を維持する", async ({ page }) => {
  const form = await open(page);
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await expect(form).toContainText("元Problem：記録しない");
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
  const saved = await prisma.note.findMany({ where: { retrospectiveId: retroId, kind: "TRY" } });
  expect(saved).toHaveLength(1);
  expect(saved[0].content).toBe(`行動：${action}\n担当：自分（付箋の作成者）\n日付：2026-11-10`);
});
