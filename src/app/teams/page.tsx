import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { createTeam } from "./actions";

export default async function TeamsPage() {
  const user = await requireUser();

  const teams = await prisma.team.findMany({
    where: { memberships: { some: { userId: user.id } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">チーム</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          ふりかえりを行うチームを選ぶ、または新しく作る。
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">
          あなたのチーム
        </h2>
        {teams.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">
            まだチームがありません。下から作成してください。
          </p>
        ) : (
          <ul className="divide-y divide-black/10 rounded-md border border-black/10 dark:divide-white/10 dark:border-white/15">
            {teams.map((team) => (
              <li key={team.id}>
                <Link
                  href={`/teams/${team.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span className="font-medium">{team.name}</span>
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
          新しいチームを作る
        </h2>
        <form action={createTeam} className="flex gap-2">
          <input
            type="text"
            name="name"
            required
            placeholder="例：開発チーム"
            className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          />
          <button
            type="submit"
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            作成
          </button>
        </form>
      </section>
    </main>
  );
}
