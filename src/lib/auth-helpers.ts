import { redirect } from "next/navigation";
import { auth } from "@/auth";

// ログイン必須のページ/アクションで使う。未ログインなら /signin へ飛ばす。
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  return session.user as { id: string; email?: string | null; name?: string | null };
}
