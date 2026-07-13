import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

// バックログ D1「ふりかえり画面に併設したAIチャットアシスタント」の実ブラウザ検証。
// - チャットは @ai-sdk/google（gemini-2.5-flash）を直接叩く＝実API（LLM_PROVIDER=mock は無関係）。
//   応答は非決定的なので「アシスタントの返答が非空でストリーム表示される」ことを smoke 検証する。
// - 認可（未ログイン=401 / 非メンバー=403）は /api/chat を直叩きして確認する。
const prisma = new PrismaClient();

const MEMBER_EMAIL = "e2e-chat@example.com";
const OUTSIDER_EMAIL = "e2e-chat-outsider@example.com";
const TEAM_NAME = "E2Eチャットチーム";

let teamId = "";
let retroId = "";

test.beforeAll(async () => {
  // 前回残骸の掃除
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: { in: [MEMBER_EMAIL, OUTSIDER_EMAIL] } } });

  const member = await prisma.user.create({ data: { email: MEMBER_EMAIL, name: "E2E Chat" } });
  // 非メンバーを明示シード（403 検証で使用。ログインで自動作成されるが掃除対象を確定させる）
  await prisma.user.create({ data: { email: OUTSIDER_EMAIL, name: "E2E Outsider" } });

  const team = await prisma.team.create({ data: { name: TEAM_NAME } });
  teamId = team.id;
  await prisma.membership.create({ data: { userId: member.id, teamId } });

  const retro = await prisma.retrospective.create({ data: { teamId, name: "チャット検証回" } });
  retroId = retro.id;

  // 付箋を数枚シード（system プロンプトに載る）
  await prisma.note.createMany({
    data: [
      { retrospectiveId: retroId, authorId: member.id, kind: "KEEP", content: "毎朝の同期がうまくいった", order: 0 },
      { retrospectiveId: retroId, authorId: member.id, kind: "PROBLEM", content: "レビュー待ちが長かった", order: 0 },
      { retrospectiveId: retroId, authorId: member.id, kind: "TRY", content: "レビュー担当を輪番にする", order: 0 },
    ],
  });
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: { in: [MEMBER_EMAIL, OUTSIDER_EMAIL] } } });
  await prisma.$disconnect();
});

function retroUrl() {
  return `/teams/${teamId}/retros/${retroId}`;
}

// アシスタントバブル（左寄せ = role !== user）の最新テキスト。空/プレースホルダ"…"は未達扱い。
async function assistantReplyReady(page: Page): Promise<boolean> {
  const bubbles = page.locator("[data-ai-chat] li.justify-start div");
  if ((await bubbles.count()) === 0) return false;
  const t = (await bubbles.last().innerText()).trim();
  return t.length > 0 && t !== "…";
}

test("チャットUIが表示され、サジェストが出る（AIはチャットに一本化）", async ({ page }) => {
  await loginViaMagicLink(page, MEMBER_EMAIL);
  await page.goto(retroUrl());

  // チャットのコンテナ・入力・送信が見える
  await expect(page.locator("[data-ai-chat]")).toBeVisible();
  await expect(page.locator("[data-chat-input]")).toBeVisible();
  await expect(page.locator("[data-chat-send]")).toBeVisible();

  // 空状態のサジェスト（総括・横断指摘）
  await expect(page.getByRole("button", { name: "今回の総括をして" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "前回からの積み残しを指摘して" }),
  ).toBeVisible();

  // 旧・AI問い返しパネルは撤去済み（チャットに一本化）
  await expect(page.getByText("AI 問い返し", { exact: true })).toHaveCount(0);
});

test("送信するとアシスタントの返答が非空でストリーム表示される（実Gemini smoke）", async ({ page }) => {
  // 初回ルートのcold compile＋ストリーミングで遅いのでテスト全体も長めに
  test.setTimeout(150_000);

  await loginViaMagicLink(page, MEMBER_EMAIL);
  await page.goto(retroUrl());

  const input = page.locator("[data-chat-input]");
  const send = page.locator("[data-chat-send]");

  // 実Geminiのレート/失敗に備えて最大2回試行
  let replied = false;
  for (let attempt = 1; attempt <= 2 && !replied; attempt++) {
    await expect(input).toBeEnabled();
    await input.fill("今回の付箋を一言で要約して");
    await send.click();

    // 送信直後は busy（送信ボタンが無効・応答中表示）— 初回は確実に無効化される
    if (attempt === 1) {
      await expect(send).toBeDisabled();
      await expect(send).toHaveText("応答中…");
    }

    try {
      await expect.poll(() => assistantReplyReady(page), {
        timeout: 45_000,
        intervals: [500, 1000, 2000],
      }).toBe(true);
      replied = true;
    } catch {
      // 失敗時は次ループで再送信（busy が解けて入力が再度有効になるのを待つ）
    }
  }

  expect(replied, "アシスタントの返答が45s以内に非空で表示されること").toBe(true);

  // 返答表示後は busy が解けて再度入力できる
  await expect(input).toBeEnabled();

  await page.screenshot({ path: "e2e/__screens__/ai-chat.png", fullPage: true });
});

test("未ログインの POST /api/chat は 401", async ({ request }) => {
  // request フィクスチャは Cookie を持たない独立コンテキスト＝未認証
  const res = await request.post("/api/chat", {
    data: {
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      retroId,
      teamId,
    },
  });
  expect(res.status()).toBe(401);
});

test("非メンバーの POST /api/chat は 403（retro情報が漏れない）", async ({ page }) => {
  await loginViaMagicLink(page, OUTSIDER_EMAIL);

  // ログイン済み Cookie を共有する page.request で、所属しないチームの retro を叩く
  const res = await page.request.post("/api/chat", {
    data: {
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      retroId,
      teamId,
    },
  });
  expect(res.status()).toBe(403);
});
