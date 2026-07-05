import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { AppHeader } from "@/components/app-header";
import { createTeam } from "./actions";

export default async function TeamsPage() {
  const user = await requireUser();

  const teams = await prisma.team.findMany({
    where: { memberships: { some: { userId: user.id } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
        <header className="space-y-1">
          <p className="eyebrow">Teams</p>
          <h1 className="font-display text-2xl font-semibold">チーム</h1>
          <p className="text-sm text-muted">
            ふりかえりを行うチームを選ぶ、または新しく作る。
          </p>
        </header>

        <section className="space-y-3">
          {teams.length === 0 ? (
            <p className="card p-6 text-sm text-muted">
              まだチームがありません。下から最初のチームを作りましょう。
            </p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {teams.map((team) => (
                <li key={team.id}>
                  <Link
                    href={`/teams/${team.id}`}
                    className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-surface-2"
                  >
                    <span className="font-display font-medium">{team.name}</span>
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
          <p className="eyebrow">New team</p>
          <form action={createTeam} className="flex gap-2">
            <input
              type="text"
              name="name"
              required
              placeholder="例：開発チーム"
              className="field"
            />
            <button type="submit" className="btn btn-primary shrink-0">
              作成
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
