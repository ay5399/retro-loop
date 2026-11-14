import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
const email = "e2e-file-input@example.com";
const teamName = "E2E未対応添付拒否";
let teamId: string;
let retroId: string;
const message = { id: "question", role: "user", parts: [{ type: "text", text: "待ち時間を調べたい" }] };

test.beforeAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email } });
  const team = await prisma.team.create({ data: { name: teamName } });
  teamId = team.id;
  await prisma.membership.create({ data: { teamId, userId: user.id } });
  const retro = await prisma.retrospective.create({ data: { teamId, name: "相談を修正して続ける" } });
  retroId = retro.id;
  await prisma.note.create({ data: { retrospectiveId: retroId, authorId: user.id, kind: "PROBLEM", content: "レビュー待ちが長い" } });
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test("有効URLの添付を全履歴から拒否し文章の相談を受理する", async ({ page, request, baseURL }) => {
  expect(baseURL).toBeDefined();
  const valid = { teamId, retroId, messages: [message] };
  expect((await request.post("/api/chat", { data: valid })).status()).toBe(401);
  await loginAsDev(page, email);
  for (const type of ["file", "reasoning-file"]) {
    for (const role of ["user", "assistant"]) {
      for (const url of [`${baseURL}/api/chat`, "data:text/plain;base64,ZHVtbXk="]) {
        const response = await page.request.post("/api/chat", { data: {
          ...valid,
          messages: [{ id: "attachment", role, parts: [
            { type: "text", text: "架空の相談" }, { type, mediaType: "text/plain", url },
          ] }, message],
        } });
        expect(response.status()).toBe(400);
        expect(await response.text()).toBe("添付ファイルには対応していません。文章で相談してください。");
      }
    }
  }
  const response = await page.request.post("/api/chat", { data: valid });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('"type":"text-delta"');
});

test("添付を拒否した後も本人の原文を再送しTryを一件保存できる", async ({ page, baseURL }) => {
  expect(baseURL).toBeDefined();
  await loginAsDev(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await page.getByLabel("自分のProblemから相談する").selectOption({ label: "レビュー待ちが長い" });
  await page.getByRole("button", { name: "相談文の下書きに追加" }).click();
  const input = page.locator("[data-chat-input]");
  const draft = `  ${await input.inputValue()}\nまず待ち時間を調べたいです。\n  `;
  await input.fill(draft);
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    body.messages[0].parts.push({ type: "file", mediaType: "text/plain", url: `${baseURL}/api/chat` });
    await route.continue({ postData: JSON.stringify(body) });
  }, { times: 1 });
  const rejected = page.waitForResponse((response) => response.url().endsWith("/api/chat") && response.status() === 400);
  await page.locator("[data-chat-send]").click();
  await rejected;
  await expect(page.locator("[data-chat-error]")).toContainText("相談文を入力欄に戻しました");
  await expect(input).toHaveValue(draft);
  await page.screenshot({ path: "e2e/__screens__/chat-file-input-before.png", fullPage: true });
  await input.fill(`${draft.trim()}\nレビュー依頼と完了の時刻を一件記録します。`);
  await page.locator("[data-chat-send]").click();
  await expect(page.locator("[data-ai-chat] li.justify-start")).not.toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect(page.locator("[data-chat-error]")).toHaveCount(0);
  const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
  await form.getByLabel("実行する行動").fill("レビュー依頼と完了の時刻を一件記録する");
  await form.getByLabel("実行する日付").fill("2026-11-04");
  await form.getByRole("button", { name: "保存内容を確認" }).click();
  await expect(form).toContainText("担当：自分（ログイン中の本人）");
  await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
  await page.reload();
  const saved = page.locator('[data-lane="TRY"] [data-note-id]');
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText("レビュー依頼と完了の時刻を一件記録する");
  await expect(saved).toContainText("2026-11-04");
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind: "TRY" } })).toBe(1);
  await page.screenshot({ path: "e2e/__screens__/chat-file-input-after.png", fullPage: true });
});
