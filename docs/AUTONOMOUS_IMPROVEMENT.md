# 自律改善の運用と費用監査

## 2026-10-28: 当回での解消を優先し、暫定的に前回結果を確認する

原則として、発生した問題は同じ実行内で原因の修正・回帰テスト・独立レビュー・再検証まで進める。証跡画像の欠損、承認後の未実装、文字化けも例外扱いで即終了せず、初回＋修正2回の最大3回の対象に含める。費用、承認、本番の安全確認や90分上限を迂回しない。

安定稼働までの暫定措置として `startupRecovery.enabled=true` を設定した。実行開始時は、実際の前回実行の結果とチェックポイントを確認する。dry-run・監査だけの実行で失敗履歴を消さない。未解決なら、前回の候補を最新mainの別作業ブランチへ引き継ぎ、根本原因の修正・回帰テストによる再発防止・独立レビュー・全検証・配信を先に完了する。その結果を証跡付きで記録してから現在の改善へ進む。過去の失敗結果自体は書き換えない。

前回確認を「失敗は次回に回してよい」という運用にはしない。当回の修正上限や安全条件で解消しきれなかった場合の補助であり、復旧が未完了なら新しい改善を開始しない。復旧後に時間が不足するときも、現在の改善は未着手・延期と明記し、成功したことにしない。大胆案の復旧は検証済みDraft PRまでで、所有者承認なしにはマージしない。却下・承認必須の判断も起動をまたいで維持する。安定性を確認後、この暫定設定を見直す。

生成前に、baseline比較は既存画面の記録を使い、テスト用環境変数・条件付きassert・skipを追加しないことを明示する。導入済みSDKの文書・型・ソースを静的に参照できるようにする。UTF-8不正や置換文字はレビュー前にファイル名・行番号付きで検出する。安全検査の診断は該当行と修正方法を伝える。各結果の `prevention` に再発防止と検証範囲を残す。

検証workflowは返却された実行URL・IDを優先し、遅延している表示名だけで起動失敗と判断しない。返却IDがない場合も一意の要求を照合し、確認できないからといって同じ要求を再送しない。本番の状態が未確認なら追加配信を止める。変更前の画像は独立して保存し、変更後に宣言したPNGが欠けていれば同じ実行内で修正・再レビュー・CIをやり直す。

課金監査等の本番条件だけが不足している場合は `awaiting-release-conditions` として元のPR・SHAを保持する。次回起動でも条件不足なら、モデル・レビュー・CIを繰り返さず条件待ちを記録する。実際に条件が確認できたら、元のPRを再レビュー・検証して再開し、代替PRや二重配信は作らない。未確認の監査日時を延長しない。

却下・承認必須の場合、自動実行が判断を上書きして解除することはない。所有者が対象run・企画またはSHAを指定して別途対応を指示し、安全な実装・独立レビュー・検証を完了した実行結果を残してから再開する。大胆案には既存の `/approve-mutation` を使い、通常企画には承認コメントだけで保護対象の変更を許可する経路を設けない。

## 2026-10-22: 調査・企画レビューと指摘解消

2026-10-26修正: 計画は専用の `plan.schema.json` を使う。`decision=implement` は「実装すべき案がある」、`no-change` は「調査しても安全で有用な案がない」を意味する。計画段階で未編集であることを「改善なし」と判定しない。改善なしの判断もClaudeがレビューする。承認済みの案を実装できなかった場合は、変更なしの成功扱いにせず未完了を記録する。

変更前検証が完了して失敗した場合は、テストの詳細ログを取得し、新機能の追加より既存不具合の修復を優先する。同じ独立レビュー・最大3回の修正・変更後の全検証を必須とする。失敗した変更前検証を合格と報告しない。認証・実行開始・証跡ダウンロードの失敗や実行結果未確認はコード修復の根拠にしない。通常改善が失敗・配信待ちなら追加の大胆案を開始しない。

実装前に、少なくとも2つの競合レトロ製品の公式機能・ヘルプと、レトロ参加者／進行役の課題を公開フィードバックや実践報告から調査する。URL・確認日・発見・限界を残し、観測事実と仮説を区別する。2案以上を利用者への効果・企画方針・実現性で比較して1案を選ぶ。競合の機能数を追うこと自体は目的にしない。

Claudeが実装前に企画を独立レビューし、調査根拠・課題認識・代替案・優先順位・成功条件を確認する。企画承認後に実装する。企画レビューは最大3回。実装も初回＋修正2回の最大3回、同じ作業ブランチで指摘を修正し、対象SHAのClaudeレビュー・CI・必要な実AI検証を繰り返す。最初の1回・2回の修正要求だけで放置しない。診断ログを修正担当へ渡し、各回の指摘と結果を記録する。合格後はマージ・配信・公開確認まで続行する。

