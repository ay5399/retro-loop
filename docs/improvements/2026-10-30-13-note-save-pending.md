# 付箋の保存中表示と再送信抑止

## 観測と採用理由

添付のai-chat／board-color／board-group／board-vote画面では、Try欄への手動追加が現行の保存導線。追加フォームには保存中表示と入力・追加操作のpending制御がなく、addNoteは呼出しごとに新規登録する。重複登録の実行再現、発生頻度、利用者への影響は未確認。ベースライン失敗ログは提供されていない。

候補①「本人担当・日付付き確認保存」はオーナーの最優先シナリオへの効果が大きいが、保護対象DBを含む専用作業が必要。候補②「付箋保存中表示と再送信抑止」は効果が限定的でも、本人が決めたTryの保存を支える小さな可逆変更として実装できる。独立承認済み計画に従い②だけを採用した。競合との機能一致自体は目的にしない。

## 調査（2026-10-30閲覧）

- https://support.retrium.com/articles/how-do-action-items-work-in-retrium/ : Retrium公式ヘルプはアクションに担当者（ambassador）と目標完了日を設定し、完了管理できると説明する。
- https://www.parabol.co/resources/retrospective-meetings/ : Parabol公式は会議の新規タスクをチームダッシュボードへ記録し、次回Check-Inで扱う導線を説明する。
- https://www.scrum.org/resources/blog/ditch-unfinished-action-items : Stefan Wolpersの実務記事（2024-10-21）は未完了項目の蓄積、担当・期日の不明確さを課題として挙げ、項目数の制限と次回レビューを提案する。

前二者は製品の提供機能、後者は実務家による課題の報告であり、RetroLoop利用者の観察や定量調査ではない。いずれもRetroLoopでの重複登録や本変更の効果を実証しない。「保存待ちの迷いを減らす」は仮説。インタビューや使用指標は作成していない。

技術資料:

- https://nextjs.org/docs/app/guides/forms : 同梱node_modules/next/dist/docs/01-app/02-guides/forms.mdで、useFormStatusをフォーム内の子コンポーネントに置く要件とpendingによる無効化を静的確認。
- 同梱Next.jsのuse-client.mdでクライアント境界を確認。
- https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat : 同梱ai/docs/07-reference/02-ai-sdk-ui/01-use-chat.mdx、ai/src/ui/ui-messages.ts、@ai-sdk/react/src/use-chat.tsの型を静的確認。AIの送信状態と付箋のフォーム状態は別であり、AIコードは変更しない。

## 変更前後

変更前は送信後も追加欄とボタンが操作可能な同じ表示。変更後は共有のAddNoteFieldsが親フォームのuseFormStatusを読み、保存中は入力と送信を無効化する。ボタンは「保存中…」、常設のrole=status領域は列名付きの保存待機通知を表示する。KEEP／PROBLEM／TRYに共通適用し、処理終了後は再操作できる。既存Server Action・認可・DB・AI指示は維持。

## 回帰防止と検証状況

独立ファイルe2e/note-save-pending.spec.tsを追加し、既存E2E本文・assertionは変更していない。各列のNext-Actionヘッダー付きPOSTを明示的なゲートで送出前に保留する。固定時間待ちに頼らず、保存中の無効化と通知、他列の操作可能状態、再クリック・Enter後のPOST数を確認する。ゲート解放後の表示1件・ダミーDB1件・再読み込み後の1件を確認し、完了後に次の付箋も追加する。

改訂版テストが作成する予定のPNGは次の2点。旧SHAのスクリーンショットではない。

- e2e/__screens__/note-save-pending-before.png（操作前）
- e2e/__screens__/note-save-pending-after.png（Try保存待機中）

ホスト上でアプリ・SDKコード、ビルド、テスト、実AIを実行していない。現在確認済みなのは静的なコードと差分のみ。通常CIはcontrollerが隔離GitHub runner・ダミーPostgreSQL・モックAIで実行する予定で、成功とは判定しない。

## 独立レビューと残る工程

企画はユーザー提示の独立承認済み計画を採用した。実装に対する独立Claudeレビューはcontroller側の未完了工程。現時点ではClaudeの指摘・対応は未受領であり、レビュー済みとは扱わない。指摘が届いた際は指摘内容・採否・修正・再検証結果をこの記録へ追記する。

共有ボード変更のため、独立レビュー後のSHAを対象としたPC内の限定Plus画面検証（架空データ・最大3往復・ブラウザー内保存）もcontroller側の未完了工程。本番Geminiとのモデル差、応答・遅延・保存再表示の結果を記録する必要がある。接続確認とUIから保存までの検証は区別する。既存の実AI検証失敗を本変更で修復済みとは扱わない。

## 制約と週次判断

対象は同じフォームの処理中の再操作。通信再試行・別タブ・直接リクエストに対するサーバー側冪等性は保証しない。専用確認カード、担当・日付・未着手／完了管理、効果追跡は未実装。手動Try転記を専用アクション保存の完成とは扱わない。週次では保存時の迷いへの効果を観察し、最優先の専用確認保存へ着手するか判断する。
