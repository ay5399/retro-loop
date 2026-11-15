import { test, expect } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { loginAsDev } from "./helpers";

const problem = "レビュー待ちが長い";
const action = "レビュー依頼時刻と完了時刻を一件記録する";
const date = "2026-11-16";
const conflict = () => new Prisma.PrismaClientKnownRequestError("dummy conflict", {
  code: "P2034", clientVersion: "6.19.3",
});

// Load the real Server Action. Only authentication, DB and cache boundaries are replaced.
async function isolatedSave(failures: unknown[], changedAt = Infinity) {
  let attempts = 0;
  let committed = 0;
  let reads = 0;
  let invalidations = 0;
  const fixturePrisma = {
    retrospective: { async findFirst(query: unknown) {
      expect(query).toEqual({ where: { id: "retro", teamId: "team",
        team: { memberships: { some: { userId: "self" } } } }, select: { id: true } });
      return { id: "retro" };
    } },
    async $transaction(callback: (tx: unknown) => Promise<unknown>, options: unknown) {
      attempts++;
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      let writes = 0;
      const result = await callback({ note: {
        async findFirst(query: unknown) {
          reads++;
          expect(query).toEqual({ where: { id: "problem", retrospectiveId: "retro",
            authorId: "self", kind: "PROBLEM", retrospective: { teamId: "team",
              team: { memberships: { some: { userId: "self" } } } } }, select: { content: true } });
          return attempts >= changedAt ? { content: "変更されたProblem" } : { content: problem };
        },
        async create(query: unknown) {
          expect(query).toEqual({ data: { retrospectiveId: "retro", authorId: "self", kind: "TRY",
            content: `行動：${action}\n担当：自分（付箋の作成者）\n日付：${date}\n元Problem：${problem}` } });
          writes++;
        },
      } });
      // A failed commit rolls back writes; a new callback must read the source again.
      if (attempts <= failures.length) throw failures[attempts - 1];
      committed += writes;
      return result;
    },
  };
  const bundle = await build({
    entryPoints: [path.resolve("src/app/teams/[teamId]/retros/[retroId]/actions.ts")],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
    plugins: [{ name: "own-try-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(?:@\/lib\/(?:prisma|auth-helpers)|next\/cache)$/ }, args => ({
        path: args.path, external: true,
      }));
    } }],
  });
  const nativeRequire = createRequire(path.resolve("package.json"));
  const boundaryRequire = (name: string) => {
    if (name === "@/lib/prisma") return { prisma: fixturePrisma };
    if (name === "@/lib/auth-helpers") return { requireUser: async () => ({ id: "self" }) };
    if (name === "next/cache") return { revalidatePath: (url: string) => {
      expect(url).toBe("/teams/team/retros/retro");
      invalidations++;
    } };
    return nativeRequire(name);
  };
  const loaded = { exports: {} as { saveOwnTry(team: string, retro: string, form: FormData): Promise<unknown> } };
  new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, boundaryRequire);
  const form = new FormData();
  for (const [key, value] of Object.entries({ action, date, problemId: "problem", problemContent: problem })) form.set(key, value);
  return { save: () => loaded.exports.saveOwnTry("team", "retro", form),
    stats: () => ({ attempts, committed, reads, invalidations }) };
}

test("P2034の後に全体を再試行し、確定一件・通知一回となる", async () => {
  const fixture = await isolatedSave([conflict()]);
  expect(await fixture.save()).toEqual({ problemChanged: false });
  expect(fixture.stats()).toEqual({ attempts: 2, committed: 1, reads: 2, invalidations: 1 });
});

test("P2034が続くと三回で元のエラーを伝播する", async () => {
  const errors = [conflict(), conflict(), conflict()];
  const fixture = await isolatedSave(errors);
  await expect(fixture.save()).rejects.toBe(errors[2]);
  expect(fixture.stats()).toEqual({ attempts: 3, committed: 0, reads: 3, invalidations: 0 });
});

