import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

// スイムレーン式KPTボード Phase 1（dnd-kit ドラッグ移動＋永続化）の実ブラウザ検証。
// ドラッグは決定論的な KeyboardSensor 経路を主検証にする（PointerSensor はフォールバック）。
const prisma = new PrismaClient();
const TEST_EMAIL = "e2e-board@example.com";
const TEAM_NAME = "E2Eボードチーム";

let teamId = "";
let retroId = "";
let userId = "";

// 既知の content / kind / order でシードした付箋の id を保持する
const ids = { keep1: "", keep2: "", prob1: "" };

const CONTENT = {
  keep1: "board-keep-alpha",
  keep2: "board-keep-bravo",
  prob1: "board-problem-charlie",
} as const;

test.beforeAll(async () => {
  // 前回残骸の掃除
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });

  const user = await prisma.user.create({ data: { email: TEST_EMAIL, name: "E2E Board" } });
  userId = user.id;
  const team = await prisma.team.create({ data: { name: TEAM_NAME } });
  teamId = team.id;
  await prisma.membership.create({ data: { userId: user.id, teamId } });
  const retro = await prisma.retrospective.create({ data: { teamId, name: "ボード検証回" } });
  retroId = retro.id;
});

// 各テストは既知レイアウトから始める: KEEP=[keep1(0), keep2(1)], PROBLEM=[prob1(0)], TRY=[]
async function reseedNotes() {
  await prisma.note.deleteMany({ where: { retrospectiveId: retroId } });
  const keep1 = await prisma.note.create({
    data: { retrospectiveId: retroId, authorId: userId, kind: "KEEP", content: CONTENT.keep1, order: 0 },
  });
  const keep2 = await prisma.note.create({
    data: { retrospectiveId: retroId, authorId: userId, kind: "KEEP", content: CONTENT.keep2, order: 1 },
  });
  const prob1 = await prisma.note.create({
    data: { retrospectiveId: retroId, authorId: userId, kind: "PROBLEM", content: CONTENT.prob1, order: 0 },
  });
  ids.keep1 = keep1.id;
  ids.keep2 = keep2.id;
  ids.prob1 = prob1.id;
}

test.beforeEach(async () => {
  await reseedNotes();
});

test.afterAll(async () => {
  await prisma.note.deleteMany({ where: { retrospectiveId: retroId } });
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

// 付箋のドラッグハンドル（listeners を持つグリップ）
function grip(page: Page, noteId: string) {
  return page
    .locator(`[data-note-id="${noteId}"]`)
    .getByRole("button", { name: "ドラッグして移動" });
}

// レーン内の付箋 li（data-lane スコープ）
function noteInLane(page: Page, kind: string, noteId: string) {
  return page.locator(`[data-lane="${kind}"] [data-note-id="${noteId}"]`);
}

// キーボードセンサでドラッグ: ハンドルにフォーカス→Space→矢印→Space
async function keyboardDrag(page: Page, noteId: string, keys: string[]) {
  const handle = grip(page, noteId);
  await handle.focus();
  await page.waitForTimeout(150);
  await page.keyboard.press("Space"); // ドラッグ開始
  await page.waitForTimeout(300); // dnd-kit がドラッグ状態を確立するまで待つ
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Space"); // ドロップ
  await page.waitForTimeout(300);
}

test("キーボードでレーン内の並べ替えができ永続化される", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();

  // 初期は keep1(order0), keep2(order1)。keep2 を上へ動かして先頭にする。
  await keyboardDrag(page, ids.keep2, ["ArrowUp"]);

  // DB: order が入れ替わっている（＝並べ替えの永続化）。
  // 初回の moveNote サーバーアクションは dev のコールドコンパイルで遅くなり得るため長めに待つ。
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    const k2 = await prisma.note.findUnique({ where: { id: ids.keep2 } });
    expect(k2?.order).toBe(0);
    expect(k1?.order).toBe(1);
    expect(k2?.kind).toBe("KEEP");
  }).toPass({ timeout: 40_000 });

  // UI: revalidate 後、KEEP レーンの先頭 li が keep2 になっている
  await expect(
    page.locator(`[data-lane="KEEP"] [data-note-id]`).first(),
  ).toHaveAttribute("data-note-id", ids.keep2);

  // reload 後も維持（永続化＝DB反映の実証）
  await page.reload();
  await expect(
    page.locator(`[data-lane="KEEP"] [data-note-id]`).first(),
  ).toHaveAttribute("data-note-id", ids.keep2);
});

