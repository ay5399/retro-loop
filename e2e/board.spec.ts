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
  // グループ化テストの残骸が noteGroup.count 検証を汚さないよう、付箋より先に掃除する。
  // Note.groupId は onDelete SetNull なので順序は問わないが明示的に消す。
  await prisma.noteGroup.deleteMany({ where: { retrospectiveId: retroId } });
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
  await prisma.noteGroup.deleteMany({ where: { retrospectiveId: retroId } });
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

// 付箋の投票ボタン（data-voted 属性を持つのはこのボタンだけ＝一意）。
// 実装: aria-pressed / data-vote-count / data-voted 付きの type=button、ラベルに「▲」を含む。
function voteButton(page: Page, noteId: string) {
  return page.locator(`[data-note-id="${noteId}"] button[data-voted]`);
}

test("付箋に投票でき、取消でき、永続化される（Phase 3）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);

  const btn = voteButton(page, ids.keep1);
  await expect(btn).toBeVisible();
  // 初期は未投票・0票
  await expect(btn).toHaveAttribute("data-voted", "false");
  await expect(btn).toHaveAttribute("data-vote-count", "0");

  // 投票する → 楽観反映で voted=true・count=1
  await btn.click();
  await expect(btn).toHaveAttribute("data-voted", "true");
  await expect(btn).toHaveAttribute("data-vote-count", "1");

  // DB: NoteVote(keep1, user) が 1 件（revalidate まで長めに待つ）
  await expect(async () => {
    const n = await prisma.noteVote.count({
      where: { noteId: ids.keep1, userId },
    });
    expect(n).toBe(1);
  }).toPass({ timeout: 40_000 });

  // reload 後も投票状態が維持される（＝DB反映の実証）
  await page.reload();
  await expect(voteButton(page, ids.keep1)).toHaveAttribute("data-voted", "true");
  await expect(voteButton(page, ids.keep1)).toHaveAttribute("data-vote-count", "1");

  // もう一度クリックで取消 → voted=false・count=0
  const btn2 = voteButton(page, ids.keep1);
  await btn2.click();
  await expect(btn2).toHaveAttribute("data-voted", "false");
  await expect(btn2).toHaveAttribute("data-vote-count", "0");

  // DB: 0 件
  await expect(async () => {
    const n = await prisma.noteVote.count({
      where: { noteId: ids.keep1, userId },
    });
    expect(n).toBe(0);
  }).toPass({ timeout: 40_000 });

  // reload 後も取消状態が維持される
  await page.reload();
  await expect(voteButton(page, ids.keep1)).toHaveAttribute("data-voted", "false");
  await expect(voteButton(page, ids.keep1)).toHaveAttribute("data-vote-count", "0");
});

test("1ユーザーの投票上限（5票）で未投票の付箋が無効化される（Phase 3）", async ({ page }) => {
  // このテスト用に既知 content/kind/order の付箋を 6 枚追加する（seed 分とは別）。
  const extraIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const n = await prisma.note.create({
      data: {
        retrospectiveId: retroId,
        authorId: userId,
        kind: "TRY",
        content: `board-vote-limit-${i}`,
        order: 10 + i,
      },
    });
    extraIds.push(n.id);
  }

  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);

  // 先頭 5 枚に 1 票ずつ投票する（各クリック後に voted=true を待って直列化）。
  for (let i = 0; i < 5; i++) {
    const btn = voteButton(page, extraIds[i]);
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(btn).toHaveAttribute("data-voted", "true");
  }

  // DB: 5 票投じられている（revalidate まで長めに待つ）
  await expect(async () => {
    const n = await prisma.noteVote.count({
      where: { userId, note: { retrospectiveId: retroId } },
    });
    expect(n).toBe(5);
  }).toPass({ timeout: 40_000 });

  // 6 枚目（未投票）の投票ボタンは上限到達で無効化される
  const sixth = voteButton(page, extraIds[5]);
  await expect(sixth).toBeDisabled();
  await expect(sixth).toHaveAttribute(
    "title",
    "投票上限（5票）に達しています",
  );

  // 投票済みの付箋は取消可能（無効化されていない）
  const votedBtn = voteButton(page, extraIds[0]);
  await expect(votedBtn).toBeEnabled();

  // 取消すると上限が解け、6 枚目が再び有効になる（回帰確認）
  await votedBtn.click();
  await expect(votedBtn).toHaveAttribute("data-voted", "false");
  await expect(sixth).toBeEnabled();

  // 投票上限の状態でスクショ保存（取消前の状態を再現してから撮る）
  await votedBtn.click();
  await expect(votedBtn).toHaveAttribute("data-voted", "true");
  await expect(sixth).toBeDisabled();
  await page.screenshot({ path: "e2e/__screens__/board-vote.png", fullPage: true });
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

// ─────────────────────────────────────────────
// 付箋のグルーピング（Phase 4）の実ブラウザ検証。
// 選択チェックボックス→「まとめる」→ [data-group-id] 枠、リネーム、解除、レーン跨ぎ離脱。
// ─────────────────────────────────────────────

// 付箋の選択チェックボックス（グループ化対象の集合を作る）。aria-label「この付箋を選択」。
function selectCheckbox(page: Page, noteId: string) {
  return page.locator(`[data-select-note="${noteId}"]`);
}

// レーンヘッダの「まとめる」ボタン（同一レーンで2件以上選択時に出現）。
function groupCreateButton(page: Page, kind: string) {
  return page.locator(
    `[data-group-action="create"][data-lane-group-kind="${kind}"]`,
  );
}

