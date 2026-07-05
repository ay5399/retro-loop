// お試し用データ投入（ay5399@gmail.com）
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const EMAIL = "ay5399@gmail.com";
const TEAM = "開発チーム α";

const user = await prisma.user.upsert({
  where: { email: EMAIL },
  update: {},
  create: { email: EMAIL },
});

// 同名のお試しチームがあれば作り直す
await prisma.team.deleteMany({ where: { name: TEAM, memberships: { some: { userId: user.id } } } });

const team = await prisma.team.create({
  data: { name: TEAM, memberships: { create: { userId: user.id } } },
});

// 1回目のふりかえり（前回アクションあり＝2回目で判定される）
const r1 = await prisma.retrospective.create({
  data: { teamId: team.id, name: "Sprint 3 ふりかえり" },
});
await prisma.note.createMany({
  data: [
    { retrospectiveId: r1.id, authorId: user.id, kind: "KEEP", content: "デイリーが短く終わるようになった" },
    { retrospectiveId: r1.id, authorId: user.id, kind: "PROBLEM", content: "PRレビューの観点が人によってバラバラ" },
    { retrospectiveId: r1.id, authorId: user.id, kind: "TRY", content: "レビュー観点をテンプレ化する" },
  ],
});
// r1で確定したアクション（OPEN＝次回の判定対象）
await prisma.action.create({
  data: { teamId: team.id, createdInRetrospectiveId: r1.id, content: "PRレビューの観点チェックリストを作る" },
});

// 2回目のふりかえり（前回=r1）
const r2 = await prisma.retrospective.create({
  data: { teamId: team.id, name: "Sprint 4 ふりかえり", previousRetrospectiveId: r1.id },
});
await prisma.note.createMany({
  data: [
    { retrospectiveId: r2.id, authorId: user.id, kind: "KEEP", content: "レビューの指摘が均一になってきた" },
    { retrospectiveId: r2.id, authorId: user.id, kind: "PROBLEM", content: "テスト不足でリリース後にバグが出た" },
    { retrospectiveId: r2.id, authorId: user.id, kind: "PROBLEM", content: "見積もりが甘くスプリント末に残業した" },
    { retrospectiveId: r2.id, authorId: user.id, kind: "TRY", content: "着手前にテストケースを洗い出す" },
  ],
});

console.log("投入完了");
console.log("TEAM_URL=/teams/" + team.id);
console.log("R2_URL=/teams/" + team.id + "/retros/" + r2.id + "  ← ここで『AIに問い返してもらう』を押すと前回アクションが判定されます");
await prisma.$disconnect();