3回で未解消、90分の上限、費用・認証・保護対象・本番復旧の条件不足は、理由を明記して停止する。却下や承認必須の判定は自動修正で通過させず停止する。大胆案の所有者承認も引き続き必須。計画はread-onlyで調査し、実装のみworkspace-writeを使う。

## GitHub認証方針の更新（2026-10-21）

`githubAuth=app` に変更した。追加ユーザーアカウントは不要で、所有者のアカウントに非公開GitHub Appを登録する。[登録・接続手順](GITHUB_APP_SETUP.md)を参照。以下に残る専用ボットアカウントの説明は旧方式の説明であり、App方式では適用しない。全権限の許可を撤回し、必要最小限の権限に戻した。Secrets・Variables・Workflowsと管理設定の書き込み権限は拒否する。短期トークンの対象はretro-loopだけにする。アカウント／Organization権限は付与しない。監査の自己申告`botHasNoVariableWrite`で代用しない。他プロジェクトの認証と所有者のghログインは変更しない。

## 改善の方針と週次レビュー

[PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) を企画の基準とし、実行時の指示は `automation/policy.json` の `productDirection` から渡す。代表シナリオの変更前後を証拠にし、AI協働の判断過程を残す。通常改善の採否はClaude CodeとCIで判断し、作者は週次で成果・費用・リスクと次の優先順位を確認する。通常変更ごとの人間の事前承認は求めない。破壊的変更の承認と費用監査等の停止条件は維持する。週次レビュー用の別スケジュールや通知は新設せず、各実行のIssueをレビュー材料にする。

## 実行内容

検証方針は [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) の「モックと実AIの検証方針」を参照。通常CIはモックを維持するが、AI体験に関わる変更は別枠の少数の実AI検証も必要。生成エージェント自身に本番API呼び出しを許可するものではない。現ランナーの検証workflowはモックのみで、実AI検証の自動統合は未実装。実AI証拠が不足する場合は品質検証の未完了を明示し、自動で実AI検証済みと報告しない。接続確認の記録は [LIVE_AI_VERIFICATION.md](LIVE_AI_VERIFICATION.md)。

### 2026-10-20: 過剰な停止条件の是正

監査を二段階に分離した。実装・検証にはCodex、Claude、GitHubの費用確認と実行アカウントの隔離を要求する。本番のVercel・Neon、稼働中／復旧先の外部呼び出し停止は、マージ・配信する直前に確認する。本番監査だけが未完了なら、実装・独立レビュー・CIを進めてPRを未マージで残す。ただし候補ブランチのpushでも自動配信され得るため、Vercel Git自動配信の無効化は実装開始前にも必須。

企画文や実行時刻の変更では監査を失効させない。費用・対象リポジトリ・保護範囲に関する設定の変更では失効する。旧形式の監査は初回のみ再登録が必要。使わないGemini・Resend・DevLakeは、呼び出し経路がないことを証跡付きで `disabled` と登録でき、この宣言には週次更新を求めない。実際に使うサービスの費用確認は引き続き7日で失効する。

実装条件の未完了は終了コード2。本番条件と分けて `result.json` の `problems` / `releaseProblems` に保存する。CLIログイン成功だけでは追加課金なしの証明にしない。GitHubボットの実在の設定も確認する。2026-10-21の所有者指示により `requireDedicatedWindowsUser=false` とし、専用Windowsユーザーは必須にしない。インストーラーは実行したWindowsユーザーでタスクを登録する。

実装用の監査だけを登録する場合は次を使う。この操作ではGitHubの本番配信許可期限を書き換えない。

```powershell
node scripts/automation/record-audit.mjs C:/private/verified-development-audit.json --development
```

Windowsタスク `RetroLoop-AutonomousImprovement` が日本時間5時・13時・21時とログオン時に起動する。各回通常改善1件、最大90分。ログオン時は直近1枠だけを対象にし、同じ枠を再実行しない。PCの起動と所有者のWindowsログオンが必要。スリープ解除はWindows・機器の対応状況に依存する。

Web調査→GitHub Actionsでブラウザ操作・画面確認→実装→独立したClaude Codeレビュー→CI→squash merge→対象SHAのCI→Vercel配信→公開ページの確認、の順に進む。画像はPlaywrightが作成する。テストはモックAIとActions内の使い捨てPostgreSQLを使う。依存・認証・DB・自動化・費用制御の変更は通常の自動反映対象外。

