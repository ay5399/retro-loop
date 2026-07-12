import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

// チーム招待フロー（バックログH）の実ブラウザ検証。
// 招待作成→受諾（多人数）／取り消し／期限切れリダイレクトを通しで確認する。
const prisma = new PrismaClient();

const EMAIL_A = "e2e-invite-a@example.com"; // 招待する側（チームメンバー）
const EMAIL_B = "e2e-invite-b@example.com"; // 招待され受諾する側
const EMAIL_C = "e2e-invite-c@example.com"; // 期限切れ招待を踏む側
const EMAIL_REVOKE = "e2e-invite-revoke@example.com"; // 取り消しテスト用（受諾はしない）
const EMAIL_CB = "e2e-invite-callback@example.com"; // 未ログイン→callbackで招待へ戻る検証用
const ALL_EMAILS = [EMAIL_A, EMAIL_B, EMAIL_C, EMAIL_REVOKE, EMAIL_CB];
const TEAM_NAME = "E2E招待チーム";

let teamId = "";
let userAId = "";

// テストで生成される User / Team（および連鎖する Membership / Invitation）を掃除する。
async function cleanup() {
  // Team 削除で Membership / Invitation は onDelete: Cascade で消える
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
}

test.beforeAll(async () => {
  await cleanup();
  const userA = await prisma.user.create({ data: { email: EMAIL_A, name: "E2E Invite A" } });
  userAId = userA.id;
  const team = await prisma.team.create({ data: { name: TEAM_NAME } });
  teamId = team.id;
  await prisma.membership.create({ data: { userId: userA.id, teamId } });
});

// 各テストは「保留中の招待なし」の状態から始める（B/C 宛の残骸を消す）。
test.beforeEach(async () => {
  await prisma.invitation.deleteMany({ where: { teamId } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("招待を作成し、別ユーザーが受諾してメンバーになる", async ({ page }) => {
  // --- userA として招待を作成 ---
  await loginViaMagicLink(page, EMAIL_A);
  await page.goto(`/teams/${teamId}`);

  await page.locator("[data-invite-email-input]").fill(EMAIL_B);
  await page.locator("[data-invite-submit]").click();

  // 保留中の招待に受諾リンク（data-invite-link）が現れる
  const inviteLinkBtn = page.locator("[data-invite-link]");
  await expect(inviteLinkBtn).toHaveCount(1);
  const linkFromUi = await inviteLinkBtn.getAttribute("data-invite-link");
  expect(linkFromUi).toContain(`/invite/`);

  // 保留中に招待された相手のメールが出る
  await expect(page.getByText(EMAIL_B)).toBeVisible();

  // 保留中の招待リンクが見える状態でスクショ
  await page.screenshot({ path: "e2e/__screens__/invite.png", fullPage: true });

  // DB: (email=B, teamId) の Invitation が 1 件（初回サーバアクションのコールドコンパイルを見込み長め）
  let token = "";
  await expect(async () => {
    const invites = await prisma.invitation.findMany({
      where: { teamId, email: EMAIL_B },
    });
    expect(invites).toHaveLength(1);
    token = invites[0].token;
  }).toPass({ timeout: 40_000 });
  expect(token).toBeTruthy();
  // UI のリンクと DB のトークンが一致
  expect(linkFromUi).toContain(token);

  // --- userB として受諾（同ページで cookie をクリアして別ユーザーに切り替え）---
  await page.context().clearCookies();
  await loginViaMagicLink(page, EMAIL_B);

  await page.goto(`/invite/${token}`);
  await page.locator("[data-invite-accept]").click();

  // 受諾後は当該チーム詳細へ遷移する
  await page.waitForURL(`**/teams/${teamId}`);
  await expect(page.getByRole("heading", { name: TEAM_NAME })).toBeVisible();

  // DB: Membership(B, team) が作成され、Invitation は削除されている
  const userB = await prisma.user.findUnique({ where: { email: EMAIL_B } });
  expect(userB).not.toBeNull();
  await expect(async () => {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: userB!.id, teamId } },
    });
    expect(membership).not.toBeNull();
    const remaining = await prisma.invitation.count({ where: { token } });
    expect(remaining).toBe(0);
  }).toPass({ timeout: 40_000 });

  // B は /teams で当該チームを見られる
  await page.goto("/teams");
  await expect(page.getByRole("link", { name: new RegExp(TEAM_NAME) })).toBeVisible();
});