test("キーボードでレーン内を下方向に並べ替えできる（回帰）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();

  // 初期は keep1(order0), keep2(order1)。keep1 を下へ動かして末尾にする。
  // （下方向ドラッグが no-op になる不具合の回帰防止）
  await keyboardDrag(page, ids.keep1, ["ArrowDown"]);

  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    const k2 = await prisma.note.findUnique({ where: { id: ids.keep2 } });
    expect(k1?.order).toBe(1);
    expect(k2?.order).toBe(0);
  }).toPass({ timeout: 40_000 });

  // UI: KEEP レーンの先頭が keep2 になっている
  await expect(
    page.locator(`[data-lane="KEEP"] [data-note-id]`).first(),
  ).toHaveAttribute("data-note-id", ids.keep2);

  await page.reload();
  await expect(
    page.locator(`[data-lane="KEEP"] [data-note-id]`).first(),
  ).toHaveAttribute("data-note-id", ids.keep2);
});

test("キーボードでレーンを跨いで移動でき永続化される", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();

  // keep1 を KEEP から右隣の PROBLEM レーンへ動かす
  await keyboardDrag(page, ids.keep1, ["ArrowRight"]);

  // DB: kind が PROBLEM に変わり、元レーンは詰め直されている（＝レーン跨ぎの永続化）
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    expect(k1?.kind).toBe("PROBLEM");
    const k2 = await prisma.note.findUnique({ where: { id: ids.keep2 } });
    expect(k2?.kind).toBe("KEEP");
    expect(k2?.order).toBe(0); // 元レーンの詰め直し
  }).toPass({ timeout: 40_000 });

  // UI: keep1 が PROBLEM レーン内に存在し、KEEP には無い
  await expect(noteInLane(page, "PROBLEM", ids.keep1)).toBeVisible();
  await expect(noteInLane(page, "KEEP", ids.keep1)).toHaveCount(0);

  // reload 後も維持
  await page.reload();
  await expect(noteInLane(page, "PROBLEM", ids.keep1)).toBeVisible();
  await expect(noteInLane(page, "KEEP", ids.keep1)).toHaveCount(0);

  await page.screenshot({ path: "e2e/__screens__/board.png", fullPage: true });
});

// 付箋の色ピッカーを開く（「色」トグル→スウォッチ/クリアが現れる）
async function openColorPicker(page: Page, noteId: string) {
  await page
    .locator(`[data-note-id="${noteId}"]`)
    .getByRole("button", { name: "色", exact: true })
    .click();
}

test("付箋の色を変更でき永続化される（Phase 2）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);

  const note = noteInLane(page, "KEEP", ids.keep1);
  await expect(note).toBeVisible();
  // 初期はデフォルト（色なし）
  await expect(note).toHaveAttribute("data-note-color", "");

  // 色ピッカーを開き blue スウォッチを選ぶ
  await openColorPicker(page, ids.keep1);
  await note.getByRole("button", { name: "色: blue" }).click();

  // UI: data-note-color が blue になる（楽観反映）
  await expect(note).toHaveAttribute("data-note-color", "blue");

  // DB: revalidate 後 color === "blue"
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    expect(k1?.color).toBe("blue");
  }).toPass({ timeout: 40_000 });

  // 色が付いた状態のスクショ
  await page.screenshot({ path: "e2e/__screens__/board-color.png", fullPage: true });

  // reload 後も維持（永続化＝DB反映の実証）
  await page.reload();
  await expect(noteInLane(page, "KEEP", ids.keep1)).toHaveAttribute(
    "data-note-color",
    "blue",
  );

  // 「クリア」で null（data-note-color="" かつ DB color=null）に戻る
  await openColorPicker(page, ids.keep1);
  await noteInLane(page, "KEEP", ids.keep1)
    .getByRole("button", { name: "色をクリア（デフォルトに戻す）" })
    .click();

  await expect(noteInLane(page, "KEEP", ids.keep1)).toHaveAttribute(
    "data-note-color",
    "",
  );
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    expect(k1?.color).toBeNull();
  }).toPass({ timeout: 40_000 });
});
