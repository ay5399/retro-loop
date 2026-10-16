# Apache DevLake 計測ガイド

このリポジトリでは GitHub を Issue管理・ソース管理・CI の一次情報源、Vercel を本番デプロイ先として扱います。Jiraは現時点では不要です。GitHub Issuesだけで、Issue、PR、コミット、CIの関連を一つの接続から収集できます。

## DevLake の接続設定

DevLake の Project に GitHub connection を追加し、`ay5399/retro-loop` を scope にします。GitHub App方式を推奨し、Contents、Issues、Pull requests、Actions/Workflows の読み取り権限を付与します。

Scope Config の変換規則は次に揃えます。

| DevLake項目 | 正規表現 |
|---|---|
| Issue / Requirement | `^type:feature$` |
| Issue / Bug | `^type:bug$` |
| Issue / Incident | `^type:incident$` |
| Priority | `^priority:(P[0-3])$` |
| Severity | `^severity:(critical|high|medium|low)$` |
| PR type | `^(type):(feature|bug|incident)$`（PRにも同ラベルを付ける場合） |
| PR closes issue | `(?i)(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#(\d+)` |
| Deployment | `(?i)deploy.*production` |
| Production | `(?i)production` |

同期はまず過去90日、1時間ごとを推奨します。履歴が少ない初期段階では週次値が大きく振れるため、個人評価ではなくプロセス上のボトルネック発見に使います。

## GitHub側で一度だけ行う設定

1. `.github/labels.yml` と同名のラベルを作る（ファイルはラベル定義の正本）。
2. Settings → Branches で既定ブランチに保護ルールを追加する。
   - Pull request必須（個人開発なので承認人数は0でもよい）
   - `Quality`、`Build`、`E2E` を必須チェックにする
   - force pushと削除を禁止する
3. Settings → Actions → General で Actions を有効化する。
4. GitHubの `production` Environmentを作り、`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` のRepository Secretsを設定する。

GitHub CLIを利用できる場合、ラベルは次の形式で作成できます。

```bash
gh label create "type:feature" --color 1D76DB --description "新機能・改善要求（DevLake REQUIREMENT）"
gh label create "type:bug" --color D73A4A --description "リリース前の不具合（DevLake BUG）"
gh label create "type:incident" --color B60205 --description "本番障害（DevLake INCIDENT）"
```

残りの priority / severity ラベルも `.github/labels.yml` に従って登録します。

## デプロイ計測

DevLakeのGitHubプラグインは、workflowまたはjob名を正規表現に一致させてデプロイとして扱います。VercelのGit連携だけではGitHub Actionsのworkflow runが作られないため、DORAのDeployment Frequencyは `.github/workflows/deploy-production.yml` の `Deploy Production` workflowから本番投入することで記録します。DevLakeでは Deploymentを `(?i)deploy.*production`、Productionを `(?i)production` に設定します。

Secrets設定まではActions画面からこのworkflowを実行しないでください。設定後は手動実行で実際のVercel本番デプロイとDevLakeのデプロイイベントが一致します。安定運用できたら `workflow_dispatch` に既定ブランチへのpushトリガーを追加して完全自動化できます。Vercel側のGit自動デプロイを同時に有効にすると二重デプロイになるため、どちらか一方だけを使います。実体のない「デプロイ完了」workflowを発火して数値だけ作ることはしません。

## 運用上の意味

- Featureは要求、Bugはリリース前不具合、Incidentは本番影響あり、と分類を混ぜない。
- PRは必ずIssueをclosing keywordで結び、リードタイムの始点と終点を追えるようにする。
- CIの失敗を履歴として残す。失敗ジョブの再実行やチェック回避で数値を装飾しない。
- 本番障害は検知後すぐIncident Issueを開き、復旧時にcloseする。これがMTTRとChange Failure Rateの基礎になる。
- botと人のアカウント、複数メールアドレスはDevLake上で必要に応じて同一人物へマージする。

DevLakeがGitHubラベルからRequirement / Bug / Incidentを標準化し、workflow runをdeploymentへ変換する仕様は、公式の [GitHub plugin configuration](https://devlake.apache.org/docs/Configuration/GitHub/) を参照してください。
