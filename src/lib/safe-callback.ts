// ログイン後のリダイレクト先(callbackUrl)を安全な相対パスに限定する。
// オープンリダイレクト防止：自サイト内の絶対パス("/..." )だけ許可し、
// プロトコル相対("//evil.com")やバックスラッシュ細工は弾く。
export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback = "/teams",
): string {
  if (!raw) return fallback;
  // "/" 始まりのみ許可。ただし "//" や "/\" は外部誘導になり得るので除外
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  return raw;
}
