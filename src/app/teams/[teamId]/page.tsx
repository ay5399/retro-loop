import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { AppHeader } from "@/components/app-header";
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
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
        <header className="space-y-2">
          <Link href="/teams" className="eyebrow hover:text-ink">
            ← Teams
          </Link>
          <h1 className="font-display text-2xl font-semibold">{team.name}</h1>
        </header>

        <section className="space-y-3">
          <p className="eyebrow">Retrospectives</p>
          {team.retrospectives.length === 0 ? (
            <p className="card p-6 text-sm text-muted">
              まだふりかえりがありません。下から作成してください。
            </p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {team.retrospectives.map((retro) => (
                <li key={retro.id}>
                  <Link
                    href={`/teams/${teamId}/retros/${retro.id}`}
                    className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-surface-2"
                  >
                    <span className="font-display font-medium">{retro.name}</span>
                    <span aria-hidden className="text-muted">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-3 p-5">
          <p className="eyebrow">New retrospective</p>
          <form action={createRetroForTeam} className="flex gap-2">
            <input
              type="text"
              name="name"
              required
              placeholder="例：Sprint 12 振り返り"
              className="field"
            />
            <button type="submit" className="btn btn-primary shrink-0">
              作成
            </button>
          </form>
          <p className="text-xs text-muted">
            直近のふりかえりが自動で「前回」として紐付き、効果追跡ループがつながります。
          </p>
        </section>
      </main>
    </div>
  );
}
