import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

const prisma = new PrismaClient();
const TEST_EMAIL = "e2e-reflect@example.com";
const TEAM_NAME = "E2E問い返しチーム";

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

async function addNote(page: Page, placeholder: string, content: string) {
  const box = page.getByPlaceholder(placeholder);
  await box.fill(content);
  await box.locator("xpath=ancestor::form").getByRole("button", { name: "＋ 追加" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: content })).toBeVisible();
}

async function createRetro(page: Page, name: string) {
  await page.getByPlaceholder("例：Sprint 12 振り返り").fill(name);
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/retros\/[^/]+$/);
}

test("AI問い返し: 実行→採用→次の回で自動判定（ループが閉じる）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);

  // チーム作成
  await page.goto("/teams");
  await page.getByPlaceholder("例：開発チーム").fill(TEAM_NAME);
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/teams\/[^/]+$/);
  const teamUrl = page.url();

  // 1回目のふりかえり
  await createRetro(page, "Sprint 1 振り返り");
  await addNote(page, "Problem を追加", "リリース直前にバグが多い");

  // AI問い返しを実行 → 案が出る
  await page.getByRole("button", { name: "AIに問い返してもらう" }).click();
  await expect(page.getByText("改善アクション案")).toBeVisible();
  await expect(page.getByText("形骸化のチェック")).toBeVisible();

  // 案を採用 → 今回のアクションに載る（次回の判定対象）
  await page.getByRole("button", { name: "採用" }).first().click();
  await expect(page.getByText("今回のアクション")).toBeVisible();

  // 2回目のふりかえり（前回=Sprint 1）
  await page.goto(teamUrl);
  await createRetro(page, "Sprint 2 振り返り");
  await expect(page.getByText("前回：Sprint 1 振り返り")).toBeVisible();
  await addNote(page, "Keep を追加", "バグが減った");

  // AI問い返し → 前回アクションが自動判定される（＝ループが閉じる）
  await page.getByRole("button", { name: "AIに問い返してもらう" }).click();
  await expect(page.getByText("前回アクションの判定")).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/ai-reflection.png", fullPage: true });
});
