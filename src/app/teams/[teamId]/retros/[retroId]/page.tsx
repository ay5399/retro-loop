import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { AppHeader } from "@/components/app-header";
import { LoopMark } from "@/components/loop";
import { ReflectionResultSchema } from "@/lib/llm/reflection";
import { KptBoardClient } from "./kpt-board.client";
import { ReflectionPanel } from "./reflection-panel";

export default async function RetrospectivePage({
  params,
}: {
  params: Promise<{ teamId: string; retroId: string }>;
}) {
  const { teamId, retroId } = await params;
  const user = await requireUser();

  const retro = await prisma.retrospective.findFirst({
    where: {
      id: retroId,
      teamId,
      team: { memberships: { some: { userId: user.id } } },
    },
    include: {
      team: true,
      previous: true,
      notes: { orderBy: [{ kind: "asc" }, { order: "asc" }], include: { votes: true } },
      noteGroups: true,
      reflections: { orderBy: { createdAt: "desc" }, take: 1 },
      actionEvaluations: { include: { action: true }, orderBy: { createdAt: "asc" } },
      createdActions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!retro) notFound();

  const noteDtos = retro.notes.map((n) => ({
    id: n.id,
    kind: n.kind,
    content: n.content,
    order: n.order,
    color: n.color,
    groupId: n.groupId,
    voteCount: n.votes.length,
    hasVoted: n.votes.some((v) => v.userId === user.id),
  }));

  const groups = retro.noteGroups.map((g) => ({
    id: g.id,
    kind: g.kind,
    name: g.name,
  }));

  // このふりかえりで現在ユーザーが使った票数（取得済みの notes.votes から集計）
  const votesUsed = retro.notes.reduce(
    (sum, n) => sum + (n.votes.some((v) => v.userId === user.id) ? 1 : 0),
    0,
  );

  const latest = retro.reflections[0] ?? null;
  const parsed = latest ? ReflectionResultSchema.safeParse(latest.rawOutput) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-12 lg:px-8">
        <header className="max-w-3xl space-y-2">
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
          <KptBoardClient teamId={teamId} retroId={retroId} notes={noteDtos} votesUsed={votesUsed} groups={groups} />
        </section>

        <div className="w-full max-w-3xl">
          <ReflectionPanel
            teamId={teamId}
            retroId={retroId}
            hasRun={latest !== null}
            model={latest?.model ?? null}
            reflectionId={latest?.id ?? null}
            evaluations={retro.actionEvaluations.map((ev) => ({
              evaluationId: ev.id,
              actionId: ev.actionId,
              actionStatus: ev.action.status,
              actionContent: ev.action.content,
              outcome: ev.outcome,
              reason: ev.reason,
              question: ev.question,
            }))}
            probes={parsed?.success ? parsed.data.probes : []}
            proposedActions={parsed?.success ? parsed.data.proposedActions : []}
            adoptedActions={retro.createdActions.map((a) => ({
              id: a.id,
              content: a.content,
              status: a.status,
            }))}
          />
        </div>
      </main>
    </div>
  );
}
