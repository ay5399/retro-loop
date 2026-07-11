import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

// 開発用ログイン（メールだけで即ログイン）の動作確認。
// - リンク/パスワードなしで /teams に入れる
// - 同じメールで再ログインしても User が重複しない
// - 本番モードでは devSignIn が無効（ここでは dev サーバ前提のため、UIが出ることのみ確認）

const prisma = new PrismaClient();
const EMAIL = `dev-login-${Date.now()}@example.test`;

test.afterAll(async () => {
  // このテストで作られた User と付随 Session を掃除
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (user) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

test("開発ログイン：メールだけでログインできる", async ({ page }) => {
  await loginAsDev(page, EMAIL);

  // /teams に到達し、認証済みUI（チーム作成など）が見える
  await expect(page).toHaveURL(/\/teams/);

  // User と Session が実際に作られている
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  expect(user).not.toBeNull();
  const sessions = await prisma.session.count({ where: { userId: user!.id } });
  expect(sessions).toBeGreaterThanOrEqual(1);
});

test("開発ログイン：同じメールで再ログインしても User は重複しない", async ({
  page,
}) => {
  await loginAsDev(page, EMAIL);
  await expect(page).toHaveURL(/\/teams/);

  const count = await prisma.user.count({ where: { email: EMAIL } });
  expect(count).toBe(1);
});
