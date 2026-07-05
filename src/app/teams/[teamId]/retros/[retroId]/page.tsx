import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { AppHeader } from "@/components/app-header";
import { LoopMark } from "@/components/loop";
import { KptBoard } from "./kpt-board";

export default async function RetrospectivePage({
  params,
}: {
  params: Promise<{ teamId: string; retroId: string }>;
}) {
  const { teamId, retroId } = await params;
  const user = await requireUser();

  // メンバーのチームのふりかえりだけ表示
  const retro = await prisma.retrospective.findFirst({
    where: {
      id: retroId,
      teamId,
      team: { memberships: { some: { userId: user.id } } },
    },
    include: {
      team: true,
      previous: true,
      notes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!retro) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <Link href={`/teams/${teamId}`} className="eyebrow hover:text-ink">
            ← {retro.team.name}
          </Link>
          <h1 className="font-display text-2xl font-semibold">{retro.name}</h1>
          {retro.previous ? (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <LoopMark size={16} />
              前回：{retro.previous.name}
            </p>
          ) : (
            <p className="text-sm text-muted">最初のふりかえり（前回なし）</p>
          )}
        </header>

        <section className="space-y-3">
          <p className="eyebrow">KPT</p>
          <KptBoard teamId={teamId} retroId={retroId} notes={retro.notes} />
        </section>

        <section className="card border-dashed p-6 text-sm text-muted">
          <p className="eyebrow mb-1">Coming next</p>
          AI問い返しはこの後のステップで実装します。
        </section>
      </main>
    </div>
  );
}
