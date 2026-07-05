import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

const prisma = new PrismaClient();
const TEST_EMAIL = "e2e-notes@example.com";
const TEAM_NAME = "E2E付箋チーム";

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

// 付箋本文の段落（編集用textareaと区別するため paragraph ロールで絞る）
function noteText(page: Page, content: string) {
  return page.getByRole("paragraph").filter({ hasText: content });
}

// プレースホルダのテキストエリアと同じフォーム内の追加ボタンを押す
async function addNote(page: Page, placeholder: string, content: string) {
  const box = page.getByPlaceholder(placeholder);
  await box.fill(content);
  await box.locator("xpath=ancestor::form").getByRole("button", { name: "＋ 追加" }).click();
  await expect(noteText(page, content)).toBeVisible();
}

test("KPT付箋を追加・編集・削除できる", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);

  // チーム＆ふりかえりを用意
  await page.goto("/teams");
  await page.getByPlaceholder("例：開発チーム").fill(TEAM_NAME);
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/teams\/[^/]+$/);
  await page.getByPlaceholder("例：Sprint 12 振り返り").fill("付箋テスト回");
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/retros\/[^/]+$/);

  // 追加（各列）
  await addNote(page, "Keep を追加", "レビューが速い");
  await addNote(page, "Problem を追加", "デプロイ失敗が多い");
  await addNote(page, "Try を追加", "レビュー担当を輪番に");
  await page.screenshot({ path: "e2e/__screens__/kpt-added.png", fullPage: true });

  // 編集：Keep の付箋を書き換える
  const keepNote = page.locator("li", { hasText: "レビューが速い" });
  await keepNote.getByText("編集").click();
  await keepNote.getByRole("textbox").fill("レビューがとても速くなった");
  await keepNote.getByRole("button", { name: "保存" }).click();
  await expect(noteText(page, "レビューがとても速くなった")).toBeVisible();
  await expect(noteText(page, "レビューが速い")).toHaveCount(0);

  // 削除：Problem の付箋を消す
  const probNote = page.locator("li", { hasText: "デプロイ失敗が多い" });
  await probNote.getByRole("button", { name: "削除" }).click();
  await expect(noteText(page, "デプロイ失敗が多い")).toHaveCount(0);

  await page.screenshot({ path: "e2e/__screens__/kpt-after-edit-delete.png", fullPage: true });
});
