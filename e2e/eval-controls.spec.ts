import { test, expect, type Page } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import { loginViaMagicLink } from "./helpers";

const prisma = new PrismaClient();
const TEST_EMAIL = "e2e-eval@example.com";
const TEAM_NAME = "E2E判定コントロールチーム";

// 決定論的にするため AI は使わず Prisma で直接シードする
const CONTENT = {
  worked: "eval-alpha-worked",       // (a) 効いた(WORKED) → 判定を変える
  confirming: "eval-bravo-confirming", // (b) 確認中(outcome=null)
  notWorked: "eval-charlie-notworked", // (c) 効いてない(NOT_WORKED) → 打ち切る
} as const;

let teamId = "";
let retroId = "";
const evalIds: Record<keyof typeof CONTENT, string> = {
  worked: "",
  confirming: "",
  notWorked: "",
};
const actionIds: Record<keyof typeof CONTENT, string> = {
  worked: "",
  confirming: "",
  notWorked: "",
};

test.beforeAll(async () => {
  // 前回残骸の掃除
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });

  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, name: "E2E Eval" },
  });
  const team = await prisma.team.create({ data: { name: TEAM_NAME } });
  teamId = team.id;
  await prisma.membership.create({ data: { userId: user.id, teamId } });

  const retro = await prisma.retrospective.create({
    data: { teamId, name: "判定コントロール回" },
  });
  retroId = retro.id;

  // パネルが判定を表示する条件: R に Reflection が1件(hasRun) ＋ R宛ての ActionEvaluation
  await prisma.reflection.create({
    data: {
      retrospectiveId: retroId,
      model: "mock",
      questions: [] as unknown as Prisma.InputJsonValue,
      rawOutput: {
        evaluations: [],
        probes: [],
        proposedActions: [],
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // (a) WORKED
  const aWorked = await prisma.action.create({
    data: { teamId, createdInRetrospectiveId: retroId, content: CONTENT.worked, status: "DONE" },
  });
  actionIds.worked = aWorked.id;
  const evWorked = await prisma.actionEvaluation.create({
    data: {
      actionId: aWorked.id,
      evaluatedInRetrospectiveId: retroId,
      outcome: "WORKED",
      source: "AI",
      reason: "Keep に改善の言及があり効果があったと読み取れる。",
    },
  });
  evalIds.worked = evWorked.id;

  // (b) 確認中 (outcome=null)
  const aConfirm = await prisma.action.create({
    data: { teamId, createdInRetrospectiveId: retroId, content: CONTENT.confirming, status: "OPEN" },
  });
  actionIds.confirming = aConfirm.id;
  const evConfirm = await prisma.actionEvaluation.create({
    data: {
      actionId: aConfirm.id,
      evaluatedInRetrospectiveId: retroId,
      outcome: null,
      source: "AI",
      question: "本当に効きましたか?",
    },
  });
  evalIds.confirming = evConfirm.id;

  // (c) NOT_WORKED
  const aNot = await prisma.action.create({
    data: { teamId, createdInRetrospectiveId: retroId, content: CONTENT.notWorked, status: "OPEN" },
  });
  actionIds.notWorked = aNot.id;
  const evNot = await prisma.actionEvaluation.create({
    data: {
      actionId: aNot.id,
      evaluatedInRetrospectiveId: retroId,
      outcome: "NOT_WORKED",
      source: "AI",
      reason: "同種の Problem が今回も挙がっており改善が根付いていない。",
    },
  });
  evalIds.notWorked = evNot.id;
});

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

// action の content で行(li)をスコープする
function row(page: Page, content: string) {
  return page.locator("li", { hasText: content });
}
// 行の先頭バッジ(= outcome ラベル)
function topBadge(page: Page, content: string) {
  return row(page, content).locator("span.badge").first();
}

test("AI判定の確定・繰り越しコントロールが動く", async ({ page }) => {
  await loginViaMagicLink(page, TEST_EMAIL);
  await page.goto(`/teams/${teamId}/retros/${retroId}`);

  await expect(page.getByText("前回アクションの判定")).toBeVisible();

  // 初期状態の確認
  await expect(topBadge(page, CONTENT.confirming)).toHaveText("確認中");
  await expect(topBadge(page, CONTENT.worked)).toHaveText("効いた");
  await expect(topBadge(page, CONTENT.notWorked)).toHaveText("効いてない");

  // (b) 確認中の行で「効いた」を押す → バッジが「効いた」に
  await row(page, CONTENT.confirming).getByRole("button", { name: "効いた" }).click();
  await expect(topBadge(page, CONTENT.confirming)).toHaveText("効いた");

  // DB: evaluation.outcome=WORKED, source=HUMAN, action.status=DONE
  await expect(async () => {
    const ev = await prisma.actionEvaluation.findUnique({ where: { id: evalIds.confirming } });
    expect(ev?.outcome).toBe("WORKED");
    expect(ev?.source).toBe("HUMAN");
    const act = await prisma.action.findUnique({ where: { id: actionIds.confirming } });
    expect(act?.status).toBe("DONE");
  }).toPass({ timeout: 10_000 });

  // (c) NOT_WORKED の行で「打ち切る」を押す → 状態バッジが「打ち切り済」に
  await row(page, CONTENT.notWorked).getByRole("button", { name: "打ち切る" }).click();
  await expect(row(page, CONTENT.notWorked).getByText("打ち切り済")).toBeVisible();

  // DB: action.status=DROPPED
  await expect(async () => {
    const act = await prisma.action.findUnique({ where: { id: actionIds.notWorked } });
    expect(act?.status).toBe("DROPPED");
  }).toPass({ timeout: 10_000 });

  // (a) WORKED の行で「判定を変える」を開き「効いてない」を押す → バッジが「効いてない」に
  await row(page, CONTENT.worked).getByText("判定を変える").click();
  await row(page, CONTENT.worked).getByRole("button", { name: "効いてない" }).click();
  await expect(topBadge(page, CONTENT.worked)).toHaveText("効いてない");

  await page.screenshot({ path: "e2e/__screens__/eval-controls.png", fullPage: true });
});
