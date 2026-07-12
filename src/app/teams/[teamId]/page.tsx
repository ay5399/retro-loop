import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { AppHeader } from "@/components/app-header";
import { createRetrospective } from "./actions";
import { MembersSection } from "./members-section";

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
      memberships: { include: { user: true } },
      joinRequests: {
        where: { status: "PENDING" },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!team) notFound();

  const createRetroForTeam = createRetrospective.bind(null, teamId);

  const members = team.memberships.map((m) => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
  }));
  const pendingRequests = team.joinRequests.map((r) => ({
    id: r.id,
    name: r.user.name,
    email: r.user.email,
  }));
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 py-12">
        <header className="space-y-2">
          <Link href="/teams" className="eyebrow hover:text-ink">
            ← Teams
          </Link>
          <h1 className="font-display text-2xl font-semibold">{team.name}</h1>
        </header>

        {/* ── ふりかえり（一覧＋作成をひとまとめ） ── */}
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold">ふりかえり</h2>
            <span className="eyebrow">Retrospectives</span>
          </div>

          {team.retrospectives.length === 0 ? (
            <p className="card p-6 text-sm text-muted">
              まだふりかえりがありません。下のフォームから作成してください。
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

          <div className="card space-y-3 p-5">
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
          </div>
        </section>

        {/* ── メンバー（一覧＋参加リンク＋申請をひとまとめ） ── */}
        <MembersSection
          teamId={teamId}
          members={members}
          pendingRequests={pendingRequests}
          joinToken={team.joinToken}
          joinApproval={team.joinApproval}
          baseUrl={baseUrl}
        />
      </main>
    </div>
  );
}
