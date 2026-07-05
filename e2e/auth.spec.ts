import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

const prisma = new PrismaClient();
const TEST_EMAIL = "e2e-auth@example.com";

test.afterAll(async () => {
  // テストで作られたユーザーを掃除
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

test("未ログイン時はログイン導線が出る", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "ログイン" })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/home-logged-out.png", fullPage: true });
});

test("マジックリンクでログインできる", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);

  await page.goto("/");
  await expect(page.getByText(TEST_EMAIL)).toBeVisible();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await expect(page.getByRole("link", { name: /チームへ進む/ })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/home-logged-in.png", fullPage: true });
});
