import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

const prisma = new PrismaClient();
const TEST_EMAIL = "e2e-retro@example.com";
const TEAM_NAME = "E2Eふりかえりチーム";

test.afterAll(async () => {
  // Team削除で Retrospective も cascade 削除される
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

test("ふりかえりを作成でき、前回が自動でリンクされる", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);

  // チーム作成
  await page.goto("/teams");
  await page.getByPlaceholder("例：開発チーム").fill(TEAM_NAME);
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/teams\/[^/]+$/);

  // 1回目のふりかえり → 前回なし
  await page.getByPlaceholder("例：Sprint 12 振り返り").fill("Sprint 1 振り返り");
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/retros\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Sprint 1 振り返り" })).toBeVisible();
  await expect(page.getByText("最初のふりかえり（前回なし）")).toBeVisible();

  // チームに戻って2回目 → 前回=Sprint 1
  await page.getByRole("link", { name: new RegExp(TEAM_NAME) }).click();
  await page.waitForURL(/\/teams\/[^/]+$/);
  await page.getByPlaceholder("例：Sprint 12 振り返り").fill("Sprint 2 振り返り");
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/retros\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Sprint 2 振り返り" })).toBeVisible();
  await expect(page.getByText("前回：Sprint 1 振り返り")).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/retro-detail.png", fullPage: true });

  // 一覧に2件出る
  await page.getByRole("link", { name: new RegExp(TEAM_NAME) }).click();
  await page.waitForURL(/\/teams\/[^/]+$/);
  await expect(page.getByRole("link", { name: "Sprint 1 振り返り" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sprint 2 振り返り" })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/retro-list.png", fullPage: true });
});
