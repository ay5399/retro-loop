import Link from "next/link";
import { Wordmark } from "@/components/loop";

// マジックリンク送信後に表示する画面
export default function VerifyRequestPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6">
      <Link href="/" className="mx-auto">
        <Wordmark />
      </Link>

      <div className="card p-7 text-center">
        <p className="eyebrow">Check your inbox</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">
          メールを確認してください
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          ログイン用のリンクを送信しました。メール内のリンクを開くとログインできます。
        </p>
        <p className="mt-4 border-t border-line pt-4 text-xs text-muted">
          開発中はメールではなく、サーバのターミナルにリンクが表示されます。
        </p>
      </div>
    </main>
  );
}
