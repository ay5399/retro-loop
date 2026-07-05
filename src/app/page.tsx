import Link from "next/link";
import { auth, signOut } from "@/auth";
import { LoopThread, Wordmark } from "@/components/loop";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex min-h-screen flex-col">
      {/* ヘッダー */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Wordmark />
        {session?.user ? (
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
        ) : (
          <Link href="/signin" className="btn btn-ghost">
            ログイン
          </Link>
        )}
      </header>

      {/* ヒーロー：主役は「AIの問い返し」そのもの */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center gap-14 px-6 py-16 md:flex-row md:items-center md:gap-8 md:py-24">
        <div className="flex-1 space-y-7">
          <p className="eyebrow">AI Retrospective</p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-[3.4rem]">
            その改善策、
            <br />
            <span className="text-iris">本当に効いてる？</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted">
            RetroLoop は付箋を整理するだけのAIじゃない。前回のアクションが効いたかを
            <span className="text-ink">問い返し</span>、改善が根付くまで
            <span className="text-ink">追いかける</span>。ふりかえりの、閉じるループ。
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {session?.user ? (
              <Link href="/teams" className="btn btn-primary">
                チームへ進む →
              </Link>
            ) : (
              <Link href="/signin" className="btn btn-primary">
                はじめる →
              </Link>
            )}
            <span className="text-sm text-muted">メールでログインするだけ</span>
          </div>
        </div>

        {/* 署名要素：閉じかけたループ */}
        <div className="flex flex-1 items-center justify-center">
          <div className="relative">
            <LoopThread size={300} className="drop-shadow-sm" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-[8rem] text-center font-display text-sm font-medium leading-snug text-muted">
                前回のアクションを、次で問い返す
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* 3本柱 */}
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-3">
        {[
          {
            n: "問い返す",
            d: "「その再発防止、形骸化してない?」と先輩スクラムマスターのように聞き返す。",
          },
          {
            n: "自動で判定",
            d: "前回のアクションが効いたかを付箋から推し量る。分からなければ、あなたに尋ねる。",
          },
          {
            n: "ループを閉じる",
            d: "効かなかった改善を次のふりかえりへ。根付くまで追い続ける。",
          },
        ].map((f, i) => (
          <div key={f.n} className="card p-5">
            <p className="eyebrow">0{i + 1}</p>
            <h3 className="mt-2 font-display text-lg font-semibold">{f.n}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