test("招待を取り消すと保留リストから消え DB からも削除される", async ({ page }) => {
  await loginViaMagicLink(page, EMAIL_A);
  await page.goto(`/teams/${teamId}`);

  // 招待を作成（受諾済みでメンバー化した EMAIL_B とは別アドレスを使う）
  await page.locator("[data-invite-email-input]").fill(EMAIL_REVOKE);
  await page.locator("[data-invite-submit]").click();

  // 保留中の招待行が現れる
  const inviteRow = page.locator("[data-invitation-id]");
  await expect(inviteRow).toHaveCount(1, { timeout: 40_000 });

  // DB に 1 件あることを確認
  await expect(async () => {
    const n = await prisma.invitation.count({ where: { teamId, email: EMAIL_REVOKE } });
    expect(n).toBe(1);
  }).toPass({ timeout: 40_000 });

  // 取り消し
  await page.locator("[data-invite-revoke]").click();

  // 保留リストから消える
  await expect(page.locator("[data-invitation-id]")).toHaveCount(0, { timeout: 40_000 });

  // DB: Invitation 0 件
  await expect(async () => {
    const n = await prisma.invitation.count({ where: { teamId } });
    expect(n).toBe(0);
  }).toPass({ timeout: 40_000 });
});

test("未ログインで招待リンクを踏むとログインへ誘導され、ログイン後に招待ページへ戻る", async ({
  page,
}) => {
  // userA として EMAIL_CB 宛の招待を作成
  await loginViaMagicLink(page, EMAIL_A);
  await page.goto(`/teams/${teamId}`);
  await page.locator("[data-invite-email-input]").fill(EMAIL_CB);
  await page.locator("[data-invite-submit]").click();

  let token = "";
  await expect(async () => {
    const invites = await prisma.invitation.findMany({ where: { teamId, email: EMAIL_CB } });
    expect(invites).toHaveLength(1);
    token = invites[0].token;
  }).toPass({ timeout: 40_000 });

  // --- 未ログイン状態で招待リンクを踏む ---
  await page.context().clearCookies();
  await page.goto(`/invite/${token}`);

  // ログイン画面へ誘導され、callbackUrl に招待パスが入っている
  await page.waitForURL(/\/signin\?callbackUrl=/);
  expect(decodeURIComponent(page.url())).toContain(`/invite/${token}`);

  // 開発ログインでログイン → callbackUrl の招待ページへ戻る
  await page.getByPlaceholder("dev@example.com").fill(EMAIL_CB);
  await page.getByRole("button", { name: "開発ログイン（リンク不要）" }).click();
  await page.waitForURL(`**/invite/${token}`);

  // 招待ページに戻れたので、そのまま参加できる
  await page.locator("[data-invite-accept]").click();
  await page.waitForURL(`**/teams/${teamId}`);

  const userCb = await prisma.user.findUnique({ where: { email: EMAIL_CB } });
  expect(userCb).not.toBeNull();
  await expect(async () => {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: userCb!.id, teamId } },
    });
    expect(membership).not.toBeNull();
  }).toPass({ timeout: 40_000 });
});

test("期限切れの招待を受諾すると /teams へリダイレクトされメンバーにならない", async ({ page }) => {
  // 期限切れ（過去 expiresAt）の Invitation を Prisma で直接作成
  const expired = await prisma.invitation.create({
    data: {
      teamId,
      email: EMAIL_C,
      expiresAt: new Date(Date.now() - 60 * 1000), // 1分前に失効
    },
  });

  await loginViaMagicLink(page, EMAIL_C);
  await page.goto(`/invite/${expired.token}`);
  await page.locator("[data-invite-accept]").click();

  // 期限切れは当該チームへは入れず /teams へリダイレクトされる
  await page.waitForURL("**/teams");
  await expect(page).toHaveURL(/\/teams$/);

  // DB: userC は当該チームのメンバーになっていない（Membership 未作成）
  const userC = await prisma.user.findUnique({ where: { email: EMAIL_C } });
  expect(userC).not.toBeNull();
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId: userC!.id, teamId } },
  });
  expect(membership).toBeNull();

  // 期限切れの Invitation は削除されず残っている（受諾ロジックは期限切れを消さない）
  const still = await prisma.invitation.count({ where: { id: expired.id } });
  expect(still).toBe(1);
});
