import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";

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
  });
  if (!team) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="space-y-1">
        <Link
          href="/teams"
          className="text-xs text-black/50 transition-colors hover:text-black dark:text-white/50 dark:hover:text-white"
        >
          ← チーム一覧
        </Link>
        <h1 className="text-2xl font-bold">{team.name}</h1>
      </div>

      <section className="rounded-md border border-dashed border-black/15 p-6 text-sm text-black/50 dark:border-white/20 dark:text-white/50">
        ふりかえりの一覧・作成はこの後のステップで実装します。
      </section>
    </main>
  );
}
