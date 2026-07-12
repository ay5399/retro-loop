import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDev } from "./helpers";

// 参加リンク（固定URL）＋承認制フローの実ブラウザ検証。
// 承認ON(申請→承認)／承認OFF(即参加)／却下／リンク再生成／未ログイン復帰 を通しで確認する。
const prisma = new PrismaClient();

const EMAIL_A = "e2e-join-a@example.com"; // オーナー（承認する側）
const EMAIL_B = "e2e-join-b@example.com"; // 承認される申請者
const EMAIL_C = "e2e-join-c@example.com"; // 承認OFFで即参加する人
const EMAIL_D = "e2e-join-d@example.com"; // 却下される申請者
const EMAIL_CB = "e2e-join-cb@example.com"; // 未ログイン→callbackで戻る人
const ALL_EMAILS = [EMAIL_A, EMAIL_B, EMAIL_C, EMAIL_D, EMAIL_CB];
const TEAM_NAME = "E2E参加リンクチーム";

let teamId = "";
let userAId = "";

async function cleanup() {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
}

// その時点の joinToken を DB から取得（再生成テストの後でも正しい値を使う）
async function currentToken(): Promise<string> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  return team.joinToken;
}

test.beforeAll(async () => {
  await cleanup();
  const userA = await prisma.user.create({ data: { email: EMAIL_A, name: "Join A" } });
  userAId = userA.id;
  const team = await prisma.team.create({ data: { name: TEAM_NAME } });
  teamId = team.id;
  await prisma.membership.create({ data: { userId: userA.id, teamId } });
});

// 各テストは「承認ON・申請/他メンバーなし」の初期状態から始める
test.beforeEach(async () => {
  await prisma.team.update({ where: { id: teamId }, data: { joinApproval: true } });
  await prisma.joinRequest.deleteMany({ where: { teamId } });
  await prisma.membership.deleteMany({ where: { teamId, userId: { not: userAId } } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("承認ON：申請 → メンバーが承認 → 参加できる", async ({ page }) => {
  const token = await currentToken();

  // B が参加を申請
  await loginAsDev(page, EMAIL_B);
  await page.goto(`/join/${token}`);
  await page.locator("[data-join-request]").click();
  await expect(page.locator("[data-join-pending]")).toBeVisible();

  // まだメンバーではない（PENDING）
  const userB = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_B } });
  await expect(async () => {
    const req = await prisma.joinRequest.findUnique({
      where: { teamId_userId: { teamId, userId: userB.id } },
    });
    expect(req?.status).toBe("PENDING");
  }).toPass({ timeout: 40_000 });
  expect(
    await prisma.membership.findUnique({
      where: { userId_teamId: { userId: userB.id, teamId } },
    }),
  ).toBeNull();

  // A が承認
  await page.context().clearCookies();
  await loginAsDev(page, EMAIL_A);
  await page.goto(`/teams/${teamId}`);
  const row = page.locator(`[data-request-id]`).filter({ hasText: EMAIL_B });
  await expect(row).toHaveCount(1, { timeout: 40_000 });
  await row.locator("[data-approve]").click();

  // B がメンバーになり、申請は APPROVED
  await expect(async () => {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: userB.id, teamId } },
    });
    expect(membership).not.toBeNull();
    const req = await prisma.joinRequest.findUnique({
      where: { teamId_userId: { teamId, userId: userB.id } },
    });
    expect(req?.status).toBe("APPROVED");
  }).toPass({ timeout: 40_000 });
});

test("承認OFF：トグルを切ると、リンクを踏むだけで即参加する", async ({ page }) => {
  const token = await currentToken();

  // A が承認を「不要」に切り替え
  await loginAsDev(page, EMAIL_A);
  await page.goto(`/teams/${teamId}`);
  await page.locator("[data-toggle-approval]").click();
  await expect(async () => {
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    expect(team.joinApproval).toBe(false);
  }).toPass({ timeout: 40_000 });

  // C はリンクを踏んで「参加する」で即メンバー（承認待ちを経ない）
  await page.context().clearCookies();
  await loginAsDev(page, EMAIL_C);
  await page.goto(`/join/${token}`);
  await page.locator("[data-join-request]").click();
  await page.waitForURL(`**/teams/${teamId}`);

  const userC = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_C } });
  await expect(async () => {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: userC.id, teamId } },
    });
    expect(membership).not.toBeNull();
  }).toPass({ timeout: 40_000 });
});

test("承認ON：却下すると参加できない", async ({ page }) => {
  const token = await currentToken();

  await loginAsDev(page, EMAIL_D);
  await page.goto(`/join/${token}`);
  await page.locator("[data-join-request]").click();
  await expect(page.locator("[data-join-pending]")).toBeVisible();

  const userD = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_D } });

  // A が却下
  await page.context().clearCookies();
  await loginAsDev(page, EMAIL_A);
  await page.goto(`/teams/${teamId}`);
  const row = page.locator(`[data-request-id]`).filter({ hasText: EMAIL_D });
  await expect(row).toHaveCount(1, { timeout: 40_000 });
  await row.locator("[data-reject]").click();

  // D はメンバーにならず、申請は REJECTED
  await expect(async () => {
    const req = await prisma.joinRequest.findUnique({
      where: { teamId_userId: { teamId, userId: userD.id } },
    });
    expect(req?.status).toBe("REJECTED");
  }).toPass({ timeout: 40_000 });
  expect(
    await prisma.membership.findUnique({
      where: { userId_teamId: { userId: userD.id, teamId } },
    }),
  ).toBeNull();
});

test("リンク再生成すると旧リンクは無効になる", async ({ page }) => {
  const oldToken = await currentToken();

  await loginAsDev(page, EMAIL_A);
  await page.goto(`/teams/${teamId}`);
  await page.locator("[data-regenerate-link]").click();

  // トークンが変わる
  await expect(async () => {
    const newToken = await currentToken();
    expect(newToken).not.toBe(oldToken);
  }).toPass({ timeout: 40_000 });

  // 旧リンクは「無効です」表示（別ユーザーで踏む）
  await page.context().clearCookies();
  await loginAsDev(page, EMAIL_CB);
  await page.goto(`/join/${oldToken}`);
  await expect(page.getByText("リンクが無効です")).toBeVisible();
});

test("未ログインで参加リンクを踏むとログインへ誘導され、ログイン後に参加ページへ戻る", async ({
  page,
}) => {
  const token = await currentToken();

  await page.context().clearCookies();
  await page.goto(`/join/${token}`);

  // callbackUrl 付きでログインへ
  await page.waitForURL(/\/signin\?callbackUrl=/);
  expect(decodeURIComponent(page.url())).toContain(`/join/${token}`);

  // 開発ログイン → 参加ページに戻る
  await page.getByPlaceholder("dev@example.com").fill(EMAIL_CB);
  await page.getByRole("button", { name: "開発ログイン（リンク不要）" }).click();
  await page.waitForURL(`**/join/${token}`);
  await expect(page.locator("[data-join-request]")).toBeVisible();
});
