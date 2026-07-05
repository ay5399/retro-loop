// 署名要素：閉じかけたループの糸（琥珀→菫のグラデ）。
// 「過去のアクションが戻ってきて判定される」というこの製品の核を可視化する。
export function LoopThread({
  size = 220,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 220 220"
      fill="none"
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient id="rl-thread" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--ember)" />
          <stop offset="1" stopColor="var(--iris)" />
        </linearGradient>
        <marker
          id="rl-arrow"
          markerUnits="userSpaceOnUse"
          markerWidth="20"
          markerHeight="20"
          refX="10"
          refY="10"
          orient="auto"
        >
          <path d="M4 3 L15 10 L4 17 Z" fill="var(--iris)" />
        </marker>
      </defs>
      {/* 起点（温）: 過去のアクション */}
      <circle cx="110" cy="32" r="6" fill="var(--ember)" />
      {/* 戻ってくる糸（冷）: 次のふりかえりで判定へ */}
      <path
        d="M110 32 A 78 78 0 1 1 44 148"
        stroke="url(#rl-thread)"
        strokeWidth="10"
        strokeLinecap="round"
        markerEnd="url(#rl-arrow)"
      />
    </svg>
  );
}

// ロゴ用の小さなループ記号
export function LoopMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="inline-block align-[-0.15em]"
    >
      <circle cx="6.5" cy="12" r="3.4" fill="var(--ember)" />
      <path
        d="M9.6 12 a5.9 5.9 0 1 1 4.9 5.8"
        stroke="var(--iris)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// テキストロゴ
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display text-[1.05rem] font-semibold tracking-tight ${className ?? ""}`}
    >
      <LoopMark />
      RetroLoop
    </span>
  );
}
