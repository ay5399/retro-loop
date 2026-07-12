"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { safeCallbackUrl } from "@/lib/safe-callback";

// 開発専用：メールアドレスだけで即ログインする（マジックリンク不要・パスワード不要）。
// 本番では絶対に動かさない。DBセッション方式(strategy:"database")なので、
// Auth.js と同じ Session 行を直接作り、同じ名前のクッキーを張ることでログイン扱いにする。
export async function devSignIn(formData: FormData) {
  // 二重ガード：本番では即リダイレクトして何もしない
  if (process.env.NODE_ENV === "production") {
    redirect("/signin");
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/signin");
  }
  // ログイン後の戻り先（招待ページ等）。外部誘導を防ぐため相対パスのみ許可。
  const dest = safeCallbackUrl(String(formData.get("callbackUrl") ?? ""));

  // User を用意（無ければ作る）。マジックリンク経由と同じく emailVerified を立てておく。
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, emailVerified: new Date() },
  });

  // Auth.js のDBセッションと同じ仕組みで Session 行を作成
  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30日（Auth.js既定）
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  // Auth.js v5 のセッションクッキー名。開発は非secureなので "authjs.session-token"
  const cookieStore = await cookies();
  cookieStore.set("authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });

  redirect(dest);
}
