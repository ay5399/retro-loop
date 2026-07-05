// スクショ用のデモデータ投入。teamId / retroId を出力する。
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const EMAIL = "shot@example.com";

const user = await prisma.user.upsert({
  where: { email: EMAIL },
  update: {},
  create: { email: EMAIL, name: "デモ" },
});

// クリーンにするため既存デモチームを消す
await prisma.team.deleteMany({ where: { name: "プロダクト開発チーム" } });

const team = await prisma.team.create({
  data: { name: "プロダクト開発チーム", memberships: { create: { userId: user.id } } },
});

const r1 = await prisma.retrospective.create({
  data: { teamId: team.id, name: "Sprint 11 振り返り" },
});
const r2 = await prisma.retrospective.create({
  data: { teamId: team.id, name: "Sprint 12 振り返り", previousRetrospectiveId: r1.id },
});

const notes = [
  ["KEEP", "コードレビューが1日以内に回るようになった"],
  ["KEEP", "デイリーが15分で終わっている"],
  ["PROBLEM", "リリース直前に想定外のバグが出た"],
  ["PROBLEM", "仕様変更の共有が遅れて手戻りした"],
  ["TRY", "着手前に受け入れ条件をチームで確認する"],
];
for (const [kind, content] of notes) {
  await prisma.note.create({
    data: { retrospectiveId: r2.id, authorId: user.id, kind, content },
  });
}

console.log("TEAM=" + team.id);
console.log("RETRO=" + r2.id);
await prisma.$disconnect();
