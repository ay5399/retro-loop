// 実Geminiでの問い返しデモ: データを仕込み、retro2でAI問い返しを実行してスクショ。
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, rmSync } from "node:fs";

const prisma = new PrismaClient();
const EMAIL = "demo-gemini@example.com";
const BASE = "http://localhost:3000";

// ── データ投入 ──
const user = await prisma.user.upsert({
  where: { email: EMAIL },
  update: {},
  create: { email: EMAIL, name: "デモ" },
});
await prisma.team.deleteMany({ where: { name: "Geminiデモチーム" } });
const team = await prisma.team.create({
  data: { name: "Geminiデモチーム", memberships: { create: { userId: user.id } } },
});
const r1 = await prisma.retrospective.create({ data: { teamId: team.id, name: "Sprint 7 振り返り" } });
const r2 = await prisma.retrospective.create({
  data: { teamId: team.id, name: "Sprint 8 振り返り", previousRetrospectiveId: r1.id },
});
// 前回(r1)のOPENアクション（判定対象）
await prisma.action.create({
  data: { teamId: team.id, createdInRetrospectiveId: r1.id, content: "コードレビューの担当を輪番制にする" },
});
// 今回(r2)の付箋
const notes = [
  ["PROBLEM", "レビュー待ちでタスクが滞留しがち"],
  ["PROBLEM", "リリース手順が人によってばらつく"],
  ["KEEP", "輪番制でレビューの偏りは少し減った"],
  ["TRY", "リリース手順書を作る"],
];
for (const [kind, content] of notes)
  await prisma.note.create({ data: { retrospectiveId: r2.id, authorId: user.id, kind, content } });

// ── ログイン → 問い返し実行 → スクショ ──
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

if (existsSync(".magic-link.dev")) rmSync(".magic-link.dev");
await page.goto(BASE + "/signin");
await page.getByPlaceholder("you@example.com").fill(EMAIL);
await page.getByRole("button", { name: "ログインリンクを送る" }).click();
let link = "";
for (let i = 0; i < 60 && !link; i++) {
  if (existsSync(".magic-link.dev")) link = readFileSync(".magic-link.dev", "utf8").trim();
  if (!link) await new Promise((r) => setTimeout(r, 100));
}
await page.goto(link);
await page.waitForURL((u) => !u.pathname.startsWith("/signin"));

await page.goto(`${BASE}/teams/${team.id}/retros/${r2.id}`);
await page.getByRole("button", { name: "AIに問い返してもらう" }).click();
// 実Geminiの応答待ち
await page.getByText("問い返し", { exact: true }).waitFor({ timeout: 45000 });
await page.waitForTimeout(500);
await page.screenshot({ path: "e2e/__screens__/gemini-reflection.png", fullPage: true });
console.log("screenshot saved");

await browser.close();
await prisma.$disconnect();