test("三回目の成功も確定一件となる", async () => {
  const fixture = await isolatedSave([conflict(), conflict()]);
  expect(await fixture.save()).toEqual({ problemChanged: false });
  expect(fixture.stats()).toEqual({ attempts: 3, committed: 1, reads: 3, invalidations: 1 });
});

for (const [name, error] of [
  ["別のPrismaエラー", new Prisma.PrismaClientKnownRequestError("dummy constraint", { code: "P2002", clientVersion: "6.19.3" })],
  ["一般エラー", new Error("dummy failure")],
  ["codeだけのオブジェクト", { code: "P2034" }],
] as const) {
  test(`${name}は一回でそのまま伝播する`, async () => {
    const fixture = await isolatedSave([error]);
    await expect(fixture.save()).rejects.toBe(error);
    expect(fixture.stats()).toEqual({ attempts: 1, committed: 0, reads: 1, invalidations: 0 });
  });
}

test("再試行中に元Problemが変わると保存せず再確認結果を返す", async () => {
  const fixture = await isolatedSave([conflict()], 2);
  expect(await fixture.save()).toEqual({ problemChanged: true });
  expect(fixture.stats()).toEqual({ attempts: 2, committed: 0, reads: 2, invalidations: 1 });
});

test("本人の行動・日付・元Problemを確認し、実DBへ一件保存して再表示する", async ({ page }) => {
  const prisma = new PrismaClient();
  const email = "e2e-own-try-conflict@example.com";
  const teamName = "E2E本人Try競合再試行";
  try {
    await prisma.team.deleteMany({ where: { name: teamName } });
    await prisma.user.deleteMany({ where: { email } });
    const user = await prisma.user.create({ data: { email } });
    const team = await prisma.team.create({ data: { name: teamName } });
    await prisma.membership.create({ data: { teamId: team.id, userId: user.id } });
    const retro = await prisma.retrospective.create({ data: { teamId: team.id, name: "本人Try保存" } });
    const source = await prisma.note.create({ data: { retrospectiveId: retro.id, authorId: user.id,
      kind: "PROBLEM", content: problem } });
    await loginAsDev(page, email);
    await page.goto(`/teams/${team.id}/retros/${retro.id}`);
    const form = page.getByRole("region", { name: "自分のTryを確認・保存" });
    await form.getByLabel("元Problem（任意）").selectOption(source.id);
    await form.getByLabel("実行する行動").fill(action);
    await form.getByLabel("実行する日付").fill(date);
    await form.getByRole("button", { name: "保存内容を確認" }).click();
    await expect(form).toContainText(`元Problem：${problem}`);
    await expect(form).toContainText("担当：自分（ログイン中の本人）");
    await expect(form).toContainText(action);
    await expect(form).toContainText(date);
    expect(await prisma.note.count({ where: { retrospectiveId: retro.id, kind: "TRY" } })).toBe(0);
    await page.screenshot({ path: "e2e/__screens__/own-try-conflict-retry-before.png", fullPage: true });
    await form.getByRole("button", { name: "Try付箋として保存", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Try付箋として保存しました");
    const saved = await prisma.note.findMany({ where: { retrospectiveId: retro.id, kind: "TRY" } });
    expect(saved).toHaveLength(1);
    expect(saved[0].authorId).toBe(user.id);
    expect(saved[0].content).toBe(`行動：${action}\n担当：自分（付箋の作成者）\n日付：${date}\n元Problem：${problem}`);
    await page.reload();
    const notes = page.locator('[data-lane="TRY"] [data-note-id]');
    await expect(notes).toHaveCount(1);
    await expect(notes).toContainText(saved[0].content);
    await page.screenshot({ path: "e2e/__screens__/own-try-conflict-retry-after.png", fullPage: true });
  } finally {
    await prisma.team.deleteMany({ where: { name: teamName } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});
