import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { Wordmark } from "@/components/loop";
import { SubmitButton } from "./submit-button";

// ログイン画面：メールアドレスを入れてマジックリンクを送る
export default function SignInPage() {
  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    // メール送信のみ行い（redirect:false）、自前の確認画面へ遷移する
    await signIn("resend", { email, redirect: false, redirectTo: "/" });
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
    </main>
  );
}
