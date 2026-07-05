import Link from "next/link";
import { auth, signOut } from "@/auth";
import { Wordmark } from "@/components/loop";

// ログイン後の共通ヘッダー
export async function AppHeader() {
  const session = await auth();

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/teams" aria-label="RetroLoop ホーム">
          <Wordmark />
        </Link>
        {session?.user && (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">
              {session.user.email ?? session.user.name}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="btn btn-ghost">
                ログアウト
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
