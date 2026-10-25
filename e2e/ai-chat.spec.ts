import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

// バックログ D1「ふりかえり画面に併設したAIチャットアシスタント」の実ブラウザ検証。
// - チャットも LLM_PROVIDER=mock に従う。通常E2Eから実APIは呼び出さない。
// - 認可（未ログイン=401 / 非メンバー=403）は /api/chat を直叩きして確認する。
const prisma = new PrismaClient();

const MEMBER_EMAIL = "e2e-chat@example.com";
const OUTSIDER_EMAIL = "e2e-chat-outsider@example.com";
const OTHER_MEMBER_EMAIL = "e2e-chat-other-member@example.com";
const TEAM_NAME = "E2Eチャットチーム";

let teamId = "";
let retroId = "";

test.beforeAll(async () => {
  // 前回残骸の掃除
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: { in: [MEMBER_EMAIL, OUTSIDER_EMAIL, OTHER_MEMBER_EMAIL] } } });

  const member = await prisma.user.create({ data: { email: MEMBER_EMAIL, name: "E2E Chat" } });
  // 非メンバーを明示シード（403 検証で使用。ログインで自動作成されるが掃除対象を確定させる）
  await prisma.user.create({ data: { email: OUTSIDER_EMAIL, name: "E2E Outsider" } });
  const other = await prisma.user.create({ data: { email: OTHER_MEMBER_EMAIL, name: "E2E Other Member" } });

  const team = await prisma.team.create({ data: { name: TEAM_NAME } });
  teamId = team.id;
  await prisma.membership.create({ data: { userId: member.id, teamId } });
  await prisma.membership.create({ data: { userId: other.id, teamId } });

  const retro = await prisma.retrospective.create({ data: { teamId, name: "チャット検証回" } });
  retroId = retro.id;

  // 付箋を数枚シード（system プロンプトに載る）
  await prisma.note.createMany({
    data: [
      { retrospectiveId: retroId, authorId: member.id, kind: "KEEP", content: "毎朝の同期がうまくいった", order: 0 },
      { retrospectiveId: retroId, authorId: member.id, kind: "PROBLEM", content: "レビュー待ちが長かった", order: 0 },
      { retrospectiveId: retroId, authorId: other.id, kind: "PROBLEM", content: "別メンバーの架空Problem", order: 1 },
      { retrospectiveId: retroId, authorId: member.id, kind: "TRY", content: "レビュー担当を輪番にする", order: 0 },
    ],
  });
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: { in: [MEMBER_EMAIL, OUTSIDER_EMAIL, OTHER_MEMBER_EMAIL] } } });
  await prisma.$disconnect();
});

function retroUrl() {
  return `/teams/${teamId}/retros/${retroId}`;
}

// 提案版の操作前を撮影する。旧版の画面証拠は提供済みのai-chat.png。
test("Problem相談の操作前画面を撮影する", async ({ page }) => {
  await loginViaMagicLink(page, MEMBER_EMAIL);
  await page.goto(retroUrl());
  await expect(page.locator("[data-chat-input]")).toBeVisible();
  await expect(page.locator("[data-chat-input]")).toHaveValue("");
  await expect(page.getByLabel("自分のProblemから相談する")).toHaveValue("");
  await page.screenshot({ path: "e2e/__screens__/problem-consultation-before.png", fullPage: true });
});

test("本人のProblemを編集可能な下書きに追加し、明示送信する", async ({ page }) => {
  await loginViaMagicLink(page, MEMBER_EMAIL);
  await page.goto(retroUrl());
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/chat" && request.method() === "POST") requests++;
  });
  const choice = page.getByLabel("自分のProblemから相談する");
  await expect(choice.locator("option")).toHaveText(["Problemを選択", "レビュー待ちが長かった"]);
  const input = page.locator("[data-chat-input]");
  await input.fill("入力済みの相談");
  await choice.selectOption({ label: "レビュー待ちが長かった" });
  await page.getByRole("button", { name: "相談文の下書きに追加" }).click();
  await expect(input).toHaveValue(/^入力済みの相談\n\n自分のProblem：\nレビュー待ちが長かった/);
  await input.fill(`${await input.inputValue()}\nまだ行動と日付は未定です。`);
  const editedDraft = await input.inputValue();
  await expect(input).toHaveValue(editedDraft);
  await expect(page.locator("[data-ai-chat] li")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "相談文の下書きに追加" })).toBeDisabled();
  expect(requests).toBe(0);
  await page.screenshot({ path: "e2e/__screens__/problem-consultation-after.png", fullPage: true });
  const sentRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/chat" && request.method() === "POST");
  await page.locator("[data-chat-send]").click();
  const payload = (await sentRequest).postDataJSON();
  expect(payload.retroId).toBe(retroId);
  expect(payload.teamId).toBe(teamId);
  expect(payload.messages.at(-1).parts).toContainEqual({ type: "text", text: editedDraft });
  await expect(page.locator("[data-ai-chat] li.justify-end")).toHaveText(editedDraft);
  await expect.poll(() => assistantReplyReady(page), { timeout: 45_000 }).toBe(true);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("");
  expect(requests).toBe(1);
});

test("本人のProblemがない場合も通常相談できる", async ({ page }) => {
  const retro = await prisma.retrospective.create({ data: { teamId, name: "Problemなしの架空回" } });
  try {
    await loginViaMagicLink(page, MEMBER_EMAIL);
    await page.goto(`/teams/${teamId}/retros/${retro.id}`);
    await expect(page.getByText("自分のProblemはまだありません。通常の相談も利用できます。")).toBeVisible();
    await page.locator("[data-chat-input]").fill("今回の進め方を相談したいです");
    await page.locator("[data-chat-send]").click();
    await expect.poll(() => assistantReplyReady(page), { timeout: 45_000 }).toBe(true);
  } finally {
    await prisma.retrospective.delete({ where: { id: retro.id } });
  }
});

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

test("送信するとモックの返答がストリーム表示される（外部API不要）", async ({ page }) => {
  // 初回ルートのcold compile＋ストリーミングで遅いのでテスト全体も長めに
  test.setTimeout(150_000);

  await loginViaMagicLink(page, MEMBER_EMAIL);
  await page.goto(retroUrl());

  const input = page.locator("[data-chat-input]");
  const send = page.locator("[data-chat-send]");

  // Hold the real mock-backed request until the pending UI has been checked.
  // Otherwise a fast response can finish between Playwright assertions.
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route("**/api/chat", async (route) => {
    await requestGate;
    await route.continue();
  });

  // 実Geminiのレート/失敗に備えて最大2回試行
  let replied = false;
  for (let attempt = 1; attempt <= 2 && !replied; attempt++) {
    await expect(input).toBeEnabled();
    await input.fill("今回の付箋を一言で要約して");
    await send.click();

    // 送信直後は busy（送信ボタンが無効・応答中表示）— 初回は確実に無効化される
    if (attempt === 1) {
      try {
        await expect(send).toBeDisabled();
        await expect(send).toHaveText("応答中…");
        await expect(input).toBeDisabled();
      } finally {
        releaseRequest();
      }
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
