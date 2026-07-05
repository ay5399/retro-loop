import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

const prisma = new PrismaClient();
const TEST_EMAIL = "e2e-teams@example.com";
const TEAM_NAME = "E2Eテストチーム";

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

test("ログインしてチームを作成できる", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);

  // 空状態
  await page.goto("/teams");
  await expect(page.getByText("まだチームがありません。")).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/teams-empty.png", fullPage: true });

  // 作成 → 詳細ページに遷移
  await page.getByPlaceholder("例：開発チーム").fill(TEAM_NAME);
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/teams\/[^/]+$/);
  await expect(page.getByRole("heading", { name: TEAM_NAME })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/team-detail.png", fullPage: true });

  // 一覧に出る
  await page.goto("/teams");
  await expect(page.getByRole("link", { name: new RegExp(TEAM_NAME) })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/teams-list.png", fullPage: true });
});

test("未ログインで /teams はサインインへリダイレクトされる", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/teams");
  await expect(page).toHaveURL(/\/signin/);
});
