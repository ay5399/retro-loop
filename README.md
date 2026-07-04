# RetroLoop

**問い返して、改善が根付くまで追う AI ふりかえりツール。**

ふりかえり（レトロスペクティブ）SaaS の多くは「付箋を要約・グルーピングする」＝過去の整理までしかやらない。
RetroLoop はそこを一歩進めて、**AI が先輩スクラムマスターのように問い返し**、出したアクションが
**次スプリントで本当に効いたかを追跡して改善ループを閉じる**ことに振り切っている。

これは AI 駆動開発（Claude Code / Cursor）で個人開発しているプロダクトであり、
設計意図・意思決定・進め方を `docs/` に残しながら育てている。

---

## 差別化（なぜ作るか）

1. **問い返す AI** — 「そのアクション、本当に再発防止になってる？形骸化してない？」と問い返す
2. **効果追跡ループを閉じる** — ふりかえり → アクション → 次スプリントで効果検証
3. 日本のアジャイル現場文脈に寄せる（補助的）

詳細な企画は [`docs/BRIEF.md`](docs/BRIEF.md)、技術・設計の意思決定は [`docs/DECISIONS.md`](docs/DECISIONS.md) を参照。

## 技術スタック

| 領域 | 採用 |
|---|---|
| フロント/サーバ | Next.js (App Router) + TypeScript + Tailwind CSS |
| DB | PostgreSQL (Neon) |
| ORM | Prisma |
| 認証 | Auth.js (NextAuth v5) |
| LLM | Anthropic Claude API（tool use で構造化） |
| デプロイ | Vercel + Neon |

技術選定の理由（学習 × プロダクトの2軸での比較）は [`docs/DECISIONS.md`](docs/DECISIONS.md) にまとめている。

## セットアップ

```bash
# 1. 依存インストール
npm install

# 2. 環境変数
cp .env.example .env
#   DATABASE_URL（Neon）, AUTH_SECRET（npx auth secret）, ANTHROPIC_API_KEY を設定

# 3. DB スキーマを反映（開発）
npm run db:push

# 4. 開発サーバ
npm run dev   # http://localhost:3000
```

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ起動 |
| `npm run build` | `prisma generate` + 本番ビルド |
| `npm run db:push` | スキーマを DB に反映（マイグレーション無し・開発向け） |
| `npm run db:migrate` | マイグレーション作成・適用 |
| `npm run db:studio` | Prisma Studio でデータ閲覧 |

## MVP スコープ

最小認証 / チーム・スプリント作成 / 付箋 CRUD（KPT・リスト表示） /
**AI 問い返し（核）** / アクション化＋前回アクションの持ち越し表示 / 本番公開デプロイ。

やらないこと（v1以降）や削る判断軸は [`docs/BRIEF.md`](docs/BRIEF.md) を参照。

## ステータス

🚧 立ち上げ期。プロジェクトの足場（雛形・スタック・ドキュメント）を構築済み。
次はドメインのデータモデル設計 → 認証 → 付箋 CRUD → AI 問い返し の順で実装予定。
