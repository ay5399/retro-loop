import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

const prisma = new PrismaClient();
const email = "e2e-input-validation@example.com";
const teamName = "E2E相談入力検証";
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

test("実APIで入力構造・system・変換エラーを拒否し正規の履歴を受理する", async ({ page, request }) => {
  const valid = { teamId, retroId, messages: [message] };
  expect((await request.post("/api/chat", { data: valid })).status()).toBe(401);
  await loginAsDev(page, email);
  const invalid = [
    null, [], { ...valid, teamId: 123 }, { ...valid, retroId: {} },
    { ...valid, messages: {} }, { ...valid, messages: Array(31).fill(message) },
    { ...valid, messages: [null] },
    ...["system", "tool", "invalid"].map((role) => ({ ...valid, messages: [{ ...message, role }] })),
    { ...valid, messages: [{ ...message, id: 1 }] },
    { ...valid, messages: [{ ...message, parts: [{ type: "text", text: 1 }] }] },
    { ...valid, messages: [{ ...message, parts: null }] },
    { ...valid, messages: [{ ...message, parts: [{ type: "file", mediaType: "text/plain", url: "invalid URL" }] }] },
  ];
  for (const data of invalid) {
    expect((await page.request.post("/api/chat", { data })).status()).toBe(400);
  }
  expect((await page.request.post("/api/chat", { data: "{" , headers: { "content-type": "application/json" } })).status()).toBe(400);
  expect((await page.request.post("/api/chat", { data: { ...valid, messages: [{ ...message, parts: [{ type: "text", text: "a".repeat(32_001) }] }] } })).status()).toBe(413);
  expect((await page.request.post("/api/chat", { data: { ...valid, teamId: "not-a-member-team" } })).status()).toBe(403);
  const histories = [
    [message],
    [message, { id: "answer", role: "assistant", parts: [{ type: "text", text: "何を調べますか？" }] }, { ...message, id: "followup" }],
    [message, { id: "tool-answer", role: "assistant", parts: [
      { type: "step-start" },
      { type: "tool-summarizeRetro", toolCallId: "summary", state: "output-available", input: {}, output: { note: "架空の結果" } },
      { type: "text", text: "本人の行動を教えてください。" },
    ] }, { ...message, id: "after-tool" }],
    [message, { id: "stopped-answer", role: "assistant", parts: [{ type: "text", text: "途中", state: "streaming" }] }, { ...message, id: "resend" }],
  ];
  for (const messages of histories) {
    const response = await page.request.post("/api/chat", { data: { ...valid, messages } });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('"type":"text-delta"');
  }
});

test("不正要求を拒否した後も本人の原文を修正再送しTryを一件保存できる", async ({ page }) => {
  await loginAsDev(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await page.getByLabel("自分のProblemから相談する").selectOption({ label: "レビュー待ちが長い" });
  await page.getByRole("button", { name: "相談文の下書きに追加" }).click();
  const input = page.locator("[data-chat-input]");
  const draft = `  ${await input.inputValue()}\nまず待ち時間を調べたいです。\n  `;
  await input.fill(draft);
  await page.screenshot({ path: "e2e/__screens__/chat-input-validation-before.png", fullPage: true });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    body.messages[0].role = "system";
    await route.continue({ postData: JSON.stringify(body) });
  }, { times: 1 });
  const rejected = page.waitForResponse((response) => response.url().endsWith("/api/chat") && response.status() === 400);
  await page.locator("[data-chat-send]").click();
  await rejected;
  await expect(page.locator("[data-chat-error]")).toContainText("相談文を入力欄に戻しました");
  await expect(input).toHaveValue(draft);
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
  await page.screenshot({ path: "e2e/__screens__/chat-input-validation-after.png", fullPage: true });
});
