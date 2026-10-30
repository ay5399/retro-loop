# AIへの相談で応答待ちを明示する

## 観測と選択

添付のai-chat、board-color、board-group、board-vote画面は完了後または送信前を示し、待機中の状態は直接観測できない。静的コードでは送信後の案内が「応答中…」と中止ボタンに限られる。既存のLIVE_AI_VERIFICATION.mdには初文字まで6.2〜15.3秒の記録がある。今回のベースライン失敗ログは提供されていない。待機説明が相談継続を助けるという仮説であり、離脱率や利用者インタビューの裏付けはない。

| 候補 | 本人Problemから行動への寄与 | 実現性・影響 | 判断 |
| --- | --- | --- | --- |
| 応答待ちの説明 | 問い返しを待つ間の状態を伝える | クライアント内の小変更。応答速度は変わらない | 今回採用 |
| 担当・日付付き確認保存 | 優先シナリオへの直接寄与が大きい | DB変更を含む専用作業が必要 | 延期 |

## 調査（2026-10-30閲覧）

- https://www.goretro.ai/help-articles/create-follow-up-on-action-items — 付箋からアクションを作成し追跡する導線を提供。公式機能説明であり、待機UIの効果を示す調査ではない。
- https://help.teamretro.com/article/181-overview — 議論中にアクションを作成し、次回に確認する工程を提供。競合の機能は行動への接続を支持するが、機能同等性そのものを目標にしない。
- https://docs.pagerduty.com/ops-guides/retrospectives/after — 実務ガイドは未進捗の理由を責めずに確認し、行動を再定義・明確化することを推奨。実験による効果測定ではない。
- https://www.reddit.com/r/agile/comments/13cj3w7/how_do_you_track_action_points_from_the_retro/ — 遠隔チームでスプリントの見通しを損なわずアクションを共有・追跡したいという公開相談。単一の自己申告で代表性はなく、RetroLoopの利用者証拠ではない。
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot — インストール済みai/docs/04-ai-sdk-ui/02-chatbot.mdxのStatus節、およびai/src/ui/chat.tsのChatStatus、@ai-sdk/react/src/use-chat.tsの状態購読を静的確認。submittedからstreamingへは最初の書込み時に遷移する。
- https://nextjs.org/docs/app/getting-started/server-and-client-components — インストール済みnext/dist/docs/01-app/03-api-reference/01-directives/use-client.mdを読み、既存クライアントコンポーネント内で状態表示を実装。

## 変更と再発防止

AiChatに待機専用の単一role=status領域を追加。submittedでは「AIの応答を待っています。必要なら『応答を中止』できます。」、streamingでは「AIの応答を受信中です。」を表示する。完了・失敗・中止時には領域を除去する。既存の中止後通知は維持する。時間予測・進捗率、再送、API呼出しは追加しない。

既存E2E本文とassertionは保持し、独立した回帰テストを追加した。ブラウザー内のモックfetchを明示的に進め、応答開始前、部分受信、完了を固定待機なしで検証する。別ケースは応答前の中止・失敗、原文復元、待機案内の消去、リクエストが1回のままであることを検証する。即時完了モックが見逃す状態遷移の退行を防ぐ。

同じ改修後テストが以下を作成する予定。旧SHAとの比較画像ではない。

- e2e/__screens__/chat-wait-status-before.png：本人Problemの下書きを送信する前
- e2e/__screens__/chat-wait-status-after.png：送信後、最初の応答を待つ間

## 検証・レビュー記録

ホストではアプリ、SDK、ビルド、テストを実行していない。静的差分確認のみ。上記回帰テスト、通常CI、PNG生成の成否はコントローラーによる検証待ちであり、成功とは扱わない。

Claude独立レビュー：この実装時点では未実施、指摘・対応は未記録。コントローラーの独立レビュー結果と対応を本記録に追記する工程を残す。

実AI：今回の指示に従い呼出しなし。独立レビュー後のSHAを対象に既存の限定Plus一時画面で最大3往復を検証する工程が残る。モデル・認証経路・代表入力と応答・初文字/完了の遅延、待機案内の切替、Tryへの手動保存と再表示、未完了範囲を記録する。架空データとブラウザー内保存に限定し、本番Geminiとの差を明記する。接続確認だけを画面検証の成功とせず、本番認証・DB保存はモックCIで別途検証する。

残る制約：応答速度、専用確認カード、担当・日付付き永続保存は解決していない。週次では待機説明の分かりやすさと専用保存機能の着手優先度を判断する。
