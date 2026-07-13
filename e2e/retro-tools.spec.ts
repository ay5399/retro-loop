import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildRetroSummary, buildRecurringIssues } from "../src/lib/llm/retro-tools";

// AIチャットのツール（summarizeRetro / flagRecurringIssues）が使うデータ取得ロジックの
// 決定論的検証。LLMを介さず純粋関数を直接叩く（無料枠を消費しない）。
const prisma = new PrismaClient();

const EMAIL = "e2e-tools@example.com";
const TEAM_NAME = "E2Eツールチーム";

let teamId = "";
let userId = "";
let oldRetroId = "";
let newRetroId = "";

async function cleanup() {
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

test.beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Tools" } });
  userId = user.id;
  const team = await prisma.team.create({ data: { name: TEAM_NAME } });
  teamId = team.id;
  await prisma.membership.create({ data: { userId, teamId } });

  // 前回ふりかえり（積み残し検知の材料）
  const oldRetro = await prisma.retrospective.create({
    data: { teamId, name: "Sprint 1" },
  });
  oldRetroId = oldRetro.id;
  await prisma.note.createMany({
    data: [
      { retrospectiveId: oldRetroId, authorId: userId, kind: "TRY", content: "自動テストを増やす", order: 0 },
      { retrospectiveId: oldRetroId, authorId: userId, kind: "PROBLEM", content: "デプロイが手動で不安定", order: 0 },
      { retrospectiveId: oldRetroId, authorId: userId, kind: "KEEP", content: "朝会が短い", order: 0 },
    ],
  });

  // 今回ふりかえり（前回にリンク）
  const newRetro = await prisma.retrospective.create({
    data: { teamId, name: "Sprint 2", previousRetrospectiveId: oldRetroId },
  });
  newRetroId = newRetro.id;
  await prisma.note.createMany({
    data: [
      { retrospectiveId: newRetroId, authorId: userId, kind: "TRY", content: "自動テストを増やす", order: 0 },
      { retrospectiveId: newRetroId, authorId: userId, kind: "PROBLEM", content: "レビューが遅い", order: 0 },
      { retrospectiveId: newRetroId, authorId: userId, kind: "PROBLEM", content: "レビューが遅い(2)", order: 1 },
    ],
  });
  // 「レビューが遅い」に票を入れて総括で上位に来ることを確認
  const reviewNote = await prisma.note.findFirstOrThrow({
    where: { retrospectiveId: newRetroId, content: "レビューが遅い" },
  });
  await prisma.noteVote.create({ data: { noteId: reviewNote.id, userId } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("buildRetroSummary: 付箋を種別ごと・投票数順に集計する", async () => {
  const summary = await buildRetroSummary(newRetroId);
  expect(summary).not.toBeNull();
  expect(summary!.retroName).toBe("Sprint 2");
  expect(summary!.counts).toEqual({ keep: 0, problem: 2, try: 1 });

  // Problem は投票数の多い順（票が入った「レビューが遅い」が先頭）
  expect(summary!.problem[0].content).toBe("レビューが遅い");
  expect(summary!.problem[0].votes).toBe(1);
  expect(summary!.try.map((t) => t.content)).toContain("自動テストを増やす");
});

test("buildRecurringIssues: 前回の Try/Problem を遡って集める", async () => {
  const rec = await buildRecurringIssues(newRetroId);
  expect(rec.hasHistory).toBe(true);
  expect(rec.previous).toHaveLength(1);
  expect(rec.previous[0].retroName).toBe("Sprint 1");
  expect(rec.previous[0].tries).toContain("自動テストを増やす");
  expect(rec.previous[0].problems).toContain("デプロイが手動で不安定");

  // 今回の Try に前回と同じ「自動テストを増やす」がある＝未定着の検知材料
  expect(rec.current.tries).toContain("自動テストを増やす");
  const repeated = rec.current.tries.filter((t) =>
    rec.previous.some((p) => p.tries.includes(t)),
  );
  expect(repeated).toContain("自動テストを増やす");
});

test("buildRecurringIssues: 前回が無いふりかえりは hasHistory=false", async () => {
  const rec = await buildRecurringIssues(oldRetroId);
  expect(rec.hasHistory).toBe(false);
  expect(rec.previous).toHaveLength(0);
  expect(rec.current.tries).toContain("自動テストを増やす");
});
