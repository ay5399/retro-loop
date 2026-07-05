import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";

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
    include: { team: true, previous: true },
  });
  if (!retro) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="space-y-1">
        <Link
          href={`/teams/${teamId}`}
          className="text-xs text-black/50 transition-colors hover:text-black dark:text-white/50 dark:hover:text-white"
        >
          ← {retro.team.name}
        </Link>
        <h1 className="text-2xl font-bold">{retro.name}</h1>
        {retro.previous ? (
          <p className="text-xs text-black/50 dark:text-white/50">
            前回：{retro.previous.name}
          </p>
        ) : (
          <p className="text-xs text-black/40 dark:text-white/40">
            最初のふりかえり（前回なし）
          </p>
        )}
      </div>

      <section className="rounded-md border border-dashed border-black/15 p-6 text-sm text-black/50 dark:border-white/20 dark:text-white/50">
        KPT付箋・AI問い返しはこの後のステップで実装します。
      </section>
    </main>
  );
}
