"use client";

import { useState } from "react";

// 参加リンクをクリップボードにコピーする小さなボタン。
export function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード権限がない環境では選択できるよう prompt でフォールバック
      window.prompt("以下のリンクをコピーしてください", link);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      data-join-link={link}
      className="btn btn-ghost btn-sm shrink-0"
    >
      {copied ? "コピーしました" : "リンクをコピー"}
    </button>
  );
}