// keep1/keep2 を選択してグループ化し、[data-group-id] 枠の出現を待つヘルパ。
// 戻り値は DB 上の（＝UI に出た）groupId。
async function groupKeeps(page: Page): Promise<string> {
  await selectCheckbox(page, ids.keep1).check();
  await selectCheckbox(page, ids.keep2).check();

  const createBtn = groupCreateButton(page, "KEEP");
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  // revalidate 後にグループ枠が1つ現れる（初回サーバアクションのコールドコンパイルを見込み長め）。
  const groupFrame = page.locator('[data-lane="KEEP"] [data-group-id]');
  await expect(groupFrame).toHaveCount(1, { timeout: 40_000 });

  const groupId = await groupFrame.getAttribute("data-group-id");
  expect(groupId).toBeTruthy();
  return groupId as string;
}

test("同一レーンの付箋を選択してグループ化でき永続化される（Phase 4）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();

  const groupId = await groupKeeps(page);

  // UI: グループ枠の中に keep1/keep2 が両方含まれる。
  const frame = page.locator(`[data-group-id="${groupId}"]`);
  await expect(frame.locator(`[data-note-id="${ids.keep1}"]`)).toBeVisible();
  await expect(frame.locator(`[data-note-id="${ids.keep2}"]`)).toBeVisible();

  // DB: keep1/keep2 の groupId が同一の非null、NoteGroup が1件。
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    const k2 = await prisma.note.findUnique({ where: { id: ids.keep2 } });
    expect(k1?.groupId).not.toBeNull();
    expect(k1?.groupId).toBe(k2?.groupId);
    const groups = await prisma.noteGroup.count({
      where: { retrospectiveId: retroId },
    });
    expect(groups).toBe(1);
  }).toPass({ timeout: 40_000 });

  // reload 後も維持（永続化＝DB反映の実証）。
  await page.reload();
  const frame2 = page.locator(`[data-group-id="${groupId}"]`);
  await expect(frame2).toHaveCount(1);
  await expect(frame2.locator(`[data-note-id="${ids.keep1}"]`)).toBeVisible();
  await expect(frame2.locator(`[data-note-id="${ids.keep2}"]`)).toBeVisible();

  // グループ表示のスクショ保存。
  await page.screenshot({ path: "e2e/__screens__/board-group.png", fullPage: true });
});

test("グループ名をリネームでき永続化される（Phase 4）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();

  const groupId = await groupKeeps(page);

  const NAME = "デプロイ改善";
  // グループ名 input に入力して確定（form submit）。実装はインライン form の onSubmit で renameGroup。
  const input = page.locator(`[data-group-name="${groupId}"]`);
  await expect(input).toBeVisible();
  await input.fill(NAME);
  await input.press("Enter");

  // DB: NoteGroup.name が更新される。
  await expect(async () => {
    const g = await prisma.noteGroup.findUnique({ where: { id: groupId } });
    expect(g?.name).toBe(NAME);
  }).toPass({ timeout: 40_000 });

  // reload 後も input に反映される（defaultValue が新しい name を採る）。
  await page.reload();
  await expect(page.locator(`[data-group-name="${groupId}"]`)).toHaveValue(NAME);
});

test("グループを解除でき永続化される（Phase 4）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();

  const groupId = await groupKeeps(page);

  // 「解除」ボタン（グループ枠内）をクリック。
  await page
    .locator(`[data-group-id="${groupId}"]`)
    .getByRole("button", { name: "グループを解除" })
    .click();

  // UI: グループ枠が消える。
  await expect(page.locator(`[data-group-id="${groupId}"]`)).toHaveCount(0, {
    timeout: 40_000,
  });

  // DB: keep1/keep2 の groupId が null、NoteGroup 0件。
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    const k2 = await prisma.note.findUnique({ where: { id: ids.keep2 } });
    expect(k1?.groupId).toBeNull();
    expect(k2?.groupId).toBeNull();
    const groups = await prisma.noteGroup.count({
      where: { retrospectiveId: retroId },
    });
    expect(groups).toBe(0);
  }).toPass({ timeout: 40_000 });

  // keep1/keep2 はグループ外の通常表示として残る。
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();
  await expect(noteInLane(page, "KEEP", ids.keep2)).toBeVisible();

  // reload 後も解除が維持される。
  await page.reload();
  await expect(page.locator(`[data-lane="KEEP"] [data-group-id]`)).toHaveCount(0);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();
});

test("レーンを跨いで移動した付箋はグループから離脱する（Phase 4）", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);
  await expect(noteInLane(page, "KEEP", ids.keep1)).toBeVisible();

  const groupId = await groupKeeps(page);

  // グループ化が DB に反映済みであることを確認してから移動する。
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    expect(k1?.groupId).toBe(groupId);
  }).toPass({ timeout: 40_000 });

  // keep1 を KEEP から右隣の PROBLEM レーンへキーボードで移動（レーン跨ぎ）。
  await keyboardDrag(page, ids.keep1, ["ArrowRight"]);

  // DB: keep1 は PROBLEM に移り、groupId が null になる（レーン跨ぎ離脱）。
  // keep2 は KEEP に残る（グループ自体はまだ存在し得る）。
  await expect(async () => {
    const k1 = await prisma.note.findUnique({ where: { id: ids.keep1 } });
    expect(k1?.kind).toBe("PROBLEM");
    expect(k1?.groupId).toBeNull();
  }).toPass({ timeout: 40_000 });

  // UI: keep1 が PROBLEM レーンに存在し、グループ枠の外にある。
  await expect(noteInLane(page, "PROBLEM", ids.keep1)).toBeVisible();
  await expect(
    page.locator(`[data-group-id="${groupId}"] [data-note-id="${ids.keep1}"]`),
  ).toHaveCount(0);
});
