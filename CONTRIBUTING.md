# 開発への参加

変更は、原則として GitHub Issue → ブランチ → Pull Request → CI → レビュー → squash merge の順で進めます。この履歴を揃えることで、Apache DevLake が要件からデプロイまでのリードタイムを追跡できます。

## 基本フロー

1. 作業前に Feature / Bug / Incident のいずれかで Issue を作り、担当者と優先度ラベルを設定する。
2. `feature/123-short-name`、`fix/123-short-name` など Issue 番号を含むブランチを作る。
3. 小さくコミットし、Pull Request本文に `Closes #123` を残す。
4. `CI / Quality`、`CI / Build`、`CI / E2E` が成功してからレビュー・マージする。
5. 本番障害は通常の Bug ではなく `type:incident` Issue として、検知から復旧までを記録する。

Issueを伴わないPRや、PRを経由しないmainへの直接pushは、分析上のトレーサビリティを欠くため避けてください。コミット作者メールはGitHubアカウントに紐づくものを使います。

## ローカル確認

```bash
npm ci
npm run check
npm run build
npm run test:e2e
```

E2EにはPostgreSQLが必要です。環境変数とセットアップは `README.md` を参照してください。通常のCIでは外部APIに依存するGemini smoke testをskipします。`GEMINI_API_KEY` を設定した環境では同じコマンドでlive smokeも実行されます。

## 完了の定義

- 受け入れ条件を満たし、関連IssueとPRがリンクされている
- lint、型検査、ビルド、関係するテストが成功する
- 挙動・仕様・環境変数・DBが変わる場合、ドキュメントとマイグレーションも更新されている
- 本番投入後に問題が起きた場合の戻し方がPRに記載されている
