# 技術・設計の決定記録（ADR ライト）

このファイルは「なぜその技術/設計にしたか」を残す。面接で説明できる状態を保つのが目的。

---

## ADR-001: 技術スタック（2026-07-04 確定）

### 決定
バックエンドを **自前 Postgres + ORM で組む案（案B）** を採用する。

- フロント/サーバ：**Next.js（App Router）+ TypeScript + Tailwind CSS v4**
- DB：**PostgreSQL（Neon 無料枠）**
- ORM：**Prisma**
- 認証：**Auth.js（NextAuth v5）** — メール or GitHub の1プロバイダのみ（MVP）
- LLM：**Anthropic Claude API**（`@anthropic-ai/sdk`、tool use で構造化した「問い返し」を返す）
- デプロイ：**Vercel（アプリ）+ Neon（DB）**
- リポジトリ公開範囲：**GitHub Public**

### 背景と理由（学習 × プロダクトの2軸）
- 作者の最大の穴は「モダンWebをゼロから設計→デプロイ→運用」。
- **学習**：引き継ぎ資料が想定していた Supabase(BaaS) は認証/APIの多くを隠すため、元ローコード出身の作者の穴を埋めにくい。案Bはスキーマ設計・マイグレーション・ORM・認証を自力で組むので学習に直撃し、かつ TypeScript 1言語で完結する。
- **プロダクト**：MVP規模（認証1つ・KPTリスト・AI問い返し・アクション持ち越し）は案Bで十分射程。差別化の核である Claude 連携（構造化出力）もサーバ側で素直に書ける。
- 却下案：
  - 案A（Supabase 最速）… 公開は最速だが学習の穴が埋まりにくい。
  - 案C（React + FastAPI/Go 分離）… 学習最大だが週5〜10hだと**公開まで届かない未完リスク**が最大で、ポートフォリオ目的と衝突。
  - 案D（T3/tRPC）… 型安全は学べるが tRPC は企業採用が薄く換金性が中。

### 固定前提（動かさない）
- フロントは **React系（Next.js）**：求人市場での換金性が最大。
- LLM は **Claude API**：差別化の核。

### 補足
- ORM は Prisma を既定。SQL をより生で学びたくなったら Drizzle に差し替え可。
- 引き継ぎ資料 `docs/BRIEF.md` の App Router/Supabase 記述のうち **Supabase 部分は無効**。

---

## ADR-002: Prisma は v6 系に固定（2026-07-05）

### 決定
Prisma を **6 系（6.19.x）に固定**する（`prisma` / `@prisma/client` ともに `^6`）。

### 背景と理由
- 足場構築時に最新の Prisma 7 が入ったが、v7 は破壊的変更で **`datasource` の `url = env(...)` をスキーマに書けなくなり**、`prisma.config.ts` + ドライバアダプタ（例: `@prisma/adapter-pg`）が必須になった。
- v7 は登場直後でチュートリアル・記事がほぼ v6 前提。学習中・週5〜10h の個人開発で、足場作りの段階から v7 の新設定に時間を溶かすのは費用対効果が悪い。
- v6 は単一 `schema.prisma` に接続URLを書く従来型で、ドキュメントが圧倒的に揃っており学習コストが低い。
- v7 移行は必要になったら v1 以降の課題とする（ADRを追記する）。

### 影響
- `schema.prisma` は従来どおり `datasource db { url = env("DATABASE_URL") }` で記述。
- `DATABASE_URL` は `.env` に設定（未設定だと `prisma validate` が env 未検出エラーを出すが、これは想定内）。