初回と以後3日おきの5時枠で、大胆案を別ブランチに試作する。所有者 `ay5399` が提案Issueへ次を単独コメントしたときだけ採用対象になる。

```text
/approve-mutation <提案ID> <40文字の対象SHA>
```

本流への追従でSHAが変われば再承認が必要。試作品はDraft PRで確認できる。画面・詳細ログはローカルに保管し、Issueには保存先を記載する。

## インストールと確認

```powershell
powershell -NoProfile -File scripts/automation/install.ps1
& "$env:LOCALAPPDATA/RetroLoopAutomation/launch.ps1" --dry-run
Get-ScheduledTask -TaskName RetroLoop-AutonomousImprovement
```

ランナーとポリシーは `%LOCALAPPDATA%/RetroLoopAutomation` にコピーされる。自動編集するworktreeの外に置き、Codexはworkspace-write、Claudeはツールなし・MCPなしで起動する。APIキーを子プロセスに引き継がない。ランナー更新は所有者がインストーラーを再実行する。実行ログは `runs/`、月次費用台帳は `ledger-YYYY-MM.json`。

自動改善のCodex起動だけに `windows.sandbox="elevated"` を指定する。`--ignore-user-config`で個人設定を読まない場合もWindowsのworkspace-writeを有効にするためで、他プロジェクトの設定・権限は変更しない。実効モードがread-onlyだった場合は「変更不要」にせず実行失敗として記録する。

タスクはNodeを直接起動し、PowerShellのExecutionPolicyに依存しない。ビルド・DB・ブラウザテストは使い捨てのGitHub-hosted標準Ubuntuランナーで実行する。このPCでDocker・DB・開発サーバは起動しない。検証workflowには本番Secretsを渡さず、checkoutの資格情報も永続化しない。画面は1回20MiB以下・保存1日で取得する。GitHubのストレージ超過停止を監査してから運用する。

AI画面を変更した場合の例外は、独立レビュー後のクリーンなSHAを対象にした、一時的なPlus実AI画面検証だけとする。架空データ・最大3往復・330秒・loopback接続・ブラウザー外部通信拒否で実行し、保存先は検証ブラウザー内。本番API・認証・PostgreSQLはモックCIで別途確認する。詳細と証拠はdocs/LIVE_AI_VERIFICATION.mdを参照する。調査資料にURLを記載することは外部API呼び出しとは扱わず、実行コードの追加呼び出し・資格情報参照を検査する。

無人実行のGitHub認証には**承認者と異なる専用ボットアカウント**が必要。所有者本人の認証のままでは実装・配信へ進まない。ボット作成や資格情報の発行・切替は自動では行わない。

専用Windowsユーザーは所有者判断で不要とした（`requireDedicatedWindowsUser=false`）。別ユーザーで実行したという監査証跡は作らない。将来trueへ戻す場合は専用ユーザーの実在確認が必要。GitHubボットと承認者の分離は維持し、ボットにはActions変数の書き込み権限を与えない。監査に `botHasNoVariableWrite=true` を含める。production環境がmainブランチのみを許可し、mainにPR必須・CI必須の保護があることもAPIで確認する。

初期状態は**費用監査待ちで停止**する。認証済みCLIが存在することは課金設定の証明ではない。未確認の状態を自動で承認済みに書き換えない。

## 課金リスク一覧（2026-10-19調査）

| サービス | 確認できた接続経路とリスク | 必須対策 |
|---|---|---|
| Codex | ChatGPT認証のCLI。追加クレジット、従量APIへの切替、利用枠超過 | 既存契約内で停止することをアカウント画面で確認。自動購入・追加利用なし。APIキーを渡さない |
| Claude Code | claude.ai認証。Pro契約。追加利用や別API認証の可能性 | Extra usage・自動チャージ無効を確認。追加利用枠なし。枠切れは待機 |
| GitHub | 公開リポジトリ、標準Ubuntuランナー。ストレージ・大型ランナーは別リスク | 公開を維持。大型ランナー禁止。画面成果物は20MiB以下・保存1日。共有の使用量・キャッシュ上限・有料利用停止を確認 |
| Vercel | Actionsに認証Secretsあり。実プランとGit連携は未確認 | Hobby等の追加課金なしを確認。Git自動配信を無効化。予算通知だけでは不可 |
| Neon | Prisma PostgreSQL接続。本番のプランは未確認 | Free等の上限停止を確認。テスト・試作はGitHub Actionsの使い捨てDB。外部監視でDBを常時起動させない |
| Gemini | AIチャットと構造化生成 | 初期状態は実API無効。無料専用プロジェクトとBilling未接続を確認するまで有効にしない |
| Resend | 認証メール。従来は開発環境でもキーがあれば実送信 | テストにキーを渡さない。初期状態は実送信無効。Transactional Overages無効を確認 |
| DevLake | 収集ガイドのみで配置・契約は不明 | この自動化から新規ホスティングしない。外部ホストが存在する場合は既存請求を別途確認 |

