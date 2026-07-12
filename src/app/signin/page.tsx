import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { Wordmark } from "@/components/loop";
import { safeCallbackUrl } from "@/lib/safe-callback";
import { SubmitButton } from "./submit-button";
import { devSignIn } from "./dev-actions";

// ログイン画面：メールアドレスを入れてマジックリンクを送る
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl: rawCallback } = await searchParams;
  // ログイン後の戻り先（招待ページ等）。外部誘導を防ぐため相対パスのみ許可。
  const callbackUrl = safeCallbackUrl(rawCallback);

  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const dest = safeCallbackUrl(String(formData.get("callbackUrl") ?? ""));
    // メール送信のみ行い（redirect:false）、自前の確認画面へ遷移する。
    // マジックリンク自体に戻り先(redirectTo)を埋め込むので、クリック後 dest に着地する。
    await signIn("resend", { email, redirect: false, redirectTo: dest });
    redirect("/signin/verify");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6">
      <Link href="/" className="mx-auto">
        <Wordmark />
      </Link>

      <div className="card p-7">
        <p className="eyebrow">Sign in</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">ログイン</h1>
        <p className="mt-1.5 text-sm text-muted">
          メールアドレスにログイン用のリンクを送ります。パスワードは不要です。
        </p>

        <form action={sendMagicLink} className="mt-6 space-y-3">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <input
            type="email"
            name="email"
            required
            autoFocus
            placeholder="you@example.com"
            className="field"
          />
          <SubmitButton />
        </form>
      </div>

      {process.env.NODE_ENV !== "production" && (
        <div className="card border-dashed p-5">
          <p className="eyebrow text-amber-600">Dev only</p>
          <p className="mt-1 text-sm text-muted">
            開発用：メールアドレスだけでリンクもパスワードもなしに即ログインします。
          </p>
          <form action={devSignIn} className="mt-4 space-y-3">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <input
              type="email"
              name="email"
              required
              placeholder="dev@example.com"
              className="field"
            />
            <button type="submit" className="btn btn-ghost w-full">
              開発ログイン（リンク不要）
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
