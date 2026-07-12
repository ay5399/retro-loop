import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Wordmark } from "@/components/loop";
import { requestToJoin } from "@/app/teams/[teamId]/actions";

// 参加リンク(固定URL)のページ。
// - 未ログイン → ログイン後この画面へ戻す(callbackUrl)
// - 既にメンバー → チームへ
// - 申請済み(PENDING) → 承認待ち表示
// - それ以外 → 「参加を申請する」ボタン（承認不要チームなら即参加）
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 未ログインなら、ログイン後にこの参加ページへ戻す
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/join/${token}`)}`);
  }
  const userId = session.user.id;

  const team = await prisma.team.findUnique({
    where: { joinToken: token },
    select: { id: true, name: true, joinApproval: true },
  });

  // 無効なリンク（再生成後など）
  if (!team) {
    return (
      <JoinShell>
        <p className="eyebrow">Join</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">リンクが無効です</h1>
        <p className="mt-1.5 text-sm text-muted">
          この参加リンクは無効か、再生成された可能性があります。チームの管理者に最新のリンクを確認してください。
        </p>
        <Link href="/teams" className="btn btn-ghost mt-6 w-full">
          自分のチームへ
        </Link>
      </JoinShell>
    );
  }

  // 既にメンバーならチームへ
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId: team.id } },
  });
  if (membership) redirect(`/teams/${team.id}`);

  // 申請状況
  const existingRequest = await prisma.joinRequest.findUnique({
    where: { teamId_userId: { teamId: team.id, userId } },
  });
  const pending = existingRequest?.status === "PENDING";

  async function join() {
    "use server";
    await requestToJoin(token);
  }

  return (
    <JoinShell>
      <p className="eyebrow">Join</p>
      <h1 className="mt-2 font-display text-2xl font-semibold">
        「{team.name}」に参加
      </h1>

      {pending ? (
        <>
          <p className="mt-1.5 text-sm text-muted" data-join-pending>
            参加を申請しました。チームメンバーの承認をお待ちください。
          </p>
          <Link href="/teams" className="btn btn-ghost mt-6 w-full">
            自分のチームへ
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-muted">
            {team.joinApproval
              ? "参加を申請すると、チームメンバーの承認後に加われます。"
              : "参加すると、このチームのふりかえりにすぐ加われます。"}
          </p>
          <form action={join} className="mt-6">
            <button type="submit" className="btn btn-primary w-full" data-join-request>
              {team.joinApproval ? "参加を申請する" : "参加する"}
            </button>
          </form>
        </>
      )}
    </JoinShell>
  );
}

function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6">
      <Link href="/" className="mx-auto">
        <Wordmark />
      </Link>
      <div className="card p-7">{children}</div>
    </main>
  );
}
