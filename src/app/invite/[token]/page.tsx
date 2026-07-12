import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Wordmark } from "@/components/loop";
import { acceptInvitation } from "@/app/teams/[teamId]/actions";

// 招待受諾ページ。参加ボタンの submit で acceptInvitation を実行する。
// 未ログインならログイン後にこのページへ戻すため、callbackUrl 付きで /signin へ誘導する。
export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 未ログインなら、ログイン後にこの招待ページへ戻す
  const session = await auth();
  if (!session?.user?.id) {
    const callbackUrl = encodeURIComponent(`/invite/${token}`);
    redirect(`/signin?callbackUrl=${callbackUrl}`);
  }

  async function accept() {
    "use server";
    await acceptInvitation(token);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6">
      <Link href="/" className="mx-auto">
        <Wordmark />
      </Link>

      <div className="card p-7">
        <p className="eyebrow">Invitation</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">チームに招待されています</h1>
        <p className="mt-1.5 text-sm text-muted">
          参加すると、このチームのふりかえりに加われます。下のボタンから参加してください。
        </p>

        <form action={accept} className="mt-6">
          <button type="submit" className="btn btn-primary w-full" data-invite-accept>
            参加する
          </button>
        </form>
      </div>
    </main>
  );
}