VercelのSpend Managementは停止までに遅延があり、保存領域・追加機能などは別請求になり得る。NeonのSpending Limitという名称もハード停止を意味するとは限らない。通知メールだけを課金防止策にしない。

公式資料: [OpenAI](https://learn.chatgpt.com/docs/pricing)、[Claude](https://code.claude.com/docs/en/costs)、[Vercel](https://vercel.com/docs/spend-management)、[Neon](https://neon.com/docs/introduction/plans)、[Gemini](https://ai.google.dev/gemini-api/docs/billing)、[GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[Resend](https://resend.com/changelog/pay-as-you-go-pricing)。

### 費用上限

既存サブスク固定料金を除き、全サービス合算で月1,000円まで。実行枠800円、税・為替等の余裕200円。**現実装では有料利用をすべて無効**にし、0円の予約のみ許可する。1,000円まで使うことを保証する実装ではなく、上限を破らないことを優先する。ハード停止・最大請求額を検証できるアダプターを所有者レビューで追加するまでは有料化しない。

予算台帳はJST暦月。最大費用が不明、予約重複、上限超過は拒否。処理失敗時も予約を勝手に解除しない。クレジット購入、チャージ、契約アップグレードは自動実行しない。

## 監査の記録と有効化

1. 各サービスのBilling/Usage画面を所有者が確認し、非公開の証跡（日時、プラン、超過時の停止設定、対象プロジェクト）を用意する。カード番号・APIキーは記録しない。
2. `%LOCALAPPDATA%/RetroLoopAutomation/audit.json` のコピーに結果を入力する。各サービスの `mode` は `included-hard-stop`、`free-hard-stop`、`disabled` のいずれか。必須サービス codex/claude/github/vercel/neon はdisabled不可。gemini/resend/devlakeはこの自動化から呼び出さなければdisabledでよい。
3. 各項目に `verifiedAt`（ISO日時）と `evidence`（証跡の非公開保存先または確認した設定の説明）を入れる。`autoRechargeDisabled`、`productionLiveCallsDisabled`、`rollbackLiveCallsDisabled`、`vercelGitDeploymentsDisabled` は実際に確認した場合のみtrueにする。ゲート導入前の旧デプロイへ戻っても課金APIを呼べないよう、初回は本番側キーの無効化／削除まで確認する。
4. 次のコマンドで検証・登録する。ローカル監査の更新とGitHubの配信許可期限の設定を行う。

```powershell
$env:RETRO_AUTOMATION_HOME = "$env:LOCALAPPDATA/RetroLoopAutomation"
node scripts/automation/record-audit.mjs C:/private/verified-retro-audit.json
& "$env:RETRO_AUTOMATION_HOME/launch.ps1" --dry-run
```

稼働するサービスの監査は7日で失効する。費用・セキュリティに関わるポリシー変更でも失効する。実装段階の期限後や実行条件を取得できない場合は実装を停止する。本番段階だけが未完了なら、PRを未マージで残す。実プラン未確認のサービスを無料として登録しない。本番配信workflowも監査期限を検証する。

現在、実課金設定へのアクセスを確認できていないため、初回監査は未完了。リポジトリ上の設定とCLI認証状態だけを観測済みとして扱う。

## 検証・停止・復旧

### 初回の安全な本番基準版

旧版に停止制御やSHAメタデータがない場合、通常配信へ進めない。所有者が確認した固定のhealth用秘密値をローカル非公開の`production-health.json`の`token`と、GitHubのproduction環境Secret `AUTOMATION_HEALTHCHECK_TOKEN`に同じ値で保存する。鍵をコマンド出力や文書に貼らない。

レビュー済み変更がmainへ反映され、そのSHAのCIが成功した後、クリーンな同じSHAのチェックアウトで `RETRO_AUTOMATION_HOME` と `AUTOMATION_PRODUCTION_ALIAS=retro-blush.vercel.app` を設定し、`node scripts/automation/bootstrap-production.mjs` を実行する。GitHubにも同じ値のRepository Variable `AUTOMATION_PRODUCTION_ALIAS`を所有者が設定する。これはVercel上でビルドし、`--prod --skip-domain --meta automationReleaseSha=<SHA>`と、`ALLOW_LIVE_LLM=false`・`ALLOW_LIVE_EMAIL=false`・4つのAI/メールキーを空・`AUTOMATION_RELEASE_SHA=<SHA>`・共通`HEALTHCHECK_TOKEN`を実行環境へ指定する。保護付きURLをVercel CLIで検証した後にだけpromoteし、公開エイリアスも検証する。正常結果を`safe-production-baseline.json`に保存してから、本番・復旧先の監査項目を登録する。

安全な基準版の確立後、Deploy Productionを `rollback_drill=true` で明示実行すると、正常な公開smokeの直後に意図的に失敗させる。通常のrollback、旧SHAの安全性確認、独立したRecover Interrupted Productionによるlease解放を確認するための訓練である。結果は意図的にfailureとなりIncidentで後続配信が止まる。所有者が旧SHA・外部呼び出し無効・公開画面の復旧とlease解放を確認し、訓練で作られたIncidentだけをcloseして解除する。通常配信の既定値はfalse。

本番の安全性と、GitHubからVercelへ配信できる認証は別々に確認する。`audit.json`の`vercelAutomationTokenVerified`は、production環境Secret `VERCEL_TOKEN`でworkflowのVercel APIアクセスを実測できた場合だけtrueにする。falseまたは未設定なら、開発・レビュー・CI・PR作成は進め、マージと配信を保留する。2026-10-21の旧Secretは403で、ローカルCLI認証からのトークン作成も403だった。[VercelのTokens画面](https://vercel.com/account/tokens)で所有者がretroプロジェクト用トークンを作成し、production環境Secretへ登録して再確認する。CLIの短期トークンは恒久Secretとして代用しない。

通常配信は配信前にこの安全な基準版の公開healthと、Vercelの対象デプロイのSHAメタデータを照合する。復旧後も同じSHAに戻ったことを検証する。実行枠消費済みでも手動で通し実行する場合は、`node "$env:RETRO_AUTOMATION_HOME/runtime/run.mjs" --manual-run`を使う。定期枠の重複防止は変更しない。`--manual-run`は通常改善だけを実行する。

```powershell
node --test scripts/automation/*.test.mjs
# ビルド・ブラウザ検証はGitHub Actionsへ依頼する。
gh workflow run verify-automation.yml -f target_sha=<40文字SHA> -f request_id=manual-check
Disable-ScheduledTask -TaskName RetroLoop-AutonomousImprovement
Enable-ScheduledTask -TaskName RetroLoop-AutonomousImprovement
```

Claude不賛成、テスト失敗、保護対象の変更、調査・画面証跡不足、レビュー後の差分変更は自動反映しない。配信はmain上の対象SHAのCI成功が必須。失敗時は直前本番へrollbackする。復旧できなければ `halt.json` とGitHub変数 `AUTOMATION_HALTED=true` で後続配信を止める。

復旧後は所有者が実機確認し、ローカルのhalt.jsonを退避し、Incident Issueをcloseする。所有者が手動設定したAUTOMATION_HALTED変数があればfalseに戻す。ボット自身はActions変数を書き換えず、停止も解除しない。Vercel環境はロールバック先の設定も含め、課金が発生しない契約であることを開始前に確認する。

未解決のIncident Issueがある間はworkflow自身も配信を拒否するため、PC側が終了しても次の配信は進まない。通常マージ前には配信・復旧監視用に45分の残り時間を必須とし、不足時はPRを未マージで残す。

配信直前にRelease lease Issueへ復旧先を記録し、確認完了後にcloseする。中断・タイムアウト時は独立したRecover Interrupted Production workflowがleaseを読み、Incidentを開いて配信を止め、巻き戻しと公開導線の再確認を行う。本番は認証付き `/api/health` で対象SHA・外部呼び出し無効・実キー未設定を検証する。

初回の実装・検証は実装段階の監査を完了した後に実施する。本番反映は別途、本番段階の監査を要求する。実装条件も未完了なら、定期タスクは前提条件の確認と停止理由の記録だけを行う。

費用停止中は本番AIと認証メールも無効になるため、本番のマジックリンクログインは使えない。既存利用者はいない前提で費用保護を優先する。既存の契約プラン・請求情報・GitHubボット認証は未確認のため、自律運用の有効化にはこれらの確認が残る。

Claudeレビューで `--max-budget-usd` の値を超えるAPI換算額が記録されることを確認した。このCLIオプションだけを厳密な課金上限として使用しない。サブスク認証時のAPI換算額は、実際に追加請求された金額とは区別する。
