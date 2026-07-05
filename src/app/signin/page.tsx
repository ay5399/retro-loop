import { signIn } from "@/auth";

// ログイン画面：メールアドレスを入れてマジックリンクを送る
export default function SignInPage() {
  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    // 成功すると Auth.js が /signin/verify にリダイレクトする
    await signIn("resend", { email, redirectTo: "/" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">RetroLoop にログイン</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          メールアドレスにログイン用リンクを送ります。
        </p>
      </div>

      <form action={sendMagicLink} className="space-y-4">
        <input
          type="email"
          name="email"
          required
          autoFocus
          placeholder="you@example.com"
          className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          ログインリンクを送る
        </button>
      </form>
    </main>
  );
}
