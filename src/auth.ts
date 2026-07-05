import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/prisma";

// RetroLoop の認証（Auth.js v5 / マジックリンク）
// - DBに User/Session を保存する「データベースセッション」方式（Prismaアダプタ）
// - メール送信：本番は Resend、開発中はマジックリンクをターミナルに出力（メール設定なしで試せる）
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // localhost / Vercel 以外でもホストを信頼（Auth.js v5 で必要）
  trustHost: true,
  session: { strategy: "database" },
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/verify",
  },
  callbacks: {
    // データベースセッションでは user(DBレコード) が渡るので、id をセッションに載せる
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  providers: [
    Resend({
      // 未設定なら開発フォールバック（下の sendVerificationRequest でターミナル出力のみ）
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM ?? "onboarding@resend.dev",
      async sendVerificationRequest({ identifier: email, url, provider }) {
        // 開発中は必ずリンクをサーバのターミナルに出す（クリックすればログインできる）
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `\n🔑 [DEV] ${email} のログインリンク:\n${url}\n（このリンクをブラウザで開くとログインできます）\n`,
          );
          // E2Eテスト用フック：最新のマジックリンクをファイルにも書き出す（.gitignore済み）
          try {
            const { writeFileSync } = await import("node:fs");
            writeFileSync(".magic-link.dev", url, "utf8");
          } catch {
            // ファイル書き込みに失敗しても本処理は続行
          }
        }

        // Resend のキーが無ければ実メールは送らない（＝開発はターミナル出力で完結）
        const apiKey = provider.apiKey;
        if (!apiKey) return;

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: provider.from,
            to: email,
            subject: "RetroLoop へのログイン",
            html: `<p><a href="${url}">RetroLoop にログイン</a></p><p>心当たりがなければ、このメールは無視してください。</p>`,
            text: `RetroLoop にログイン: ${url}\n心当たりがなければ無視してください。`,
          }),
        });

        if (!res.ok) {
          const detail = await res.text();
          throw new Error(`Resend への送信に失敗しました: ${detail}`);
        }
      },
    }),
  ],
});
