import Link from "next/link";
import { auth, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold">RetroLoop</h1>
        <p className="text-black/60 dark:text-white/60">
          問い返して、改善が根付くまで追う AI ふりかえりツール。
        </p>
      </div>

      {session?.user ? (
        <div className="space-y-4">
          <p className="text-sm">
            ログイン中：
            <span className="font-medium">
              {session.user.email ?? session.user.name}
            </span>
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/teams"
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              チームへ
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-black/15 px-3 py-2 text-sm transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div>
          <Link
            href="/signin"
            className="inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            ログイン
          </Link>
        </div>
      )}
    </main>
  );
}
