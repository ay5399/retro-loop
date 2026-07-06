"use client";

import { useFormStatus } from "react-dom";

// 送信ボタン。送信中は無効化して二度押しによる二重送信を防ぐ。
export function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full">
      {pending ? "送信中…" : "ログインリンクを送る"}
    </button>
  );
}
