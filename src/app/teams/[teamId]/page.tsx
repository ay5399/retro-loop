import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { createRetrospective } from "./actions";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const user = await requireUser();

  // 自分がメンバーのチームだけ表示（他人のチームは 404 扱い）
  const team = await prisma.team.findFirst({
    where: { id: teamId, memberships: { some: { userId: user.id } } },
    include: {
      retrospectives: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!team) notFound();

  const createRetroForTeam = createRetrospective.bind(null, teamId);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16">
      <div className="space-y-1">
        <Link
          href="/teams"
          className="text-xs text-black/50 transition-colors hover:text-black dark:text-white/50 dark:hover:text-white"
        >
          ← チーム一覧
        </Link>
        <h1 className="text-2xl font-bold">{team.name}</h1>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">
          ふりかえり
        </h2>
        {team.retrospectives.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">
            まだふりかえりがありません。下から作成してください。
          </p>
        ) : (
          <ul className="divide-y divide-black/10 rounded-md border border-black/10 dark:divide-white/10 dark:border-white/15">
            {team.retrospectives.map((retro) => (
              <li key={retro.id}>
                <Link
                  href={`/teams/${teamId}/retros/${retro.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span className="font-medium">{retro.name}</span>
                  <span aria-hidden className="text-black/30 dark:text-white/30">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">
          新しいふりかえりを作る
        </h2>
        <form action={createRetroForTeam} className="flex gap-2">
          <input
            type="text"
            name="name"
            required
            placeholder="例：Sprint 12 振り返り"
            className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          />
          <button
            type="submit"
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            作成
          </button>
        </form>
        <p className="text-xs text-black/40 dark:text-white/40">
          直近のふりかえりが自動で「前回」として紐付き、効果追跡ループがつながります。
        </p>
      </section>
    </main>
  );
}
