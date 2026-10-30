import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

const prisma = new PrismaClient();
const email = "e2e-note-save-pending@example.com";
const teamName = "E2E付箋保存待機チーム";
let teamId: string;
let retroId: string;

test.beforeAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email } });
  const team = await prisma.team.create({ data: { name: teamName } });
  teamId = team.id;
  await prisma.membership.create({ data: { teamId, userId: user.id } });
  const retro = await prisma.retrospective.create({ data: { teamId, name: "付箋保存待機の検証" } });
  retroId = retro.id;
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: teamName } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

async function verifyPending(
  page: Page,
  label: string,
  kind: "KEEP" | "PROBLEM" | "TRY",
  content: string,
  capturePending: () => Promise<void> = async () => {},
) {
  const input = page.getByPlaceholder(`${label} を追加`);
  const form = input.locator("xpath=ancestor::form");
  const button = form.getByRole("button");
  const note = page.locator(`[data-lane="${kind}"] [data-note-id]`).filter({ hasText: content });
  await expect(input).toBeEnabled();
  await expect(button).toBeEnabled();
  await input.fill(content);

  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const intercepted = new Promise<void>((resolve) => { arrived = resolve; });
  let posts = 0;
  const url = page.url();
  await page.route(url, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.continue();
      return;
    }
    posts += 1;
    arrived();
    await gate;
    await route.continue();
  });

  try {
    await button.click();
    await intercepted;
    await expect(input).toBeDisabled();
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("保存中…");
    await expect(form.getByRole("status")).toHaveText(`${label}の付箋を保存しています。`);
    await expect(note).toHaveCount(0);
    expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind, content } })).toBe(0);
    // 他列のフォームは操作可能なまま。
    for (const other of ["Keep", "Problem", "Try"].filter((value) => value !== label)) {
      await expect(page.getByPlaceholder(`${other} を追加`)).toBeEnabled();
    }
    await capturePending();
    // disabled なボタンへの実際のポインター操作と Enter の再操作。
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.keyboard.press("Enter");
    expect(posts).toBe(1);
  } finally {
    release();
  }

  await expect(note).toHaveCount(1);
  await expect(input).toBeEnabled();
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("＋ 追加");
  await expect(form.getByRole("status")).toBeEmpty();
  expect(posts).toBe(1);
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind, content } })).toBe(1);
  await page.reload();
  await expect(note).toHaveCount(1);
  expect(posts).toBe(1);
  expect(await prisma.note.count({ where: { retrospectiveId: retroId, kind, content } })).toBe(1);
  await page.unroute(url);
}

test("付箋保存中は対象フォームの再送信を抑止し、各列で1件だけ保存する", async ({ page }) => {
  await loginViaMagicLink(page, email);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(page.getByPlaceholder("Try を追加")).toBeEnabled();
  await page.screenshot({ path: "e2e/__screens__/note-save-pending-before.png", fullPage: true });
  await verifyPending(page, "Try", "TRY", "私が2026-11-02にレビュー依頼へ期限を書く", async () => {
    await page.screenshot({ path: "e2e/__screens__/note-save-pending-after.png", fullPage: true });
  });
  await verifyPending(page, "Keep", "KEEP", "レビュー前に背景を共有できた");
  await verifyPending(page, "Problem", "PROBLEM", "レビュー待ちの見通しが分からない");
  // 完了後は同じフォームから次の付箋も追加できる。
  const input = page.getByPlaceholder("Try を追加");
  await input.fill("私が次回のふりかえりで実行状況を報告する");
  await input.locator("xpath=ancestor::form").getByRole("button", { name: "＋ 追加" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "私が次回のふりかえりで実行状況を報告する" })).toHaveCount(1);
});
