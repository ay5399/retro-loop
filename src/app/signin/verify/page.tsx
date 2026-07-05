// マジックリンク送信後に表示する画面
export default function VerifyRequestPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold">メールを確認してください</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        ログイン用のリンクを送信しました。メール内のリンクを開くとログインできます。
      </p>
      <p className="text-xs text-black/40 dark:text-white/40">
        （開発中はメールではなく、サーバのターミナルにリンクが表示されます）
      </p>
    </main>
  );
}
