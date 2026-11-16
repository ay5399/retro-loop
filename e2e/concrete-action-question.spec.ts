import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { loginAsDev } from "./helpers";

test("曖昧な宣言への質問後に本人が具体的行動を修正・保存・再表示する（モック）", async ({ page }) => {
  const prisma = new PrismaClient();
  const email = "e2e-concrete-action@example.com";
  const teamName = "E2E具体的行動の質問";
  const cleanup = async () => {
    await prisma.team.deleteMany({ where: { name: teamName } });
    await prisma.user.deleteMany({ where: { email } });
  };
  try {
    await cleanup();
    const self = await prisma.user.create({ data: { email } });
    const team = await prisma.team.create({ data: { name: teamName, memberships: { create: { userId: self.id } } } });
    const retro = await prisma.retrospective.create({ data: { teamId: team.id, name: "具体的行動を決める回" } });
    const problem = "レビュー待ちが長い";
    await prisma.note.create({ data: { retrospectiveId: retro.id, authorId: self.id, kind: "PROBLEM", content: problem } });
    const inputs = [
      "自分のProblemはレビュー待ちが長いことです。担当は私、日付は2026-11-23、行動は気をつけるです。",
      "自分のPRの依頼時刻と完了時刻を一件記録します。",
    ];
    const replies = [
      "自分で実行できる具体的な動作を一つ挙げると、何をしますか？",
      "保存前の確認案です。行動：自分のPRの依頼時刻と完了時刻を一件記録する。担当：私。日付：2026-11-23。まだ保存されていません。確認後にTry付箋へ追加してください。",
    ];
    let turns = 0;
    // Scripted replies exercise transport/UI/persistence, not model judgment.
    await page.route("**/api/chat", async route => {
      const body = route.request().postDataJSON();
      const users = body.messages.filter((m: { role: string }) => m.role === "user");
      expect(users).toHaveLength(turns + 1);
      expect(users.at(-1).parts).toEqual([{ type: "text", text: inputs[turns] }]);
      const reply = replies[turns++];
      expect(reply).toBeDefined();
      const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute({ writer }) {
        writer.write({ type: "start" });
        writer.write({ type: "text-start", id: "recurring" });
        writer.write({ type: "text-delta", id: "recurring", delta: reply });
        writer.write({ type: "text-end", id: "recurring" });
        writer.write({ type: "finish", finishReason: "stop" });
      } }) });
      await route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await loginAsDev(page, email);
    await page.goto(`/teams/${team.id}/retros/${retro.id}`);
    await page.getByLabel("自分のProblemから相談する").selectOption({ label: problem });
    await page.getByRole("button", { name: "相談文の下書きに追加" }).click();
    await page.locator("[data-chat-input]").fill(inputs[0]);
    await page.screenshot({ path: "e2e/__screens__/concrete-action-question-before.png", fullPage: true });
    const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
    for (let i = 0; i < inputs.length; i++) {
      await page.locator("[data-chat-input]").fill(inputs[i]);
      await page.locator("[data-chat-send]").click();
      await expect(page.locator("[data-ai-chat] li.justify-start")).toHaveCount(i + 1);
      await expect(page.locator("[data-ai-chat] li.justify-start").last()).toHaveText(replies[i]);
      await expect(page.locator("[data-chat-input]")).toBeEnabled();
      await expect(form.getByLabel("実行する行動")).toHaveValue("");
      await expect(form.getByLabel("実行する日付")).toHaveValue("");
      expect(await prisma.note.count({ where: { retrospectiveId: retro.id, kind: "TRY" } })).toBe(0);
    }
    expect(turns).toBe(2);
    expect(await prisma.note.count({ where: { retrospectiveId: retro.id, kind: "TRY" } })).toBe(0);
    await form.getByLabel("実行する行動").fill("自分のPRの依頼時刻と完了時刻を一件記録する");
    await form.getByLabel("実行する日付").fill("2026-11-23");
    await form.getByRole("button", { name: "保存内容を確認" }).click();
    await expect(form).toContainText("日付：2026-11-23");
    expect(await prisma.note.count({ where: { retrospectiveId: retro.id, kind: "TRY" } })).toBe(0);
    await form.getByRole("button", { name: "修正する" }).click();
    const action = "自分のPRの依頼時刻とレビュー開始時刻を一件記録する";
    await form.getByLabel("実行する行動").fill(action);
    await form.getByLabel("実行する日付").fill("2026-11-24");
    await form.getByRole("button", { name: "保存内容を確認" }).click();
    await expect(form).toContainText("担当：自分（ログイン中の本人）");
    await expect(form).toContainText("日付：2026-11-24");
    await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
    const saved = await prisma.note.findMany({ where: { retrospectiveId: retro.id, kind: "TRY" } });
    expect(saved).toHaveLength(1);
    expect(saved[0].authorId).toBe(self.id);
    expect(saved[0].content).toBe(`行動：${action}\n担当：自分（付箋の作成者）\n日付：2026-11-24`);
    await page.reload();
    await expect(page.locator('[data-lane="TRY"] [data-note-id]').filter({ hasText: action })).toHaveCount(1);
    await page.screenshot({ path: "e2e/__screens__/concrete-action-question-after.png", fullPage: true });
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
});
